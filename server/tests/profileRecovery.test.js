import {expect, test} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {ProfileStore} from '@server/profiles/store.js';
import {createProfileService} from '@server/profiles/service.js';
import {createGameServer} from '@server/src/app.js';
import {RoomStore} from '@server/src/RoomStore.js';
import {createControllerCapabilities} from '@wee/shared/controllerCapabilities.js';
import {EVENTS, PROTOCOL_VERSION as v} from '@wee/shared/protocol.js';

test('a persisted solo game survives service restart and restores only to its signed-in owner under fresh room credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wee-recovery-'));
  const filename = join(directory, 'profiles.sqlite');
  let database = new ProfileStore({filename});
  let app;
  const sockets = [];
  try {
    const account = await database.register({username: 'recover_owner', displayName: 'Original', password: 'owner recovery password'});
    const outsider = await database.register({username: 'other_player', displayName: 'Other Player', password: 'other recovery password'});
    const remaining = [3, 4, 5, 6, 7, 8, 9, 10];
    const state = {version: 1, boundary: 'settled',
      match: {version: 1, players: [{player: 1, name: 'Original'}], deliveries: [remaining]},
      pins: remaining.map(id => ({id, position: [id * .11, .4, -9.123], quaternion: [0, 0, 0, 1], standing: true})), settings: {aim: .2}};
    database.createMatch({matchId: 'old-game:round:0', sport: 'bowling', hostMemberId: 'old-host',
      participants: [{memberId: 'old-player', profileId: account.profile.id, name: 'Original'}]});
    database.saveCheckpoint({matchId: 'old-game:round:0', hostMemberId: 'old-host', hostEpoch: 1, expectedRevision: 0, state});
    database.close();
    database = new ProfileStore({filename});
    const profiles = createProfileService({store: database});
    let clock = 0;
    const rooms = new RoomStore({now: () => clock});
    app = createGameServer({profiles, store: rooms, tickMs: 10});
    app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
    const origin = `http://127.0.0.1:${app.http.address().port}`;
    const connect = async profileToken => {
      const socket = io(origin, {transports: ['websocket'], reconnection: false, auth: profileToken ? {profileToken} : {}});
      sockets.push(socket); await once(socket, 'connect'); return socket;
    };
    const send = (socket, event, payload) => socket.timeout(2000).emitWithAck(event, payload);
    const capabilities = createControllerCapabilities();
    const guest = await connect(), other = await connect(outsider.token), host = await connect(account.token);
    expect(await send(guest, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities})).toMatchObject({ok: false, error: 'not-signed-in'});
    expect(await send(other, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities})).toMatchObject({ok: false, error: 'not-found'});
    let restored = await send(host, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities});
    expect(restored).toMatchObject({ok: true, recovering: true, sport: 'bowling'});
    expect(restored.token).toBeTruthy();
    expect(await send(host, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities})).toMatchObject({ok: true, code: restored.code, token: restored.token});
    const rivalHost = await connect(account.token);
    expect(await send(rivalHost, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities})).toMatchObject({ok: false, error: 'recovery-in-use'});
    expect(await send(host, EVENTS.HOST_CLOSE, {})).toMatchObject({ok: true});
    expect(database.recoverableMatches(account.profile.id)).toEqual([expect.objectContaining({matchId: 'old-game:round:0'})]);
    restored = await send(host, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities});
    expect(restored).toMatchObject({ok: true});
    expect(await send(guest, EVENTS.PLAYER_JOIN, {v, code: restored.code, name: 'Imposter', profileId: account.profile.id, capabilities}))
      .toMatchObject({ok: false, error: 'recovery-owner-required'});
    expect(await send(other, EVENTS.PLAYER_JOIN, {v, code: restored.code, name: 'Other', capabilities}))
      .toMatchObject({ok: false, error: 'recovery-owner-required'});
    const phone = await connect(account.token);
    expect(await send(phone, EVENTS.PLAYER_JOIN, {v, code: restored.code, name: 'New Name', capabilities}))
      .toMatchObject({ok: true, slot: 0, name: 'Original'});
    expect(await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'})).toMatchObject({ok: true});
    expect(await send(phone, EVENTS.PLAYER_READY, {ready: true})).toMatchObject({ok: true});
    await send(phone, EVENTS.PLAYER_START, {});
    clock += 5000; rooms.finishCountdown(restored.code);
    const lobby = rooms.lobby(restored.code);
    const recovery = await send(host, EVENTS.HOST_RECOVERY, {gameId: lobby.gameId, hostEpoch: lobby.hostEpoch});
    expect(recovery).toMatchObject({ok: true, checkpoint: {payload: state}});
    const saved = await send(host, EVENTS.HOST_CHECKPOINT, {gameId: lobby.gameId, hostEpoch: lobby.hostEpoch,
      generation: lobby.inputGeneration, sport: 'bowling', rulesVersion: 1, checkpointVersion: 1,
      expectedRevision: recovery.checkpoint.revision, payload: state});
    expect(saved).toMatchObject({ok: true, saved: true});
    expect(await send(rivalHost, EVENTS.HOST_RESTORE, {matchId: 'old-game:round:0', capabilities})).toMatchObject({ok: false, error: 'recovery-already-continued'});
    expect(database.recoverableMatches(account.profile.id).some(match => match.matchId === 'old-game:round:0')).toBe(false);
    expect(database.history(account.profile.id)).toHaveLength(2);
    expect(database.readCheckpoint('old-game:round:0').state).toEqual(state);
    expect(database.matchMetadata(`${lobby.gameId}:round:0`).hostMemberId).not.toBe('old-host');
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (app) await app.close();
    database.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
