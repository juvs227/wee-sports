import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {createGameServer} from './app.js';
import {RoomStore} from './RoomStore.js';
import {createEventLimiter} from './eventLimits.js';
import {EVENTS, PROTOCOL_VERSION as v} from '../../shared/protocol.js';


const send = (socket, event, data = {}) => socket.timeout(2000).emitWithAck(event, data);
async function fixture(t, options = {}) {
  let now = 0;
  const store = new RoomStore({now:() => now});
  const app = createGameServer({store, tickMs:10000, ...options});
  const sockets = [];
  t.after(async () => {sockets.forEach(socket => socket.disconnect()); await app.close();});
  app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
  const url = `http://127.0.0.1:${app.http.address().port}`;
  const socket = (config = {}) => {
    const client = io(url, {transports:['websocket'], reconnection:false, forceNew:true, ...config});
    sockets.push(client); return client;
  };
  const connect = async config => {
    const client = socket(config);
    await new Promise((resolve, reject) => {client.once('connect', resolve); client.once('connect_error', reject);});
    return client;
  };
  const playing = async sport => {
    const tv = await connect(), phone = await connect();
    const room = await send(tv, EVENTS.HOST_CREATE, {v, sport});
    await send(phone, EVENTS.PLAYER_JOIN, {v, code:room.code, name:'Player'});
    await send(phone, EVENTS.PLAYER_SETUP, {setup:'buttons'});
    await send(phone, EVENTS.PLAYER_READY, {ready:true, skipTutorial:true});
    await send(phone, EVENTS.PLAYER_START);
    now += 5000; store.finishCountdown(room.code);
    return {tv, phone, room, gameId:store.lobby(room.code).gameId};
  };
  return {app, store, url, socket, connect, playing};
}

for (const transport of ['websocket', 'polling']) test(`${transport}: browser origins are enforced on the handshake and native guests still connect`, async t => {
  const f = await fixture(t, {origins:['https://controller.example']});
  for (const Origin of [f.url, 'https://controller.example', undefined]) {
    const socket = await f.connect({transports:[transport], ...(Origin ? {extraHeaders:{Origin}} : {})});
    assert.equal((await send(socket, EVENTS.HOST_CREATE, {v, sport:'bowling'})).ok, true);
  }
  for (const Origin of ['https://untrusted.example', 'null', f.url + '/forged-path']) {
    const socket = f.socket({transports:[transport], extraHeaders:{Origin}});
    await once(socket, 'connect_error');
    assert.equal(socket.connected, false);
  }
  assert.equal(f.store.roomCount, 3);
});

test('shutdown reports unavailable health, rejects new work and handshakes, and closes once', async t => {
  const f = await fixture(t);
  const tv = await f.connect();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport:'bowling'});
  f.app.beginShutdown();
  for (const path of ['/health', '/api/profile/session', '/']) {
    const response = await fetch(f.url + path);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '5');
    assert.equal(await response.text(), 'server-shutting-down');
  }
  assert.deepEqual(await send(tv, EVENTS.HOST_CLOSE, {code:room.code}), {ok:false,error:'server-shutting-down'});
  assert.equal(f.store.roomCount, 1);
  await once(f.socket(), 'connect_error');
  const closing = f.app.close();
  assert.equal(f.app.close(), closing);
  await closing;
});

test('optional profile readiness is visible without disabling guest health', async t => {
  let available = true;
  const f = await fixture(t, {profiles:{handle:() => false, status:() => ({available})}});
  for (const expected of ['ready', 'unavailable']) {
    const response = await fetch(f.url + '/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-wee-profiles'), expected);
    assert.equal(await response.text(), 'ok');
    available = false;
  }
});

test('unexpected HTTP failures return a redacted response while the server remains healthy', async t => {
  const f = await fixture(t, {requestHandler:async () => {throw new Error('private storage detail');}});
  const response = await fetch(f.url + '/broken');
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Internal server error');
  assert.equal((await fetch(f.url + '/health')).status, 200);
});

