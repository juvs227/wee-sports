import { test } from 'vitest';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PHASES, PROTOCOL_VERSION as v, VOTE_SECONDS } from '@wee/shared/protocol.js';
import { RoomStore } from '@server/src/RoomStore.js';
import { createGameServer } from '@server/src/app.js';

function fixture(sport = 'tennis') {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const room = store.createRoom('tv', { v, sport });
  const seats = ['p1', 'p2'].map((socket, index) => {
    const seat = store.join(socket, { v, code: room.code, name: `Player ${index + 1}` });
    store.setSetup(socket, { setup: 'motion' }); return seat;
  });
  const start = () => {
    for (const socket of ['p1', 'p2']) store.setReady(socket, { ready: true });
    store.calibrationDone('tv');
    now += 5000; store.finishCountdown(room.code);
    now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    return store.lobby(room.code).gameId;
  };
  const gameId = start();
  const state = sport === 'bowling' ? { phase: 'rolling', currentPlayer: 1, frame: 3 }
    : { phase: 'rally', server: 1, winner: null };
  store.setGameState('tv', { ...state, gameId });
  return { store, room, seats, gameId, start, pause: (paused, socket = 'p1', role = 'player') =>
    store.setPaused(socket, { gameId, paused }, role) };
}

for (const sport of ['tennis', 'bowling']) test(`${sport}: pause is shared, blocks play and preserves state/setup until explicit resume`, () => {
  const { store, room, gameId, pause } = fixture(sport);
  const before = store.lobby(room.code);
  assert.equal(pause(true).ok, true);
  const held = store.lobby(room.code);
  assert.equal(held.paused, true); assert.equal(held.manuallyPaused, true);
  assert.deepEqual(held.gameState, before.gameState); assert.deepEqual(held.players, before.players);
  assert.deepEqual(store.reconnectingCodes, []);
  assert.equal(pause(true).changed, false);
  const input = sport === 'tennis' ? { type: 'swing', id: 's1', gameId, label: 'Forehand', hand: 'Right' }
    : { type: 'roll', id: 'r1', power: .6, aim: 0, spin: 0 };
  assert.equal(store[sport === 'tennis' ? 'swingTarget' : 'rollTarget']('p1', input).error, 'paused');
  assert.equal(store.gameCommandTarget('p1', { id: 'reset', gameId, action: 'new-match', ...(sport === 'tennis' ? { format: 'full' } : {}) }).error, 'paused');
  assert.equal(pause(false, 'tv', 'host').paused, false);
  assert.equal(store.lobby(room.code).manuallyPaused, false);
  assert.deepEqual(store.lobby(room.code).gameState, before.gameState);
  assert.equal(pause(false).changed, false);
});

test('pause authorizes the current TV/P1 and rejects stale, foreign and malformed requests', () => {
  const { store, room, seats, gameId } = fixture();
  for (const socket of ['tv', 'p2', 'unknown']) assert.equal(store.setPaused(socket, { gameId, paused: true }, 'player').error, 'not-game-leader');
  for (const socket of ['p1', 'p2', 'unknown']) assert.equal(store.setPaused(socket, { gameId, paused: true }, 'host').error, 'not-host');
  for (const paused of [undefined, null, 1, 'true']) assert.equal(store.setPaused('p1', { gameId, paused }, 'player').error, 'bad-pause');
  for (const payload of [undefined, null, {}, { gameId: 'old', paused: true }]) assert.equal(store.setPaused('p1', payload, 'player').error, 'not-playing');
  const other = store.createRoom('other', { v, sport: 'tennis' });
  assert.equal(store.setPaused('other', { gameId, code: room.code, paused: true }).error, 'not-playing');
  store.resume('new-p1', { v, code: room.code, role: 'player', token: seats[0].token });
  assert.equal(store.setPaused('p1', { gameId, paused: true }, 'player').error, 'not-game-leader');
  assert.equal(store.setPaused('new-p1', { gameId, code: other.code, paused: true }, 'player').code, room.code);
  assert.equal(store.lobby(other.code).manuallyPaused, false);
});

test('resume cannot bypass reconnect or missing controller setup, and reconnect cannot bypass manual pause', () => {
  const { store, room, seats, pause } = fixture();
  pause(true); store.disconnect('p2');
  assert.deepEqual(store.reconnectingCodes, [room.code]);
  assert.equal(pause(false).paused, true);
  assert.equal(store.lobby(room.code).manuallyPaused, false);
  store.resume('p2', { v, code: room.code, role: 'player', token: seats[1].token });
  assert.equal(store.lobby(room.code).paused, false);
  pause(true); store.disconnect('p2');
  store.resume('p2', { v, code: room.code, role: 'player', token: seats[1].token });
  assert.equal(store.lobby(room.code).paused, true);
  assert.deepEqual(store.reconnectingCodes, []);
  store.setSetup('p2', { setup: null });
  assert.equal(pause(false).paused, true);
  assert.deepEqual(store.reconnectingCodes, []);
  store.setSetup('p2', { setup: 'motion' });
  assert.equal(store.lobby(room.code).paused, false);
});

