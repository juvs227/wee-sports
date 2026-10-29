import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION, isTennisHit } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';
import { createGameServer } from './app.js';

const v = PROTOCOL_VERSION;
const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);

// Each fixture has one human phone only; the unoccupied tennis seat is the bot.
function game(sport = 'tennis') {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const host = store.createRoom('tv', { v, sport });
  const phone = store.join('phone', { v, code: host.code, name: 'Player' });
  store.setSetup('phone', { setup: 'motion' });
  store.setReady('phone', { ready: true });
  store.start('tv');
  now = 5000;
  store.finishCountdown(host.code);
  const hit = { id: 'contact-one', gameId: store.lobby(host.code).gameId, player: 1 };
  return { store, host, phone, hit, advance: milliseconds => { now += milliseconds; } };
}

test('hit feedback resolves one live phone, strips extra fields, and ignores the bot seat', () => {
  const { store, host, hit } = game();
  const result = store.hitTarget('tv', { ...hit, token: 'must-not-leak', code: 'ZZZZ', phoneSocketId: 'outsider' });
  assert.deepEqual(result, { ok: true, phoneSocketId: 'phone', event: { ...hit, kind: 'tennis' } });
  assert.equal(store.hitTarget('tv', { ...hit, id: 'bot-contact', player: 2 }).error, 'not-controller');
  assert.equal(JSON.stringify(store.lobby(host.code)).includes('must-not-leak'), false);
});

test('hit feedback rejects wrong identities, phases, sport, game IDs and malformed values', () => {
  const { store, host, hit } = game();
  assert.equal(store.hitTarget('unknown', hit).error, 'not-host');
  assert.equal(store.hitTarget('phone', hit).error, 'not-host');
  store.createRoom('intruder-tv', { v, sport: 'tennis' });
  assert.equal(store.hitTarget('intruder-tv', { ...hit, code: host.code }).error, 'not-playing');
  assert.equal(store.hitTarget('tv', { ...hit, gameId: 'old-match' }).error, 'not-playing');
  for (const event of [null, {}, { ...hit, id: '' }, { ...hit, id: 'x'.repeat(101) },
    { ...hit, gameId: 'x'.repeat(101) }, { ...hit, player: 0 }, { ...hit, player: 3 },
    { ...hit, player: 1.5 }, { ...hit, player: '1' }]) {
    assert.equal(isTennisHit(event), false);
    assert.equal(store.hitTarget('tv', event).error, 'bad-hit');
  }
  const bowling = game('bowling');
  assert.equal(bowling.store.hitTarget('tv', bowling.hit).error, 'not-playing');
  const lobby = new RoomStore();
  lobby.createRoom('tv', { v, sport: 'tennis' });
  assert.equal(lobby.hitTarget('tv', hit).error, 'not-playing');
});

test('hit feedback rejects replay, bursts, pauses and the replaced host socket', () => {
  const { store, host, phone, hit, advance } = game();
  assert.equal(store.hitTarget('tv', hit).ok, true);
  assert.equal(store.hitTarget('tv', { ...hit, id: 'too-soon' }).error, 'hit-rate-limited');
  advance(200);
  assert.equal(store.hitTarget('tv', hit).error, 'duplicate-hit');
  assert.equal(store.hitTarget('tv', { ...hit, id: 'next-contact' }).ok, true);
  store.disconnect('phone');
  advance(200);
  assert.equal(store.hitTarget('tv', { ...hit, id: 'while-away' }).error, 'paused');
  assert.equal(store.resume('phone', { v, code: host.code, token: phone.token, role: 'player' }).ok, true);
  assert.equal(store.resume('replacement-tv', { v, code: host.code, token: host.token, role: 'host' }).ok, true);
  assert.equal(store.hitTarget('tv', { ...hit, id: 'old-host' }).error, 'not-host');
  assert.equal(store.hitTarget('replacement-tv', { ...hit, id: 'new-contact' }).ok, true);
  store.setSetup('phone', { setup: null });
  assert.equal(store.hitTarget('replacement-tv', { ...hit, id: 'missing-setup' }).error, 'paused');
});

test('real socket feedback goes only to the one phone and never queues across reconnect', async t => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const app = createGameServer({ store, tickMs: 100000 });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  const url = `http://127.0.0.1:${app.http.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await app.close(); });
  async function client() {
    const socket = io(url, { transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  }
  const host = await client(), phone = await client(), intruderHost = await client();
  const room = await send(host, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
  await send(intruderHost, EVENTS.HOST_CREATE, { v, sport: 'tennis' });
  const seat = await send(phone, EVENTS.PLAYER_JOIN, { v, code: room.code, name: 'Player' });
  await send(phone, EVENTS.PLAYER_SETUP, { setup: 'motion' });
  await send(phone, EVENTS.PLAYER_READY, { ready: true });
  await send(host, EVENTS.HOST_START);
  now = 5000; store.finishCountdown(room.code);
  const hit = { id: 'actual-contact', gameId: store.lobby(room.code).gameId, player: 1 };
  const phoneHits = [], leakedHits = [];
  phone.on(EVENTS.GAME_HIT, event => phoneHits.push(event));
  host.on(EVENTS.GAME_HIT, event => leakedHits.push(event));
  intruderHost.on(EVENTS.GAME_HIT, event => leakedHits.push(event));
  const first = once(phone, EVENTS.GAME_HIT, { signal: AbortSignal.timeout(2000) });
  assert.deepEqual(await send(host, EVENTS.HOST_GAME_HIT, { ...hit, token: 'private', code: 'ZZZZ' }), { ok: true });
  assert.deepEqual((await first)[0], { ...hit, kind: 'tennis' });
  assert.equal((await send(intruderHost, EVENTS.HOST_GAME_HIT, hit)).ok, false);
  assert.equal((await send(phone, EVENTS.HOST_GAME_HIT, hit)).error, 'not-host');
  assert.equal((await send(host, EVENTS.HOST_GAME_HIT, hit)).error, 'duplicate-hit');
  assert.equal((await send(host, EVENTS.HOST_GAME_HIT, { ...hit, player: 99 })).error, 'bad-hit');

  const paused = once(host, EVENTS.LOBBY_UPDATE, { signal: AbortSignal.timeout(2000) });
  phone.disconnect(); await paused;
  now += 500;
  assert.equal((await send(host, EVENTS.HOST_GAME_HIT, { ...hit, id: 'during-disconnect' })).error, 'paused');
  const reconnected = once(phone, 'connect', { signal: AbortSignal.timeout(2000) });
  phone.connect(); await reconnected;
  await send(phone, EVENTS.SESSION_RESUME, { v, code: room.code, token: seat.token, role: 'player' });
  const next = once(phone, EVENTS.GAME_HIT, { signal: AbortSignal.timeout(2000) });
  await send(host, EVENTS.HOST_GAME_HIT, { ...hit, id: 'fresh-contact' });
  await next;
  assert.deepEqual(phoneHits.map(event => event.id), ['actual-contact', 'fresh-contact']);
  assert.deepEqual(leakedHits, []);
});
