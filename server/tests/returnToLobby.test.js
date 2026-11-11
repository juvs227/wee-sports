import { test } from 'vitest';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PHASES, PROTOCOL_VERSION as v, VOTE_SECONDS } from '@wee/shared/protocol.js';
import { RoomStore } from '@server/src/RoomStore.js';
import { createGameServer } from '@server/src/app.js';

function fixture(sport = 'tennis', count = 2) {
  const clock = { now: 0 };
  const store = new RoomStore({ now: () => clock.now });
  const room = store.createRoom('tv', { v, sport });
  const seats = Array.from({ length: count }, (_, i) => {
    const seat = store.join(`p${i + 1}`, { v, code: room.code, name: `Player ${i + 1}` });
    store.setSetup(`p${i + 1}`, { setup: i % 2 ? 'buttons' : 'motion' });
    return seat;
  });
  function start(countdown = false) {
    for (let i = 0; i < count; i++) assert.equal(store.setReady(`p${i + 1}`, { ready: true }).ok, true);
    store.calibrationDone('tv');
    if (!countdown) {
      clock.now += 5000; store.finishCountdown(room.code);
      clock.now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    }
    return store.lobby(room.code).gameId;
  }
  return { store, room, seats, clock, start };
}

for (const sport of ['tennis', 'bowling']) for (const role of ['host', 'player']) {
  test(`${sport}: ${role} returns everyone with their seats/setup intact and requires a fresh ready check`, () => {
    const { store, room, start } = fixture(sport, sport === 'bowling' ? 4 : 2);
    const gameId = start();
    const players = store.lobby(room.code).players;
    store.setSound('tv', { muted: true });
    const result = sport === 'tennis' ? { gameId, phase: 'complete', server: 1, winner: 2 }
      : { gameId, phase: 'complete', currentPlayer: null, frame: 10, winners: [1, 2], winnerScore: 120 };
    assert.equal(store.setGameState('tv', result).ok, true);
    assert.deepEqual(store.returnToLobby(role === 'host' ? 'tv' : 'p1', { gameId }, role), { ok: true, code: room.code });
    const lobby = store.lobby(room.code);
    assert.equal(lobby.phase, PHASES.READY);
    assert.deepEqual(lobby.players, players);
    assert.equal(lobby.gameId, null); assert.equal(lobby.gameState, null); assert.equal(lobby.gameOptions, null);
    assert.equal(lobby.countdown, null); assert.equal(lobby.soundMuted, true); assert.equal(lobby.paused, false);
    assert.equal(lobby.players.some(player => player.ready), false);
    assert.equal(store.setGameState('tv', result).error, 'not-playing');
    const replacementId = start();
    assert.notEqual(replacementId, gameId);
    assert.equal(store.returnToLobby('p1', { gameId }, 'player').error, 'not-playing');
    assert.equal(store.lobby(room.code).gameId, replacementId);
  });
}

test('return authorization follows the current host/P1 sessions, never forged roles or another room', () => {
  const { store, room, seats, start } = fixture();
  const gameId = start();
  const other = store.createRoom('other-tv', { v, sport: 'bowling' });
  store.join('other-p1', { v, code: other.code, name: 'Other' });
  for (const socket of ['p1', 'p2', 'stranger']) assert.equal(store.returnToLobby(socket, { gameId }, 'host').error, 'not-host');
  for (const socket of ['tv', 'p2', 'stranger']) assert.equal(store.returnToLobby(socket, { gameId }, 'player').error, 'not-game-leader');
  for (const payload of [undefined, null, {}, { gameId: '' }, { gameId: 1 }, { gameId: 'old' }]) {
    assert.equal(store.returnToLobby('p1', payload, 'player').error, 'not-playing');
  }
  assert.equal(store.returnToLobby('other-tv', { gameId, code: room.code }).error, 'not-playing');
  assert.equal(store.returnToLobby('other-p1', { gameId, code: room.code }, 'player').error, 'not-playing');
  store.resume('tv-new', { v, code: room.code, role: 'host', token: room.token });
  store.resume('p1-new', { v, code: room.code, role: 'player', token: seats[0].token });
  assert.equal(store.returnToLobby('tv', { gameId }).error, 'not-host');
  assert.equal(store.returnToLobby('p1', { gameId }, 'player').error, 'not-game-leader');
  assert.equal(store.returnToLobby('p1-new', { gameId, code: other.code }, 'player').code, room.code);
  assert.equal(store.lobby(other.code).phase, PHASES.READY);
});

test('return cancels the countdown and delayed countdown ticks cannot launch it', () => {
  const { store, room, clock, start } = fixture();
  const gameId = start(true);
  assert.equal(store.returnToLobby('tv', { gameId }).ok, true);
  clock.now += 30_000;
  assert.equal(store.finishCountdown(room.code), null);
  assert.deepEqual(store.countdownCodes, []);
  assert.equal(store.lobby(room.code).phase, PHASES.READY);
});

test('P1 can return during TV reconnect without clearing the TV reservation or genuine pause', () => {
  const { store, room, start } = fixture();
  const gameId = start();
  store.disconnect('tv');
  assert.equal(store.lobby(room.code).paused, true);
  assert.equal(store.returnToLobby('p1', { gameId }, 'player').ok, true);
  assert.equal(store.lobby(room.code).paused, true);
  assert.equal(store.setReady('p1', { ready: true }).error, 'paused');
  const restored = store.resume('tv-back', { v, code: room.code, role: 'host', token: room.token });
  assert.equal(restored.phase, PHASES.READY); assert.equal(restored.paused, false);
  assert.equal(restored.players[0].setup, 'motion');
  assert.equal(store.setReady('p1', { ready: true }).ok, true);
});