test('return and a new game clear manual pause; completed-state races can always resume', () => {
  const { store, room, gameId, start, pause } = fixture();
  pause(true);
  store.setGameState('tv', { gameId, phase: 'complete', server: 1, winner: 1 });
  assert.equal(pause(false).ok, true);
  assert.equal(pause(true).error, 'not-playing');
  assert.equal(store.returnToLobby('tv', { gameId }).ok, true);
  assert.equal(store.lobby(room.code).manuallyPaused, false);
  assert.equal(store.lobby(room.code).paused, false);
  const next = start();
  assert.equal(pause(true).error, 'not-playing');
  assert.equal(store.setPaused('p1', { gameId: next, paused: true }, 'player').ok, true);
  assert.equal(store.returnToLobby('p1', { gameId: next }, 'player').ok, true);
  assert.equal(store.lobby(room.code).manuallyPaused, false);
});

test('pending resets/releases finish their delivery before a new manual pause can start', () => {
  const { store, room, gameId, pause } = fixture('bowling');
  store.setGameOptions('tv', { gameId, sport: 'bowling' });
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 1, frame: 1 });
  const roll = { type: 'roll', id: 'roll', power: .6, aim: 0, spin: 0 };
  assert.equal(store.rollTarget('p1', roll).ok, true);
  assert.equal(pause(true).error, 'delivery-pending');
  store.finishRollDelivery(room.code, roll.id, gameId);
  assert.equal(store.gameCommandTarget('p1', { id: 'reset', gameId, action: 'new-match' }).ok, true);
  assert.equal(pause(true).error, 'game-command-pending');
  store.finishGameCommand(room.code, 'reset', gameId);
  assert.equal(pause(true).ok, true);
  assert.equal(pause(false).ok, true);
  assert.equal(store.rollTarget('p1', { ...roll, id: 'after-resume' }).ok, true);
});

const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
function snapshot(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(EVENTS.LOBBY_UPDATE, handler); reject(new Error('Missing lobby snapshot')); }, 2000);
    const handler = lobby => { if (predicate(lobby)) { clearTimeout(timer); socket.off(EVENTS.LOBBY_UPDATE, handler); resolve(lobby); } };
    socket.on(EVENTS.LOBBY_UPDATE, handler);
  });
}

for (const sport of ['tennis', 'bowling']) test(`real sockets: ${sport} phone/TV share pause and resume without losing a game`, async t => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const app = createGameServer({ store, tickMs: 10 });
  const sockets = [];
  t.onTestFinished(async () => { for (const socket of sockets) socket.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const connect = async () => {
    const socket = io(`http://127.0.0.1:${app.http.address().port}`, { transports: ['websocket'], reconnection: false });
    sockets.push(socket); await once(socket, 'connect'); return socket;
  };
  const tv = await connect(), p1 = await connect(), p2 = await connect();
  const room = await send(tv, EVENTS.HOST_CREATE, { v, sport });
  for (const [index, phone] of [p1, p2].entries()) {
    await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: `P${index + 1}` });
    await send(phone, EVENTS.PLAYER_SETUP, { setup: 'motion' });
  }
  for (const phone of [p1, p2]) await send(phone, EVENTS.PLAYER_READY, { ready: true });
  await send(tv, EVENTS.HOST_CALIBRATION_DONE, {});
  now += 5000; store.finishCountdown(room.code); now += VOTE_SECONDS * 1000; store.expireVote(room.code);
  const gameId = store.lobby(room.code).gameId;
  assert.equal((await send(p2, EVENTS.PLAYER_PAUSE, { gameId, paused: true })).error, 'not-game-leader');
  assert.equal((await send(p1, EVENTS.HOST_PAUSE, { gameId, paused: true })).error, 'not-host');
  const observedPause = snapshot(tv, state => state.manuallyPaused);
  assert.equal((await send(p1, EVENTS.PLAYER_PAUSE, { gameId, paused: true })).paused, true);
  assert.equal((await observedPause).gameId, gameId);
  const observedResume = snapshot(p1, state => !state.paused);
  assert.equal((await send(tv, EVENTS.HOST_PAUSE, { gameId, paused: false })).paused, false);
  assert.equal((await observedResume).players[0].setup, 'motion');
  const again = snapshot(p2, state => state.manuallyPaused);
  await send(tv, EVENTS.HOST_PAUSE, { gameId, paused: true }); await again;
  assert.equal((await send(p1, EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId })).ok, true);
  assert.equal(store.lobby(room.code).phase, PHASES.READY);
  assert.equal(store.lobby(room.code).manuallyPaused, false);
});