test('membership floods are bounded per socket without blocking an eight-player party', async t => {
  const f = await fixture(t);
  const flood = await f.connect();
  const attempts = await Promise.all(Array.from({length:40}, () => send(flood, EVENTS.PLAYER_JOIN, {v, code:'AAAA', name:'Guest'})));
  assert.ok(attempts.some(result => result.error === 'rate-limited'));
  assert.ok(attempts.every(result => ['no-room', 'rate-limited'].includes(result.error)));
  const tv = await f.connect();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport:'bowling'});
  const seats = await Promise.all(Array.from({length:8}, async (_, index) => {
    const phone = await f.connect();
    return send(phone, EVENTS.PLAYER_JOIN, {v, code:room.code, name:`P${index + 1}`});
  }));
  assert.ok(seats.every(seat => seat.ok));
  assert.equal(new Set(seats.map(seat => seat.slot)).size, 8);
});

test('input budgets admit sustained 60 Hz motion and ordinary actions, reject floods, then recover', () => {
  let now = 0;
  const admit = createEventLimiter(() => now);
  for (let frame = 0; frame < 600; frame++) {
    now += 1000 / 60;
    assert.equal(admit(EVENTS.PLAYER_AIM), true);
    if (frame % 15 === 0) assert.equal(admit(EVENTS.PLAYER_SWING), true);
  }
  const burst = Array.from({length:1000}, () => admit(EVENTS.PLAYER_AIM));
  assert.ok(burst.includes(false));
  assert.equal(admit(EVENTS.PLAYER_READY), true, 'input floods cannot consume control acknowledgements');
  now += 1000;
  assert.equal(admit(EVENTS.PLAYER_AIM), true);
});

test('oversized Socket.IO messages close their connection before creating a room', async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const disconnected = once(socket, 'disconnect');
  socket.emit(EVENTS.HOST_CREATE, {v, sport:'tennis', padding:'x'.repeat(9000)});
  await disconnected;
  assert.equal(f.store.roomCount, 0);
});

test('a replaced TV cannot acknowledge a game command as applied in the current host epoch', async t => {
  const f = await fixture(t);
  const {tv, phone, room, gameId} = await f.playing('bowling');
  await send(tv, EVENTS.HOST_GAME_OPTIONS, {gameId, sport:'bowling'});
  const arrived = once(tv, EVENTS.GAME_COMMAND);
  const result = send(phone, EVENTS.PLAYER_GAME_COMMAND, {id:'reset', gameId, action:'new-match'});
  const [, acknowledge] = await arrived;
  const replacement = await f.connect();
  assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code:room.code, token:room.token, role:'host'})).ok, true);
  acknowledge({ok:true});
  assert.equal((await result).error, 'outcome-unknown');
});

test('a swing acknowledgement received after pause and resume does not report a fresh hit', async t => {
  const f = await fixture(t);
  const {tv, phone, gameId} = await f.playing('tennis');
  const arrived = once(tv, EVENTS.GAME_SWING);
  const result = send(phone, EVENTS.PLAYER_SWING, {id:'stroke', type:'swing', gameId, label:'Forehand', hand:'Right'});
  const [, acknowledge] = await arrived;
  await send(tv, EVENTS.HOST_PAUSE, {gameId, paused:true});
  await send(tv, EVENTS.HOST_PAUSE, {gameId, paused:false});
  acknowledge({ok:true});
  assert.equal((await result).error, 'outcome-unknown');
});

test('legacy declarations cannot bypass a provided stale action generation or game', () => {
  for (const sport of ['tennis', 'bowling']) {
    let now = 0;
    const store = new RoomStore({now:() => now});
    const room = store.createRoom('tv', {v, sport});
    store.join('phone', {v, code:room.code, name:'Player'});
    store.setSetup('phone', {setup:'buttons'}); store.setReady('phone', {ready:true, skipTutorial:true});
    store.startGame('phone'); now = 5000; store.finishCountdown(room.code);
    const state = store.lobby(room.code);
    const action = sport === 'tennis' ? {type:'swing', label:'Forehand', hand:'Right'} : {type:'roll', power:.5, spin:0, aim:0};
    const method = sport === 'tennis' ? 'swingTarget' : 'rollTarget';
    if (sport === 'bowling') store.setGameState('tv', {gameId:state.gameId, phase:'ready', currentPlayer:1, frame:1});
    assert.equal(store[method]('phone', {...action, id:'stale', gameId:'older-match'}).error, 'not-playing');
    assert.equal(store[method]('phone', {...action, id:'stale-epoch', gameId:state.gameId, hostEpoch:state.hostEpoch - 1}).error, 'wrong-generation');
    assert.equal(store[method]('phone', {...action, id:'current', gameId:state.gameId, generation:state.inputGeneration, hostEpoch:state.hostEpoch}).ok, true);
  }
});
