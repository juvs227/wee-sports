import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION as v, VOTE_SECONDS, isGameCommand, isGameOptions } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';
import { createGameServer } from './app.js';

const tennisOptions = gameId => ({ gameId, sport: 'tennis', settings: {
  assistance: 'standard', botDifficulty: 'standard', autoMove: true,
  timingAssist: true, splitView: true, format: 'full',
}, practice: { active: false, stroke: 'alternate', hand: 'Right' }, humanOpponent: false });
function fixture(sport = 'tennis', count = 1) {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const room = store.createRoom('tv', { v, sport });
  const seats = Array.from({ length: count }, (_, index) => store.join(`p${index + 1}`, { v, code: room.code, name: `P${index + 1}` }));
  for (let index = 0; index < count; index++) {
    store.setSetup(`p${index + 1}`, { setup: 'buttons' });
    store.setReady(`p${index + 1}`, { ready: true });
  }
  now += 5000; store.finishCountdown(room.code); now += VOTE_SECONDS * 1000; store.expireVote(room.code);
  const gameId = store.lobby(room.code).gameId;
  const options = sport === 'tennis' ? tennisOptions(gameId) : { gameId, sport };
  const command = (id = 'command-1', extra = {}) => ({ id, gameId, action: 'new-match', ...(sport === 'tennis' ? { format: 'full' } : {}), ...extra });
  return { store, room, seats, gameId, options, command };
}

test('game command validators expose only bounded supported controls', () => {
  const base = { id: 'setting-1', gameId: 'match-1', action: 'configure', settings: { assistance: 'beginner' } };
  assert.equal(isGameCommand(base, 'tennis'), true);
  for (const change of [null, [], {}, { ...base, id: '' }, { ...base, gameId: 'x'.repeat(101) },
    { ...base, action: 'close-lobby' }, { ...base, code: 'OTHER' }, { ...base, settings: [] },
    { ...base, settings: {} }, { ...base, settings: { autoMove: 1 } },
    { ...base, settings: { gravity: 0 } }, { ...base, settings: { assistance: 'expert' } },
    { ...base, settings: JSON.parse('{"__proto__":true}') }]) {
    assert.equal(isGameCommand(change, 'tennis'), false);
  }
  assert.equal(isGameCommand({ ...base, settings: { autoMove: false, timingAssist: true, splitView: false, botDifficulty: 'beginner' } }, 'tennis'), true);
  assert.equal(isGameCommand({ id: '1', gameId: 'game', action: 'practice-start', stroke: 'forehand', hand: 'Left' }, 'tennis'), true);
  assert.equal(isGameCommand({ id: '1', gameId: 'game', action: 'practice-stop' }, 'tennis'), true);
  assert.equal(isGameCommand({ id: '1', gameId: 'game', action: 'new-match' }, 'bowling'), true);
  assert.equal(isGameCommand({ id: '1', gameId: 'game', action: 'new-match', format: 'quick' }, 'bowling'), false);
  assert.equal(isGameOptions(tennisOptions('game'), 'tennis'), true);
  assert.equal(isGameOptions({ ...tennisOptions('game'), settings: { format: 'full' } }, 'tennis'), false);
  assert.equal(isGameOptions({ ...tennisOptions('game'), sport: 'bowling' }, 'tennis'), false);
});

