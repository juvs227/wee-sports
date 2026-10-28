import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION, PHASES, isRoll } from '@wee/shared/protocol.js';
import { createGameServer } from './app.js';
import { RoomStore } from './RoomStore.js';

const v = PROTOCOL_VERSION;
const roll = (id = 'delivery-1', extra = {}) => ({ type: 'roll', id, power: .7, spin: .2, aim: -.1, ...extra });
function readyBowling(count = 4) {
  const clock = { now: 0 };
  const store = new RoomStore({ now: () => clock.now });
  const room = store.createRoom('tv', { v, sport: 'bowling' });
  const seats = Array.from({ length: count }, (_, index) => store.join(`p${index + 1}`, { v, code: room.code, name: `P${index + 1}` }));
  const start = () => {
    for (const index of seats.keys()) {
      assert.equal(store.setSetup(`p${index + 1}`, { setup: index % 2 ? 'motion' : 'buttons' }).ok, true);
      assert.equal(store.setReady(`p${index + 1}`, { ready: true }).ok, true);
    }
    assert.equal(store.start('tv').ok, true);
    clock.now += 5000;
    assert.deepEqual(store.finishCountdown(room.code), { code: room.code });
    return store.lobby(room.code).gameId;
  };
  return { store, room, seats, clock, start };
}

test('bowling supports setup for all four seats and requires each controller before ready', () => {
  const { store, room, start } = readyBowling();
  assert.equal(store.lobby(room.code).players.length, 4);
  for (let player = 1; player <= 4; player++) {
    assert.equal(store.setReady(`p${player}`, { ready: true }).error, 'setup-required');
  }
  const gameId = start();
  assert.equal(typeof gameId, 'string');
  assert.equal(store.lobby(room.code).phase, PHASES.TUTORIAL);
  assert.deepEqual(store.lobby(room.code).setupPending, []);
  assert.equal(store.setSetup('p4', { setup: null }).ok, true);
  assert.equal(store.lobby(room.code).paused, true);
  assert.deepEqual(store.lobby(room.code).setupPending, ['P4']);
  assert.equal(store.setSetup('p4', { setup: 'motion' }).ok, true);
  assert.equal(store.lobby(room.code).paused, false);
});

test('only the current authenticated TV can publish valid bowling turns for this game', () => {
  const { store, room, start } = readyBowling(2);
  assert.equal(store.setGameState('tv', { phase: 'ready', currentPlayer: 1, frame: 1 }).error, 'not-playing');
  const gameId = start();
  const state = { gameId, phase: 'ready', currentPlayer: 1, frame: 1 };
  assert.equal(store.setGameState('p1', state).error, 'not-host');
  assert.equal(store.setGameState('unknown', state).error, 'not-host');
  assert.equal(store.setGameState('tv', { ...state, gameId: 'old-match' }).error, 'not-playing');
  for (const change of [{ phase: 'unknown' }, { currentPlayer: 3 }, { currentPlayer: null },
    { currentPlayer: '1' }, { frame: 0 }, { frame: 11 }, { frame: 1.5 }, { frame: NaN }]) {
    assert.equal(store.setGameState('tv', { ...state, ...change }).error, 'bad-game-state');
  }
  assert.equal(store.setGameState('tv', state).ok, true);
  assert.deepEqual(store.lobby(room.code).gameState, { phase: 'ready', currentPlayer: 1, frame: 1 });
  assert.equal(store.setGameState('tv', { ...state, phase: 'complete', currentPlayer: 1 }).error, 'bad-game-state');
  assert.equal(store.setGameState('tv', { ...state, phase: 'complete', currentPlayer: null, frame: 10 }).ok, true);
  const resumed = store.resume('tv-new', { v, code: room.code, role: 'host', token: room.token });
  assert.equal(resumed.ok, true);
  assert.equal(store.setGameState('tv', state).error, 'not-host');
  assert.equal(store.setGameState('tv-new', state).ok, true);
});

test('roll validation rejects malformed, nonfinite and out-of-range values', () => {
  const { store, start } = readyBowling(1);
  const gameId = start();
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 1, frame: 1 });
  for (const change of [{ type: 'swing' }, { id: '' }, { id: 'x'.repeat(101) },
    { power: NaN }, { power: Infinity }, { power: -.01 }, { power: 1.01 }, { power: '0.7' },
    { aim: -1.01 }, { aim: 1.01 }, { aim: NaN }, { spin: -1.01 }, { spin: 1.01 }, { spin: null }]) {
    const event = roll('invalid', change);
    assert.equal(isRoll(event), false);
    assert.equal(store.rollTarget('p1', event).error, 'bad-roll');
  }
  assert.equal(isRoll(roll('edges', { power: 0, aim: -1, spin: 1 })), true);
  assert.equal(store.rollTarget('p1', roll()).ok, true); // Invalid packets did not reserve a delivery.
});

