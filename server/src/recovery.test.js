import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';



import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v, PHASES} from '../../shared/protocol.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {ProfileStore} from '../profiles/store.js';
import {createProfileService} from '../profiles/service.js';
import {RoomStore} from './RoomStore.js';
import {createGameServer} from './app.js';

const capabilities = createControllerCapabilities();
const send = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, data);
const register = (store, username) => store.register({username, password: 'test recovery password long enough', displayName: username});
const bowlingState = (count = 1) => ({version: 1, boundary: 'settled', match: {version: 1,
  players: Array.from({length: count}, (_, i) => ({player: i + 1, name: `Player ${i + 1}`})), deliveries: []},
  pins: Array.from({length: 10}, (_, i) => ({id: i + 1, position: [i * .1, .4, -9], quaternion: [0, 0, 0, 1], standing: true})), settings: {aim: .2}});

async function server(profileStore, code) {
  let now = 0, closed = false;
  const store = new RoomStore({now: () => now, ...(code ? {makeCode: () => code} : {})});
  const app = createGameServer({store, profiles: createProfileService({store: profileStore}), tickMs: 10000});
  const clients = [];
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const origin = `http://127.0.0.1:${app.http.address().port}`;
  return {app, store, origin,
    async connect(token, extraHeaders = {}) {
      const socket = io(`http://127.0.0.1:${app.http.address().port}`, {transports: ['websocket'], reconnection: false,
        auth: token ? {profileToken: token} : {}, extraHeaders});
      clients.push(socket);
      await new Promise((resolveConnect, reject) => {
        socket.once('connect', resolveConnect); socket.once('connect_error', reject);
      });
      return socket;
    },
    finishCountdown(code) {now += 5000; assert.equal(store.finishCountdown(code)?.code, code);},
    async close() {if (closed) return; closed = true; for (const client of clients) client.disconnect(); await app.close();},
  };
}
async function fixture(t, {filename = ':memory:'} = {}) {
  const profileStore = new ProfileStore({filename});
  const running = [];
  t.after(async () => {for (const instance of running.reverse()) await instance.close(); profileStore.close();});
  const owner = await register(profileStore, 'recovery_owner');
  const other = await register(profileStore, 'other_owner');
  const start = async code => {const instance = await server(profileStore, code); running.push(instance); return instance;};
  return {profileStore, owner, other, start};
}
function seed(store, owner, {id = 'source-match', sport = 'bowling', count = 1, complete = false} = {}) {
  const hostMemberId = `${id}-host`;
  const participants = Array.from({length: count}, (_, i) => ({memberId: `${id}-p${i}`, name: `Player ${i + 1}`, profileId: owner.profile.id}));
  store.createMatch({matchId: id, sport, hostMemberId, participants});
  const state = bowlingState(count);
  const results = complete ? participants.map(p => ({memberId: p.memberId, score: 1, rank: 1, outcome: 'complete'})) : undefined;
  store.saveCheckpoint({matchId: id, hostMemberId, hostEpoch: 1, expectedRevision: 0, state, results});
  return state;
}
async function startRecovered(instance, host, phone, restored) {
  const seat = await send(phone, EVENTS.PLAYER_JOIN, {v, code: restored.code, name: 'Ignored rename', capabilities});
  assert.equal(seat.ok, true);
  assert.equal((await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'})).ok, true);
  assert.equal((await send(phone, EVENTS.PLAYER_READY, {ready: true})).ok, true);
  await send(phone, EVENTS.PLAYER_START, {});
  instance.finishCountdown(restored.code);
  const view = instance.store.lobby(restored.code);
  assert.equal(view.phase, PHASES.GAME);
  const recovered = await send(host, EVENTS.HOST_RECOVERY, {gameId: view.gameId, hostEpoch: view.hostEpoch});
  return {seat, view, recovered};
}




test('archive host restore requires a currently authenticated owner and never trusts supplied account IDs', async t => {
  const f = await fixture(t); seed(f.profileStore, f.owner);
  const instance = await f.start();
  const guest = await instance.connect(), outsider = await instance.connect(f.other.token), owner = await instance.connect(f.owner.token);
  const request = {matchId: 'source-match', capabilities, profileId: f.owner.profile.id, token: f.owner.token};
  assert.equal((await send(guest, EVENTS.HOST_RESTORE, request)).error, 'not-signed-in');
  assert.equal((await send(outsider, EVENTS.HOST_RESTORE, request)).error, 'not-found');
  assert.equal((await send(owner, EVENTS.HOST_RESTORE, {...request, matchId: 'unknown-match'})).error, 'not-found');
  assert.equal((await send(owner, EVENTS.HOST_RESTORE, request)).ok, true);
  f.profileStore.logout(f.owner.token);
  assert.equal((await send(owner, EVENTS.HOST_RESTORE, request)).error, 'not-signed-in');
});

test('recovery accepts only active solo checkpoints and an existing different room is preserved', async t => {
  const f = await fixture(t);
  seed(f.profileStore, f.owner, {id: 'solo-bowling', sport: 'bowling'});
  seed(f.profileStore, f.owner, {id: 'multi-bowling', sport: 'bowling', count: 2});
  seed(f.profileStore, f.owner, {id: 'finished', complete: true});
  const instance = await f.start(); const host = await instance.connect(f.owner.token);
  assert.equal((await send(host, EVENTS.HOST_RESTORE, {matchId: 'multi-bowling', capabilities})).error, 'not-found');
  assert.equal((await send(host, EVENTS.HOST_RESTORE, {matchId: 'finished', capabilities})).error, 'recovery-unavailable');
  const room = await send(host, EVENTS.HOST_CREATE, {v, sport: 'bowling', capabilities});
  assert.equal((await send(host, EVENTS.HOST_RESTORE, {matchId: 'solo-bowling', capabilities})).error, 'already-in-room');
  assert.equal(instance.store.hostedBy(host.id), room.code);
  const freshHost = await instance.connect(f.owner.token);
  assert.equal((await send(freshHost, EVENTS.HOST_RESTORE, {matchId: 'solo-bowling', capabilities})).ok, true);
});

test('recovered player seat belongs to the same profile, uses saved identity and requires fresh setup', async t => {
  const f = await fixture(t); const source = seed(f.profileStore, f.owner);
  const instance = await f.start();
  const host = await instance.connect(f.owner.token), guest = await instance.connect(), other = await instance.connect(f.other.token), owner = await instance.connect(f.owner.token);
  const restored = await send(host, EVENTS.HOST_RESTORE, {matchId: 'source-match', capabilities});
  const request = {v, code: restored.code, name: 'Pretend owner', profileId: f.owner.profile.id, capabilities};
  assert.equal((await send(guest, EVENTS.PLAYER_JOIN, request)).error, 'recovery-owner-required');
  assert.equal((await send(other, EVENTS.PLAYER_JOIN, request)).error, 'recovery-owner-required');
  const joined = await send(owner, EVENTS.PLAYER_JOIN, request);
  assert.equal(joined.ok, true); assert.equal(joined.name, 'Player 1');
  assert.equal(joined.players[0].setup, null); assert.equal(joined.players[0].ready, false);
  assert.equal((await send(owner, EVENTS.PLAYER_READY, {ready: true})).error, 'setup-required');
  assert.equal((await send(host, EVENTS.HOST_RECOVERY, {gameId: null, hostEpoch: restored.hostEpoch})).checkpoint, null);
  const {recovered} = await startRecovered(instance, host, owner, restored);
  assert.deepEqual(recovered.checkpoint.payload, source);
  const publicView = JSON.stringify(instance.store.lobby(restored.code));
  assert.ok(!publicView.includes(f.owner.profile.id)); assert.ok(!publicView.includes(f.owner.token));
});



test('leaving a recovery countdown and rejoining cannot consume the archived state before play starts', async t => {
  const f = await fixture(t); const state = seed(f.profileStore, f.owner);
  const instance = await f.start();
  const host = await instance.connect(f.owner.token), phone = await instance.connect(f.owner.token);
  const restored = await send(host, EVENTS.HOST_RESTORE, {matchId: 'source-match', capabilities});
  assert.equal((await send(phone, EVENTS.PLAYER_JOIN, {v, code: restored.code, name: 'Player 1', capabilities})).ok, true);
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  assert.equal(instance.store.lobby(restored.code).phase, PHASES.COUNTDOWN);
  await send(phone, EVENTS.PLAYER_LEAVE, {});
  assert.equal(instance.store.lobby(restored.code).players.length, 0);
  const {recovered} = await startRecovered(instance, host, phone, restored);
  assert.deepEqual(recovered.checkpoint?.payload, state, 'a cancelled countdown must not erase the requested archived recovery');
});

test('profile authentication storage failure does not crash or block ordinary guest rooms', async t => {
  const f = await fixture(t); seed(f.profileStore, f.owner);
  const instance = await f.start();
  const host = await instance.connect(f.owner.token), phone = await instance.connect();
  const authenticate = f.profileStore.authenticate;
  f.profileStore.authenticate = () => {throw new Error('simulated database authentication outage');};
  try {
    const room = await send(host, EVENTS.HOST_CREATE, {v, sport: 'bowling', capabilities});
    assert.equal(room.ok, true); assert.equal(instance.store.sessionContext(host.id).profileId, null);
    assert.equal((await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Guest', capabilities})).ok, true);
    assert.equal((await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'})).ok, true);
    assert.equal((await send(phone, EVENTS.PLAYER_READY, {ready: true})).ok, true);
    await send(phone, EVENTS.PLAYER_START, {});
    assert.equal((await send(host, EVENTS.HOST_RESTORE, {matchId: 'source-match', capabilities})).error, 'not-signed-in');
    assert.equal(await (await fetch(instance.origin + '/health')).text(), 'ok');
  } finally { f.profileStore.authenticate = authenticate; }
});

test('browser account cookies authorize recovery only from the trusted game origin', async t => {
  const f = await fixture(t); seed(f.profileStore, f.owner);
  const instance = await f.start();
  const cookie = `wee_profile=${f.owner.token}`;
  await assert.rejects(instance.connect(null, {Cookie: cookie, Origin: 'https://untrusted.example'}));
  assert.equal(instance.store.roomCount, 0, 'a foreign browser cannot reach room or recovery events');
  const trusted = await instance.connect(null, {Cookie: cookie, Origin: instance.origin});
  const payload = {matchId: 'source-match', capabilities};
  assert.equal((await send(trusted, EVENTS.HOST_RESTORE, payload)).ok, true);
});