test('P1 commands route only to their current TV and cannot be replayed after failure or reconnect', () => {
  const { store, room, seats, options, command } = fixture();
  assert.equal(store.gameCommandTarget('p1', command()).error, 'game-loading');
  store.setGameOptions('tv', options);
  assert.equal(store.gameCommandTarget('tv', command()).error, 'not-game-leader');
  assert.equal(store.gameCommandTarget('stranger', command()).error, 'not-game-leader');
  assert.equal(store.gameCommandTarget('p1', command('stale', { gameId: 'previous-game' })).error, 'not-playing');
  assert.equal(store.gameCommandTarget('p1', command('forged', { code: 'OTHER' })).error, 'bad-game-command');
  const delivered = store.gameCommandTarget('p1', command());
  assert.equal(delivered.hostSocketId, 'tv');
  assert.deepEqual(delivered.event, command());
  assert.equal(store.gameCommandTarget('p1', command()).error, 'duplicate-command');
  assert.equal(store.gameCommandTarget('p1', command('another')).error, 'game-command-pending');
  store.finishGameCommand(room.code, 'unrelated', options.gameId);
  assert.equal(store.gameCommandTarget('p1', command('another')).error, 'game-command-pending');
  store.finishGameCommand(room.code, command().id, options.gameId);
  store.disconnect('p1');
  store.resume('phone-new', { v, code: room.code, token: seats[0].token, role: 'player' });
  assert.equal(store.gameCommandTarget('p1', command('another')).error, 'not-game-leader');
  assert.equal(store.gameCommandTarget('phone-new', command()).error, 'duplicate-command');
  store.resume('tv-new', { v, code: room.code, token: room.token, role: 'host' });
  assert.equal(store.gameCommandTarget('phone-new', command('another')).hostSocketId, 'tv-new');
});

test('pause, other seats and human opponents cannot bypass game-option restrictions', () => {
  const { store, gameId, options } = fixture('tennis', 2);
  store.setGameOptions('tv', options);
  const command = (id, action, extra = {}) => ({ id, gameId, action, ...extra });
  const simple = command('move', 'configure', { settings: { timingAssist: false } });
  assert.equal(store.gameCommandTarget('p2', simple).error, 'not-game-leader');
  assert.equal(store.gameCommandTarget('p1', command('practice', 'practice-start', { stroke: 'alternate', hand: 'Right' })).error, 'solo-only');
  assert.equal(store.gameCommandTarget('p1', command('bot', 'configure', { settings: { botDifficulty: 'beginner' } })).error, 'solo-only');
  assert.equal(store.gameCommandTarget('p1', command('view', 'configure', { settings: { splitView: false } })).error, 'solo-only');
  store.setSetup('p2', { setup: null });
  assert.equal(store.gameCommandTarget('p1', simple).error, 'paused');
  store.setSetup('p2', { setup: 'buttons' });
  assert.equal(store.gameCommandTarget('p1', simple).ok, true);
});

test('bowling cannot restart a rolling ball and retains the last applied options', () => {
  const { store, room, gameId, options, command } = fixture('bowling');
  store.setGameOptions('tv', options);
  store.setGameState('tv', { gameId, phase: 'rolling', currentPlayer: 1, frame: 1 });
  assert.equal(store.gameCommandTarget('p1', command()).error, 'ball-in-play');
  store.setGameState('tv', { gameId, phase: 'complete', currentPlayer: null, frame: 10 });
  assert.equal(store.gameCommandTarget('p1', command()).ok, true);
  assert.deepEqual(store.lobby(room.code).gameOptions, options);
});

test('bowling serializes a new game and a release in either arrival order', () => {
  const { store, room, gameId, options, command } = fixture('bowling');
  store.setGameOptions('tv', options);
  store.setGameState('tv', { gameId, phase: 'ready', currentPlayer: 1, frame: 1 });
  const roll = { type: 'roll', id: 'roll-1', power: 0.5, spin: 0, aim: 0 };
  assert.equal(store.gameCommandTarget('p1', command()).ok, true);
  assert.equal(store.rollTarget('p1', roll).error, 'game-command-pending');
  store.finishGameCommand(room.code, command().id, gameId);
  assert.equal(store.rollTarget('p1', roll).ok, true);
  assert.equal(store.gameCommandTarget('p1', command('new-game-2')).error, 'ball-in-play');
  store.finishRollDelivery(room.code, roll.id, gameId);
  assert.equal(store.gameCommandTarget('p1', command('new-game-2')).ok, true);
});

