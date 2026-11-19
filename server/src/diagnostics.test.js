import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {DIAGNOSTICS_PROBE} from '../../shared/diagnostics.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {createGameServer} from './app.js';
import {RoomStore} from './RoomStore.js';

test('relay diagnostics require membership, are rate-limited and expose only opted-in local stages', async t => {
  let now = 1000;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10});
  const clients = [];
  t.after(async () => {for (const client of clients) client.disconnect(); await app.close();});
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const connect = async () => {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, {transports: ['websocket'], reconnection: false});
    clients.push(client); await once(client, 'connect'); return client;
  };
  const send = (client, name, value) => client.timeout(2000).emitWithAck(name, value);
  const tv = await connect(), phone = await connect(), stranger = await connect();
  assert.equal((await send(stranger, DIAGNOSTICS_PROBE, {enabled: true})).error, 'not-in-room');
  const capabilities = createControllerCapabilities({buttons: true});
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling', capabilities});
  assert.equal(room.ok, true);
  const seat = await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'PrivateName', capabilities});
  assert.equal(seat.ok, true);
  assert.equal(app.io.sockets.sockets.get(phone.id).data.weeDiagnostics, undefined);
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true, skipTutorial: true});
  await send(phone, EVENTS.PLAYER_START, {});
  now += 5000; store.finishCountdown(room.code);
  assert.equal((await send(phone, DIAGNOSTICS_PROBE, {enabled: true})).ok, true);
  assert.equal((await send(phone, DIAGNOSTICS_PROBE, {enabled: true})).error, 'rate-limited');
  const lobby = store.lobby(room.code);
  const aim = {gameId: lobby.gameId, generation: lobby.inputGeneration, hostEpoch: lobby.hostEpoch, seq: 1,
    aim: .2, locked: false};
  store.setGameState(tv.id, {gameId:lobby.gameId, phase:'ready',currentPlayer:1,frame:1});
  const delivered = once(tv, EVENTS.GAME_AIM);
  phone.emit(EVENTS.PLAYER_AIM, aim); await delivered;
  phone.emit(EVENTS.PLAYER_AIM, {...aim, seq: 2}); // Same server tick: deliberately rate-limited.
  await delay(1050);
  const result = await send(phone, DIAGNOSTICS_PROBE, {enabled: true});
  assert.equal(result.transport, 'websocket');
  assert.equal(result.diagnostics.counters['aim.relayed'], 1);
  assert.equal(result.diagnostics.counters['aim.rateLimited'], 1);
  assert.equal(result.diagnostics.timings['aim.serverProcessingMs'].count, 2);
  assert.equal(result.diagnostics.traces[0].id, 'p1.aim.1');
  const encoded = JSON.stringify(result);
  for (const privateValue of [seat.token, room.token, 'PrivateName']) assert.equal(encoded.includes(privateValue), false);
  await send(phone, DIAGNOSTICS_PROBE, {enabled: false});
  assert.equal(app.io.sockets.sockets.get(phone.id).data.weeDiagnostics, undefined);
});
