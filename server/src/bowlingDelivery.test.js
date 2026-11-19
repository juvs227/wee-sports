import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {io} from 'socket.io-client';
import {EVENTS, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {DIAGNOSTICS_PROBE} from '../../shared/diagnostics.js';
import {createGameServer} from './app.js';
import {RoomStore} from './RoomStore.js';

const send = (socket, event, data = {}) => socket.timeout(3500).emitWithAck(event, data);
async function fixture(t, transport = 'websocket', count = 1) {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10}), clients = [];
  t.after(async () => {for (const client of clients) client.disconnect(); await app.close();});
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const connect = async () => {
    const client = io(`http://127.0.0.1:${app.http.address().port}`, {transports: [transport], reconnection: false});
    clients.push(client); await once(client, 'connect'); return client;
  };
  const tv = await connect(), phones = [], seats = [];
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling'});
  for (let index = 0; index < count; index++) {
    const phone = await connect(); phones.push(phone);
    seats.push(await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: `P${index + 1}`}));
  }
  for (const phone of phones) {
    assert.equal((await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'})).ok, true);
    assert.equal((await send(phone, EVENTS.PLAYER_READY, {ready: true})).ok, true);
  }
  assert.equal((await send(phones[0], EVENTS.PLAYER_START)).ok, true);
  now += 5000; store.finishCountdown(room.code);
  const gameId = store.lobby(room.code).gameId;
  assert.equal(store.setGameState(tv.id, {gameId, phase: 'ready', currentPlayer: 1, frame: 1}).ok, true);
  const roll = id => {
    const state = store.lobby(room.code);
    return {type: 'roll', id, gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch, power: .7, aim: .2, spin: -.1};
  };
  const host = app.io.sockets.sockets.get(tv.id);
  const release = () => {host.conn.transport.writable = true; host.conn.flush();};
  return {app, store, tv, phones, phone: phones[0], room, seats, gameId, roll, connect, host, release};
}

function onInput(store, id) {
  return new Promise(resolve => {
    const original = store.rollTarget.bind(store);
    store.rollTarget = (...args) => {
      const result = original(...args);
      if (args[1]?.id === id) {store.rollTarget = original; resolve(result);}
      return result;
    };
  });
}

for (const transport of ['websocket', 'polling']) {
  test(`${transport}: all eight bowling players receive their own releases once without a queue`, async t => {
    const {tv, phones, gameId, roll} = await fixture(t, transport, 8);
    const received = [], roundTrips = [];
    tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event); ack({ok: true});});
    for (let turn = 0; turn < 16; turn++) {
      const player = turn % 8 + 1;
      assert.equal((await send(tv, EVENTS.HOST_GAME_STATE, {gameId, phase: 'ready', currentPlayer: player, frame: Math.floor(turn / 8) + 1})).ok, true);
      const start = performance.now();
      assert.equal((await send(phones[player - 1], EVENTS.PLAYER_ROLL, roll(`turn-${turn}`))).ok, true);
      roundTrips.push(performance.now() - start);
    }
    assert.deepEqual(received.map(event => event.player), Array.from({length: 16}, (_, turn) => turn % 8 + 1));
    assert.equal(new Set(received.map(event => event.id)).size, 16);
    for (const phone of phones) assert.deepEqual(phone.sendBuffer, []);
    roundTrips.sort((a, b) => a - b);
    t.diagnostic(`16/16 once across eight players; median=${roundTrips[8].toFixed(2)}ms, max=${roundTrips[15].toFixed(2)}ms (local relay only)`);
  });
}

test('a blocked TV transport rejects the release, unlocks the lane, and never replays it on recovery', async t => {
  const {tv, phone, store, room, gameId, roll, host, release} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event.id); ack({ok: true});});
  host.conn.transport.writable = false;
  const before = performance.now();
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('blocked'))).error, 'network-busy');
  assert.ok(performance.now() - before < 1000, 'reject promptly instead of waiting for the 2.5-second game acknowledgement');
  assert.equal(store.actionStatus(phone.id, {id: 'blocked', gameId}).status, 'rejected');
  assert.equal(store.actionStatus(phone.id, {id: 'blocked', gameId}).result.error, 'network-busy');
  assert.equal(store.setPaused(tv.id, {gameId, paused: true}).ok, true, 'failed delivery releases the reservation');
  assert.equal(store.setPaused(tv.id, {gameId, paused: false}).ok, true);
  release();
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('fresh'))).ok, true);
  assert.deepEqual(received, ['fresh']);
  assert.equal(store.lobby(room.code).paused, false);
});

test('a brief TV write stall keeps one current release without permitting a queued burst', async t => {
  const {tv, phone, store, roll, host, release} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event.id); ack({ok: true});});
  host.conn.transport.writable = false;
  const waiting = onInput(store, 'current');
  const pending = send(phone, EVENTS.PLAYER_ROLL, roll('current'));
  await waiting;
  const excess = await Promise.all(Array.from({length: 6}, (_, i) => send(phone, EVENTS.PLAYER_ROLL, roll(`excess-${i}`))));
  assert.ok(excess.every(result => result.error === 'network-busy'));
  release();
  assert.equal((await pending).ok, true);
  assert.deepEqual(received, ['current']);
});