test('only the current TV can publish sanitized current-match options; unchanged values do not rebroadcast', () => {
  const { store, room, options } = fixture('tennis', 2);
  assert.equal(store.setGameOptions('p1', options).error, 'not-host');
  assert.equal(store.setGameOptions('unknown', options).error, 'not-host');
  assert.equal(store.setGameOptions('tv', { ...options, gameId: 'stale' }).error, 'not-playing');
  assert.equal(store.setGameOptions('tv', { ...options, practice: { active: false } }).error, 'bad-game-options');
  const payload = { ...options, secret: 'discard', settings: { ...options.settings, arbitrary: 'discard' }, practice: { ...options.practice, extra: 'discard' } };
  assert.equal(store.setGameOptions('tv', payload).changed, true);
  assert.deepEqual(store.lobby(room.code).gameOptions, { ...options, humanOpponent: true });
  assert.equal(store.setGameOptions('tv', payload).changed, false);
  store.resume('new-tv', { v, code: room.code, token: room.token, role: 'host' });
  assert.equal(store.setGameOptions('tv', options).error, 'not-host');
  assert.equal(store.setGameOptions('new-tv', options).ok, true);
  store.remove('p2');
  assert.equal(store.lobby(room.code).gameOptions, null);
});

test('real sockets deliver actual game results, publish applied settings and isolate lobbies', async t => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const app = createGameServer({ store });
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await app.close(); });
  const send = (client, event, payload) => client.timeout(3500).emitWithAck(event, payload);
  async function connect() {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, { transports: ['websocket'], reconnection: false });
    clients.push(client); await once(client, 'connect'); return client;
  }
  async function game() {
    const tv = await connect(), phone = await connect();
    const room = await send(tv, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
    await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: 'Player' });
    await send(phone, EVENTS.PLAYER_SETUP, { setup: 'buttons' });
    await send(phone, EVENTS.PLAYER_READY, { ready: true });
    now += 5000; store.finishCountdown(room.code); now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    const gameId = store.lobby(room.code).gameId;
    await send(tv, EVENTS.HOST_GAME_OPTIONS, tennisOptions(gameId));
    return { tv, phone, room, gameId };
  }
  const one = await game(), other = await game();
  const received = [], unrelated = [];
  other.tv.on(EVENTS.GAME_COMMAND, (command, ack) => { unrelated.push(command); ack({ ok: true }); });
  one.tv.on(EVENTS.GAME_COMMAND, (command, ack) => { received.push(command); ack({ ok: false, error: 'solo-only' }); });
  const command = id => ({ id, gameId: one.gameId, action: 'configure', settings: { assistance: 'beginner' } });
  assert.equal((await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, { ...command('wrong-room'), gameId: other.gameId })).error, 'not-playing');
  assert.equal((await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, command('rejected'))).error, 'solo-only');
  assert.equal((await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, command('rejected'))).error, 'duplicate-command');
  one.tv.off(EVENTS.GAME_COMMAND);
  one.tv.on(EVENTS.GAME_COMMAND, async (event, ack) => {
    received.push(event);
    const options = tennisOptions(one.gameId); options.settings.assistance = 'beginner';
    await send(one.tv, EVENTS.HOST_GAME_OPTIONS, options);
    ack({ ok: true });
  });
  const updated = new Promise(resolve => {
    const listener = snapshot => {
      if (snapshot.gameOptions?.settings.assistance === 'beginner') { one.phone.off(EVENTS.LOBBY_UPDATE, listener); resolve(snapshot); }
    };
    one.phone.on(EVENTS.LOBBY_UPDATE, listener);
  });
  assert.deepEqual(await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, command('applied')), { ok: true, id: 'applied' });
  assert.equal((await updated).gameOptions.settings.assistance, 'beginner');
  assert.equal(received.length, 2); assert.equal(unrelated.length, 0);
  one.tv.off(EVENTS.GAME_COMMAND);
  assert.equal((await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, command('timed-out'))).error, 'game-loading');
  assert.equal((await send(one.phone, EVENTS.PLAYER_GAME_COMMAND, command('timed-out'))).error, 'duplicate-command');
});
