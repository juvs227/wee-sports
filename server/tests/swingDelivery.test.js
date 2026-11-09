import {test} from 'vitest';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v, VOTE_SECONDS} from '@wee/shared/protocol.js';
import {sendSwingRequest} from '@wee/src/network/swingRequest.js';
import {createGameServer} from '@server/src/app.js';
import {RoomStore} from '@server/src/RoomStore.js';

const send = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, data);
async function fixture(t, transport = 'websocket') {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10});
  const clients = [];
  t.onTestFinished(async () => { for (const client of clients) client.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const connect = async () => {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, {transports: [transport], reconnection: false});
    clients.push(client); await once(client, 'connect'); return client;
  };
  const tv = await connect(), phone = await connect();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'tennis'});
  const seat = await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'P1'});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  const start = async () => {
    await send(phone, EVENTS.PLAYER_READY, {ready: true});
    await send(tv, EVENTS.HOST_CALIBRATION_DONE, {});
    now += 5000; store.finishCountdown(room.code);
    now += VOTE_SECONDS * 1000; store.expireVote(room.code);
    return store.lobby(room.code).gameId;
  };
  const gameId = await start();
  const stroke = (id, game = gameId) => ({type: 'swing', id, gameId: game, label: 'Forehand', hand: 'Right', power: .5});
  return {app, store, tv, phone, room, seat, gameId, start, stroke, connect};
}

function onInput(store, id) {
  return new Promise(resolve => {
    const original = store.swingTarget.bind(store);
    store.swingTarget = (...args) => {
      const result = original(...args);
      if (args[1]?.id === id) { store.swingTarget = original; resolve(result); }
      return result;
    };
  });
}

for (const transport of ['websocket', 'polling']) {
  test(`${transport}: sustained healthy swings are delivered once without third-input slowdown`, {timeout: 40000}, async t => {
    const {tv, phone, gameId, stroke} = await fixture(t, transport);
    const received = [], roundTrips = [];
    tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event.id); ack({ok: true}); });
    // Includes a heartbeat interval; normal TV state broadcasts run beside input.
    for (let index = 0; index < 104; index++) {
      await delay(250);
      const status = send(tv, EVENTS.HOST_GAME_STATE, {gameId, phase: index % 2 ? 'rally' : 'serve', server: 1, winner: null});
      const started = performance.now();
      const result = await sendSwingRequest(phone, EVENTS.PLAYER_SWING, stroke(`stroke-${index}`));
      roundTrips.push(performance.now() - started);
      assert.equal(result.ok, true, `${transport} swing ${index + 1}: ${result.error}`);
      await status;
    }
    assert.equal(received.length, 104); assert.equal(new Set(received).size, 104);
    assert.deepEqual(phone.sendBuffer, []);
    const ordered = [...roundTrips].sort((a, b) => a - b);
    console.log(`${transport}: 104/104 once; median=${ordered[52].toFixed(2)}ms, p95=${ordered[98].toFixed(2)}ms; third=${roundTrips[2].toFixed(2)}ms; last=${roundTrips.at(-1).toFixed(2)}ms (local relay only)`);
  });
}

test('a blocked TV transport rejects input instead of releasing old swings after recovery', async t => {
  const {app, tv, phone, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('blocked'))).error, 'network-busy');
  transport.writable = true;
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('fresh'))).ok, true);
  assert.deepEqual(received.map(event => event.id), ['fresh']);
});

test('pause and resume during a brief transport wait cancels the old swing', async t => {
  const {app, store, tv, phone, gameId, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-pause');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-pause'));
  await waiting;
  assert.equal(store.setPaused(tv.id, {gameId, paused: true}, 'host').ok, true);
  assert.equal(store.setPaused(tv.id, {gameId, paused: false}, 'host').ok, true);
  transport.writable = true;
  assert.equal((await pending).error, 'not-playing');
  assert.deepEqual(received, []);
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('after-resume'))).ok, true);
});

test('Play again invalidates a waiting swing even when the lobby game id is retained', async t => {
  const {app, store, tv, phone, gameId, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  assert.equal(store.setGameOptions(tv.id, {gameId, sport: 'tennis', settings: {
    assistance: 'standard', botDifficulty: 'standard', autoMove: true, timingAssist: true, splitView: true, format: 'full',
  }, practice: {active: false, stroke: 'alternate', hand: 'Right'}, humanOpponent: false}).ok, true);
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-replay');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-replay'));
  await waiting;
  const reset = store.gameCommandTarget(phone.id, {id: 'replay', gameId, action: 'new-match', format: 'full'});
  assert.equal(reset.ok, true);
  store.finishGameCommand(reset.code, reset.event.id, gameId);
  transport.writable = true;
  assert.equal((await pending).error, 'not-playing');
  assert.deepEqual(received, []);
});

test('server retains at most one waiting swing for a phone rather than releasing a queued burst', async t => {
  const {app, store, tv, phone, stroke} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event.id); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'waiting');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('waiting'));
  await waiting;
  const excess = await Promise.all(Array.from({length: 12}, (_, i) => send(phone, EVENTS.PLAYER_SWING, stroke(`excess-${i}`))));
  assert.ok(excess.every(result => result.error === 'network-busy'));
  transport.writable = true;
  assert.equal((await pending).ok, true);
  assert.deepEqual(received, ['waiting']);
});

for (const role of ['host', 'player']) test(`session replacement cancels waiting input from the old ${role} socket`, async t => {
  const {app, store, tv, phone, room, seat, stroke, connect} = await fixture(t);
  const replacement = await connect();
  const received = [];
  for (const client of [tv, replacement]) client.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); ack({ok: true}); });
  const transport = app.io.sockets.sockets.get(tv.id).conn.transport;
  transport.writable = false;
  const waiting = onInput(store, 'before-replacement');
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('before-replacement'));
  await waiting;
  assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code: room.code, role, token: role === 'host' ? room.token : seat.token})).ok, true);
  transport.writable = true;
  assert.equal((await pending).ok, false);
  assert.deepEqual(received, []);
});

test('old lobby swings and their late delivery replies cannot enter a replacement game', async t => {
  const {tv, phone, room, gameId, start, stroke} = await fixture(t);
  let acknowledge;
  const received = [];
  tv.on(EVENTS.GAME_SWING, (event, ack) => { received.push(event); acknowledge = ack; });
  const arrived = once(tv, EVENTS.GAME_SWING);
  const pending = send(phone, EVENTS.PLAYER_SWING, stroke('old-delivery'));
  await arrived;
  await send(tv, EVENTS.HOST_RETURN_TO_LOBBY, {gameId});
  const next = await start();
  acknowledge({ok: true});
  assert.equal((await pending).error, 'not-playing');
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('late-old-input'))).error, 'not-playing');
  assert.equal(received.length, 1);
  tv.off(EVENTS.GAME_SWING); tv.on(EVENTS.GAME_SWING, (_event, ack) => ack({ok: true}));
  assert.equal((await send(phone, EVENTS.PLAYER_SWING, stroke('new-input', next))).ok, true);
  assert.equal((await send(tv, EVENTS.LOBBY_GET, {code: room.code})).gameId, next);
});