test('bowling stamps authenticated seat and game, locks pending delivery and rejects duplicates or wrong turns', () => {
  const { store, room, start } = readyBowling();
  assert.equal(store.rollTarget('p1', roll()).error, 'not-playing');
  const gameId = start();
  assert.equal(store.rollTarget('p1', roll()).error, 'game-loading');
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 4, frame: 1 });
  assert.equal(store.rollTarget('tv', roll()).error, 'not-controller');
  assert.equal(store.rollTarget('unknown', roll()).error, 'not-controller');
  assert.equal(store.rollTarget('p1', roll()).error, 'not-your-turn');
  const delivered = store.rollTarget('p4', roll('own-seat', { player: 1, gameId: 'forged', code: 'OTHER', untrusted: true }));
  assert.equal(delivered.hostSocketId, 'tv');
  assert.deepEqual(delivered.event, { ...roll('own-seat'), player: 4, gameId });
  assert.equal(store.rollTarget('p4', roll('next')).error, 'not-ready-to-roll');
  store.finishRollDelivery(room.code, 'unrelated-id');
  assert.equal(store.rollTarget('p4', roll('next')).error, 'not-ready-to-roll');
  store.finishRollDelivery(room.code, 'own-seat');
  assert.equal(store.rollTarget('p4', roll('own-seat')).error, 'duplicate-roll');
  store.setGameState('tv', { gameId, phase: 'rolling', currentPlayer: 4, frame: 1 });
  assert.equal(store.rollTarget('p4', roll('next')).error, 'not-ready-to-roll');
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 1, frame: 2 });
  assert.equal(store.rollTarget('p1', roll('next')).ok, true);
});

test('bowling disconnect pauses releases, preserves the game and rejects the replaced phone', () => {
  const { store, room, seats, start } = readyBowling(2);
  const gameId = start();
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 2, frame: 4 });
  store.disconnect('p1');
  assert.equal(store.rollTarget('p2', roll()).error, 'paused');
  assert.equal(store.resume('p1-new', { v, code: room.code, token: seats[0].token, role: 'player' }).ok, true);
  assert.equal(store.lobby(room.code).gameId, gameId);
  assert.equal(store.lobby(room.code).gameState.frame, 4);
  assert.equal(store.rollTarget('p1', roll()).error, 'not-controller');
  assert.equal(store.rollTarget('p2', roll()).ok, true);
});

const send = (socket, event, payload = {}) => socket.timeout(3500).emitWithAck(event, payload);
async function socketFixture(t) {
  const clock = { now: 0 };
  const store = new RoomStore({ now: () => clock.now });
  const app = createGameServer({ store, tickMs: 10 });
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  const url = `http://127.0.0.1:${app.http.address().port}`;
  const client = async () => {
    const socket = io(url, { transports: ['websocket'], reconnection: false });
    sockets.push(socket); await once(socket, 'connect'); return socket;
  };
  const room = async (count = 2) => {
    const host = await client();
    const created = await send(host, EVENTS.HOST_CREATE, { v, sport: 'bowling' });
    const phones = [], seats = [];
    for (let index = 0; index < count; index++) {
      phones.push(await client());
      seats.push(await send(phones[index], EVENTS.PLAYER_JOIN, { v, code: created.code, name: `P${index + 1}` }));
    }
    for (const phone of phones) {
      assert.equal((await send(phone, EVENTS.PLAYER_SETUP, { setup: 'buttons' })).ok, true);
      assert.equal((await send(phone, EVENTS.PLAYER_READY, { ready: true })).ok, true);
    }
    assert.equal((await send(host, EVENTS.HOST_START)).ok, true);
    clock.now += 5000; store.finishCountdown(created.code);
    const gameId = store.lobby(created.code).gameId;
    const state = (currentPlayer = 1, phase = 'ready') => send(host, EVENTS.HOST_GAME_STATE, { gameId, phase, currentPlayer, frame: 1 });
    assert.equal((await state()).ok, true);
    return { host, phones, seats, created, gameId, state };
  };
  return { app, client, room, store, clock };
}
function nextSnapshot(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(EVENTS.LOBBY_UPDATE, handler); reject(new Error('Missing bowling snapshot')); }, 2000);
    const handler = state => { if (predicate(state)) { clearTimeout(timer); socket.off(EVENTS.LOBBY_UPDATE, handler); resolve(state); } };
    socket.on(EVENTS.LOBBY_UPDATE, handler);
  });
}