test('return while setup is missing preserves valid setups and releases only the gameplay setup pause', () => {
  const { store, room, start } = fixture();
  const gameId = start();
  store.setSetup('p2', { setup: null });
  assert.equal(store.lobby(room.code).paused, true);
  assert.equal(store.returnToLobby('tv', { gameId }).ok, true);
  assert.equal(store.lobby(room.code).paused, false);
  assert.equal(store.lobby(room.code).players[0].setup, 'motion');
  assert.equal(store.setReady('p1', { ready: true }).ok, true);
  assert.equal(store.setReady('p2', { ready: true }).error, 'setup-required');
});

test('a bowling return clears in-flight delivery/options locks without waiting for the abandoned TV game', () => {
  const { store, room, start } = fixture('bowling', 1);
  const gameId = start();
  store.setGameOptions('tv', { gameId, sport: 'bowling' });
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 1, frame: 1 });
  const roll = { type: 'roll', id: 'delivery', power: .6, aim: 0, spin: 0 };
  assert.equal(store.rollTarget('p1', roll).ok, true);
  assert.equal(store.returnToLobby('p1', { gameId }, 'player').ok, true);
  const nextId = start();
  store.setGameOptions('tv', { gameId: nextId, sport: 'bowling' });
  store.setGameState('tv', { gameId: nextId, phase: 'ready', currentPlayer: 1, frame: 1 });
  assert.equal(store.rollTarget('p1', roll).ok, true);
  store.finishRollDelivery(room.code, roll.id, gameId);
  assert.equal(store.rollTarget('p1', { ...roll, id: 'another-delivery' }).error, 'not-ready-to-roll');
  store.finishRollDelivery(room.code, roll.id, nextId);
  assert.equal(store.gameCommandTarget('p1', { gameId: nextId, id: 'restart', action: 'new-match' }).ok, true);
  assert.equal(store.returnToLobby('tv', { gameId: nextId }).ok, true);
  assert.equal(store.lobby(room.code).gameOptions, null);
  const thirdId = start();
  store.setGameOptions('tv', { gameId: thirdId, sport: 'bowling' });
  store.setGameState('tv', { gameId: thirdId, phase: 'ready', currentPlayer: 1, frame: 1 });
  assert.equal(store.gameCommandTarget('p1', { gameId: thirdId, id: 'restart', action: 'new-match' }).ok, true);
  store.finishGameCommand(room.code, 'restart', nextId);
  assert.equal(store.rollTarget('p1', roll).error, 'game-command-pending');
  store.finishGameCommand(room.code, 'restart', thirdId);
  assert.equal(store.rollTarget('p1', roll).ok, true);
});

const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
function snapshot(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(EVENTS.LOBBY_UPDATE, handler); reject(new Error('Missing lobby update')); }, 2000);
    const handler = lobby => { if (predicate(lobby)) { clearTimeout(timer); socket.off(EVENTS.LOBBY_UPDATE, handler); resolve(lobby); } };
    socket.on(EVENTS.LOBBY_UPDATE, handler);
  });
}

test('real sockets: both return events broadcast to their room, survive TV reconnect, and reject P2/stale games', async t => {
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
  const tv = await connect(), p1 = await connect(), p2 = await connect(), otherTv = await connect();
  const room = await send(tv, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
  const other = await send(otherTv, EVENTS.HOST_CREATE, { v, sport: 'bowling' });
  for (const [i, phone] of [p1, p2].entries()) {
    await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: `Player ${i + 1}` });
    await send(phone, EVENTS.PLAYER_SETUP, { setup: 'motion' });
  }
  async function start(host = tv) {
    await send(p1, EVENTS.PLAYER_READY, { ready: true }); await send(p2, EVENTS.PLAYER_READY, { ready: true });
    await send(host, EVENTS.HOST_CALIBRATION_DONE, {});
    now += 5000; store.finishCountdown(room.code);
    now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    return store.lobby(room.code).gameId;
  }
  const gameId = await start();
  assert.equal((await send(p2, EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId })).error, 'not-game-leader');
  assert.equal((await send(p1, EVENTS.HOST_RETURN_TO_LOBBY, { gameId })).error, 'not-host');
  assert.equal((await send(otherTv, EVENTS.HOST_RETURN_TO_LOBBY, { gameId })).error, 'not-playing');
  const paused = snapshot(p1, state => state.paused); tv.disconnect(); await paused;
  const returned = snapshot(p2, state => state.phase === PHASES.READY);
  assert.deepEqual(await send(p1, EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId }), { ok: true, code: room.code });
  const lobby = await returned;
  assert.equal(lobby.players.length, 2); assert.equal(lobby.players[0].setup, 'motion'); assert.equal(lobby.gameId, null);
  assert.equal(lobby.paused, true); assert.equal(store.lobby(other.code).phase, PHASES.LOBBY);
  const tvBack = await connect();
  assert.equal((await send(tvBack, EVENTS.SESSION_RESUME, { v, code: room.code, role: 'host', token: room.token })).phase, PHASES.READY);
  const nextId = await start(tvBack);
  assert.equal((await send(p1, EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId })).error, 'not-playing');
  const hostReturned = snapshot(p1, state => state.phase === PHASES.READY);
  assert.deepEqual(await send(tvBack, EVENTS.HOST_RETURN_TO_LOBBY, { gameId: nextId }), { ok: true, code: room.code });
  assert.equal((await hostReturned).players[1].setup, 'motion');
});