test('setup loss and recovery cancel a waiting release even when the game is already unpaused', async t => {
  const {tv, phone, store, gameId, roll, host, release} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event.id); ack({ok: true});});
  host.conn.transport.writable = false;
  const waiting = onInput(store, 'before-pause');
  const pending = send(phone, EVENTS.PLAYER_ROLL, roll('before-pause'));
  await waiting;
  assert.equal(store.setSetup(phone.id, {setup: null}).ok, true);
  assert.equal(store.setSetup(phone.id, {setup: 'buttons'}).ok, true);
  release();
  assert.equal((await pending).error, 'not-playing');
  assert.equal(store.actionStatus(phone.id, {id: 'before-pause', gameId}).status, 'rejected');
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('after-pause'))).ok, true);
  assert.deepEqual(received, ['after-pause']);
});

for (const change of ['turn', 'frame', 'phase']) {
  test(`a changed bowling ${change} invalidates a release waiting for the TV`, async t => {
    const {tv, phones, phone, store, gameId, roll, host, release} = await fixture(t, 'websocket', 8);
    const received = [];
    tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event); ack({ok: true});});
    host.conn.transport.writable = false;
    const waiting = onInput(store, 'before-change');
    const pending = send(phone, EVENTS.PLAYER_ROLL, roll('before-change'));
    await waiting;
    const currentPlayer = change === 'turn' ? 8 : 1;
    assert.equal(store.setGameState(tv.id, {gameId, phase: change === 'phase' ? 'rolling' : 'ready', currentPlayer, frame: change === 'frame' ? 2 : 1}).ok, true);
    release();
    assert.equal((await pending).error, 'not-playing');
    assert.deepEqual(received, []);
    assert.equal(store.setGameState(tv.id, {gameId, phase: 'ready', currentPlayer, frame: 2}).ok, true);
    assert.equal((await send(phones[currentPlayer - 1], EVENTS.PLAYER_ROLL, roll('after-change'))).ok, true);
    assert.equal(received[0].player, currentPlayer);
  });
}

for (const role of ['host', 'player']) {
  test(`a replacement ${role} session cancels a waiting bowling release`, async t => {
    const {tv, phone, store, room, seats, roll, host, release, connect} = await fixture(t);
    const replacement = await connect(), received = [];
    for (const client of [tv, replacement]) client.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event.id); ack({ok: true});});
    host.conn.transport.writable = false;
    const waiting = onInput(store, 'before-replacement');
    const pending = send(phone, EVENTS.PLAYER_ROLL, roll('before-replacement'));
    await waiting;
    assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code: room.code, role, token: role === 'host' ? room.token : seats[0].token})).ok, true);
    release();
    assert.equal((await pending).ok, false);
    assert.deepEqual(received, []);
  });
}

test('returning to the lobby cancels a waiting bowling release', async t => {
  const {tv, phone, store, gameId, roll, host, release} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_ROLL, (event, ack) => {received.push(event.id); ack({ok: true});});
  host.conn.transport.writable = false;
  const waiting = onInput(store, 'before-lobby');
  const pending = send(phone, EVENTS.PLAYER_ROLL, roll('before-lobby'));
  await waiting;
  assert.equal(store.returnToLobby(tv.id, {gameId}).ok, true);
  release();
  assert.equal((await pending).error, 'not-playing');
  assert.deepEqual(received, []);
});

test('a delivered ball with a lost game acknowledgement stays unknown and is never retried', async t => {
  const {tv, phone, store, gameId, roll, release} = await fixture(t);
  const received = [];
  tv.on(EVENTS.GAME_ROLL, event => {received.push(event.id);});
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('unknown'))).error, 'outcome-unknown');
  assert.equal(store.actionStatus(phone.id, {id: 'unknown', gameId}).status, 'unknown');
  release(); await delay(20);
  assert.deepEqual(received, ['unknown']);
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('unknown'))).error, 'duplicate-roll');
  tv.off(EVENTS.GAME_ROLL); tv.on(EVENTS.GAME_ROLL, (_event, ack) => ack({ok: true}));
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('next'))).ok, true);
});

test('opt-in bowling diagnostics separate transport wait, game acknowledgement and rejection', async t => {
  const {tv, phone, roll, host, release} = await fixture(t);
  assert.equal((await send(phone, DIAGNOSTICS_PROBE, {enabled: true})).ok, true);
  tv.on(EVENTS.GAME_ROLL, (_event, ack) => ack({ok: true}));
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('diagnostic-accepted'))).ok, true);
  host.conn.transport.writable = false;
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll('diagnostic-blocked'))).error, 'network-busy');
  release();
  await delay(1000);
  const report = await send(phone, DIAGNOSTICS_PROBE, {enabled: true});
  assert.equal(report.ok, true);
  assert.equal(report.diagnostics.counters['roll.accepted'], 1);
  assert.equal(report.diagnostics.counters['roll.transportDropped'], 1);
  assert.equal(report.diagnostics.timings['roll.transportWaitMs'].count, 2);
  assert.equal(report.diagnostics.timings['roll.relayRoundTripMs'].count, 1);
});