test('real bowling sockets use the actual game acknowledgement and isolate rooms', async t => {
  const fixture = await socketFixture(t);
  const first = await fixture.room(), other = await fixture.room(1);
  const received = [], otherReceived = [];
  first.host.on(EVENTS.GAME_ROLL, (event, ack) => { received.push(event); ack({ ok: false, error: 'not-ready-to-roll' }); });
  other.host.on(EVENTS.GAME_ROLL, (event, ack) => { otherReceived.push(event); ack({ ok: true }); });
  assert.equal((await send(first.phones[1], EVENTS.HOST_GAME_STATE, { gameId: first.gameId, phase: 'ready', currentPlayer: 2, frame: 1 })).error, 'not-host');
  assert.equal((await send(first.phones[1], EVENTS.PLAYER_ROLL, roll('wrong-turn'))).error, 'not-your-turn');
  const forged = roll('denied', { code: other.created.code, player: 2, gameId: other.gameId });
  assert.equal((await send(first.phones[0], EVENTS.PLAYER_ROLL, forged)).error, 'not-ready-to-roll');
  assert.deepEqual(received[0], { ...roll('denied'), player: 1, gameId: first.gameId });
  assert.equal(otherReceived.length, 0);
  first.host.off(EVENTS.GAME_ROLL);
  first.host.on(EVENTS.GAME_ROLL, (event, ack) => { received.push(event); ack({ ok: true }); });
  assert.deepEqual(await send(first.phones[0], EVENTS.PLAYER_ROLL, roll('accepted')), { ok: true, id: 'accepted', receivers: 1 });
  assert.equal((await send(first.phones[0], EVENTS.PLAYER_ROLL, roll('accepted'))).error, 'duplicate-roll');
  assert.equal((await send(first.phones[0], EVENTS.PLAYER_ROLL, roll('nan', { power: NaN }))).error, 'bad-roll');
  assert.equal(received.length, 2);
  assert.equal(otherReceived.length, 0);
});

test('real bowling sockets block concurrent releases until the game acknowledges', async t => {
  const fixture = await socketFixture(t);
  const match = await fixture.room(1);
  let acknowledge;
  let deliveredResolve;
  const delivered = new Promise(resolve => { deliveredResolve = resolve; });
  match.host.on(EVENTS.GAME_ROLL, (_event, ack) => { acknowledge = ack; deliveredResolve(); });
  const first = send(match.phones[0], EVENTS.PLAYER_ROLL, roll('pending'));
  await delivered;
  assert.equal((await send(match.phones[0], EVENTS.PLAYER_ROLL, roll('concurrent'))).error, 'not-ready-to-roll');
  acknowledge({ ok: false, error: 'game-loading' });
  assert.equal((await first).error, 'game-loading');
  match.host.off(EVENTS.GAME_ROLL);
  match.host.on(EVENTS.GAME_ROLL, (_event, ack) => ack({ ok: true }));
  assert.equal((await send(match.phones[0], EVENTS.PLAYER_ROLL, roll('after-ack'))).ok, true);
});

test('real bowling sockets pause on disconnect and resume the same authenticated turn', async t => {
  const fixture = await socketFixture(t);
  const match = await fixture.room(2);
  await match.state(2);
  const received = [];
  match.host.on(EVENTS.GAME_ROLL, (event, ack) => { received.push(event); ack({ ok: true }); });
  const paused = nextSnapshot(match.host, state => state.paused);
  match.phones[0].disconnect();
  await paused;
  assert.equal((await send(match.phones[1], EVENTS.PLAYER_ROLL, roll('paused'))).error, 'paused');
  const returned = await fixture.client();
  const resumed = await send(returned, EVENTS.SESSION_RESUME, { v, code: match.created.code, token: match.seats[0].token, role: 'player' });
  assert.equal(resumed.paused, false);
  assert.equal(resumed.gameState.currentPlayer, 2);
  assert.equal(resumed.gameId, match.gameId);
  assert.equal((await send(match.phones[1], EVENTS.PLAYER_ROLL, roll('returned'))).ok, true);
  assert.equal(received[0].player, 2);
  const twin = await fixture.client();
  await send(twin, EVENTS.SESSION_RESUME, { v, code: match.created.code, token: match.seats[1].token, role: 'player' });
  assert.equal((await send(match.phones[1], EVENTS.PLAYER_ROLL, roll('stale-tab'))).error, 'not-controller');
  assert.equal((await send(twin, EVENTS.PLAYER_ROLL, roll('new-tab'))).ok, true);
  await send(match.host, EVENTS.HOST_CLOSE);
  assert.equal((await send(twin, EVENTS.PLAYER_ROLL, roll('closed'))).error, 'not-controller');
});
