import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {EVENTS, PHASES, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {RoomStore} from './RoomStore.js';
const capabilities = createControllerCapabilities();
import {createGameServer} from './app.js';

function fixture(sport = 'bowling', {count = 1, setup = 'motion', playing = true} = {}) {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const room = store.createRoom('tv', {v, sport, capabilities});
  assert.equal(room.ok, true);
  const seats = Array.from({length: count}, (_, index) => {
    const socket = `p${index + 1}`;
    const seat = store.join(socket, {v, code: room.code, name: `Player ${index + 1}`, capabilities});
    assert.equal(seat.ok, true);
    assert.equal(store.setSetup(socket, {setup}).ok, true);
    return seat;
  });
  const view = () => store.lobby(room.code);
  const start = () => {
    for (let index = 0; index < count; index++) assert.equal(store.setReady(`p${index + 1}`, {ready: true}).ok, true);
    store.startGame('p1');
    now += 5000;
    store.finishCountdown(room.code);
    assert.equal(view().phase, PHASES.GAME);
    const state = view().sport === 'bowling' ? {phase: 'ready', currentPlayer: 1, frame: 1}
      : {phase: 'ready', score: [0, 0], server: 1, winner: null, practice: false};
    assert.equal(store.setGameState('tv', {gameId: view().gameId, ...state}).ok, true);
  };
  const envelope = seq => ({gameId: view().gameId, generation: view().inputGeneration, hostEpoch: view().hostEpoch, seq});

  const aim = (seq = 1) => ({...envelope(seq), aim: .3, locked: false});
  const roll = id => ({type: 'roll', id, gameId: view().gameId, generation: view().inputGeneration,
    hostEpoch: view().hostEpoch, aim: 0, power: .5, spin: 0});
  if (playing) start();
  return {store, room, seats, start, view, aim, roll, advance: (ms = 50) => { now += ms; }};
}











test('continuous streams keep the latest sequence, discard burst samples and never replay a backlog', () => {
  const f = fixture();
  assert.equal(f.store.continuousTarget('p1', f.aim(10), 'aim').ok, true);
  assert.equal(f.store.continuousTarget('p1', f.aim(10), 'aim').error, 'stale-sequence');
  assert.equal(f.store.continuousTarget('p1', f.aim(9), 'aim').error, 'stale-sequence');
  assert.equal(f.store.continuousTarget('p1', f.aim(12), 'aim').error, 'rate-limited');
  f.advance();
  assert.equal(f.store.continuousTarget('p1', f.aim(11), 'aim').error, 'stale-sequence');
  const next = f.store.continuousTarget('p1', f.aim(13), 'aim');
  assert.equal(next.ok, true);
  assert.equal(next.event.seq, 13);
});



test('pause cancels old-generation aim, and resume requires a fresh envelope', () => {
  const f = fixture();
  const before = f.aim();
  assert.equal(f.store.continuousTarget('p1', before, 'aim').ok, true);
  assert.equal(f.store.setPaused('p1', {gameId: before.gameId, paused: true}, 'player').ok, true);
  assert.equal(f.store.continuousTarget('p1', {...before, seq: 2}, 'aim').error, 'paused');
  assert.equal(f.store.setPaused('p1', {gameId: before.gameId, paused: false}, 'player').ok, true);
  assert.ok(f.view().inputGeneration > before.generation);
  assert.equal(f.store.continuousTarget('p1', {...before, seq: 3}, 'aim').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', f.aim(0), 'aim').ok, true);
});









test('host replacement advances the epoch and routes only new-generation input to the replacement', () => {
  const f = fixture();
  const before = f.aim();
  const resumed = f.store.resume('new-tv', {v, code: f.room.code, role: 'host', token: f.room.token});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.hostEpoch, before.hostEpoch + 1);
  assert.equal(f.store.continuousTarget('p1', {...f.aim(), hostEpoch: before.hostEpoch}, 'aim').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', before, 'aim').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', f.aim(), 'aim').hostSocketId, 'new-tv');
  assert.equal(f.store.setGameState('tv', {gameId: f.view().gameId, phase: 'complete', score: [11, 0], server: 1, winner: 1, practice: false}).error, 'not-host');
});

test('phone replacement cannot retain a stale socket or replay its earlier stream', () => {
  const f = fixture();
  const before = f.aim();
  const resumed = f.store.resume('new-phone', {v, code: f.room.code, role: 'player', token: f.seats[0].token});
  assert.equal(resumed.slot, 0);
  assert.equal(resumed.name, 'Player 1');
  assert.equal(f.view().players.length, 1);
  assert.equal(f.store.continuousTarget('p1', f.aim(), 'aim').error, 'not-controller');
  assert.equal(f.store.continuousTarget('new-phone', before, 'aim').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('new-phone', f.aim(), 'aim').ok, true);
});

test('bowling preview is only from the current player in the ready phase and cannot authorize a roll', () => {
  const f = fixture('bowling', {count: 2});
  assert.equal(f.store.continuousTarget('p2', {...f.aim(), player: 1}, 'aim').error, 'not-your-turn');
  assert.equal(f.store.continuousTarget('p1', {...f.aim(), locked: true}, 'aim').ok, true);
  assert.equal(f.store.actionStatus('p1', {gameId: f.view().gameId, id: 'preview'}).error, 'unknown-action');
  assert.equal(f.view().gameState.phase, 'ready');
  f.store.setGameState('tv', {gameId: f.view().gameId, phase: 'rolling', currentPlayer: 1, frame: 1});
  f.advance();
  assert.equal(f.store.continuousTarget('p1', f.aim(2), 'aim').error, 'not-your-turn');
  assert.equal(f.store.continuousTarget('unknown', f.aim(2), 'aim').error, 'not-controller');
});







test('roll status belongs to its authenticated player, survives reconnect, and never authorizes retry', () => {
  const f = fixture('bowling', {count: 2});
  const roll = f.roll('once-only');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
  const query = {id: roll.id, gameId: roll.gameId};
  assert.equal(f.store.actionStatus('p1', query).status, 'pending');
  for (const socket of ['p2', 'tv', 'unknown']) assert.equal(f.store.actionStatus(socket, query).error, 'unknown-action');
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, {ok: false, error: 'outcome-unknown'});
  assert.equal(f.store.actionStatus('p1', query).status, 'unknown');
  assert.equal(f.store.rollTarget('p1', roll).error, 'duplicate-roll');
  f.store.resume('back', {v, code: f.room.code, role: 'player', token: f.seats[0].token});
  assert.equal(f.store.actionStatus('p1', query).error, 'unknown-action');
  assert.equal(f.store.actionStatus('back', query).status, 'unknown');
  assert.equal(f.store.actionStatus('back', {...query, gameId: 'old-game'}).error, 'unknown-action');
});

test('negotiated modern rolls cannot omit their game, input generation or host epoch', () => {
  const f = fixture('bowling');
  const roll = f.roll('current-release');
  for (const omitted of ['gameId', 'generation', 'hostEpoch']) {
    const event = {...roll}; delete event[omitted];
    assert.equal(f.store.rollTarget('p1', event).error, 'wrong-generation');
  }
  assert.equal(f.store.rollTarget('p1', {...roll, generation: roll.generation - 1}).error, 'wrong-generation');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
});

test('negotiated modern tennis swings cannot bypass generation checks with a legacy-shaped action', () => {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const room = store.createRoom('tv', {v, sport: 'tennis', capabilities});
  store.join('phone', {v, code: room.code, name: 'Player', capabilities});
  store.setSetup('phone', {setup: 'buttons'});
  store.setReady('phone', {ready: true}); store.startGame('phone');
  now = 5000; store.finishCountdown(room.code);
  store.vote('phone', {watch: false});
  const state = store.lobby(room.code);
  assert.equal(state.phase, PHASES.GAME);
  const swing = {type: 'swing', id: 'current-swing', label: 'Forehand', hand: 'Right',
    gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch};
  for (const omitted of ['gameId', 'generation', 'hostEpoch']) {
    const event = {...swing}; delete event[omitted];
    assert.equal(store.swingTarget('phone', event).error, 'wrong-generation');
  }
  assert.equal(store.swingTarget('phone', swing).ok, true);
});

test('settled roll status is idempotent and disappears when a new game replaces its owner game', () => {
  const f = fixture('bowling');
  const roll = f.roll('accepted-roll');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
  const outcome = {ok: true, id: roll.id, receivers: 1};
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, outcome);
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, {ok: false, error: 'late-error'});
  assert.deepEqual(f.store.actionStatus('p1', {id: roll.id, gameId: roll.gameId}), {ok: true, id: roll.id, status: 'accepted', result: outcome});
  assert.equal(f.store.returnToLobby('tv', {gameId: roll.gameId}).ok, true);
  assert.equal(f.store.actionStatus('p1', {id: roll.id, gameId: roll.gameId}).error, 'unknown-action');
});





const send = (socket, event, payload = {}) => socket.timeout(4000).emitWithAck(event, payload);
async function networkFixture(t) {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10});
  const clients = [];
  t.after(async () => { for (const client of clients) client.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  return {store, advance: () => {now += 5000;}, client: async () => {
    const socket = io(`http://127.0.0.1:${app.http.address().port}`, {transports: ['websocket'], reconnection: false});
    clients.push(socket);
    await once(socket, 'connect', {signal: AbortSignal.timeout(2000)});
    return socket;
  }};
}



test('real sockets retain an unknown lost acknowledgement outcome and never replay its roll ID', async t => {
  const f = await networkFixture(t);
  const tv = await f.client(), phone = await f.client();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling'});
  await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Player', capabilities});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  f.advance(); f.store.finishCountdown(room.code);
  const state = f.store.lobby(room.code);
  await send(tv, EVENTS.HOST_GAME_STATE, {gameId: state.gameId, phase: 'ready', currentPlayer: 1, frame: 1});
  const rolls = [];
  tv.on(EVENTS.GAME_ROLL, event => { rolls.push(event); }); // Host received it, reply was lost.
  const roll = {type: 'roll', id: 'lost-reply', gameId: state.gameId, generation: state.inputGeneration,
    hostEpoch: state.hostEpoch, power: .5, aim: 0, spin: 0};
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll)).error, 'outcome-unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ACTION_STATUS, {id: roll.id, gameId: state.gameId})).status, 'unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll)).error, 'duplicate-roll');
  assert.equal(rolls.length, 1);
});

test('real sockets cannot accept a late roll reply from a replaced host epoch', async t => {
  const f = await networkFixture(t);
  const tv = await f.client(), phone = await f.client();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling'});
  await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Player', capabilities});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  f.advance(); f.store.finishCountdown(room.code);
  const state = f.store.lobby(room.code);
  await send(tv, EVENTS.HOST_GAME_STATE, {gameId: state.gameId, phase: 'ready', currentPlayer: 1, frame: 1});
  const roll = {type: 'roll', id: 'old-host-reply', gameId: state.gameId, generation: state.inputGeneration,
    hostEpoch: state.hostEpoch, power: .5, aim: 0, spin: 0};
  const receipt = once(tv, EVENTS.GAME_ROLL, {signal: AbortSignal.timeout(2000)});
  const pending = send(phone, EVENTS.PLAYER_ROLL, roll);
  const [, reply] = await receipt;
  const replacement = await f.client();
  assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code: room.code, token: room.token, role: 'host'})).ok, true);
  reply({ok: true});
  assert.equal((await pending).error, 'outcome-unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ACTION_STATUS, {id: roll.id, gameId: state.gameId})).status, 'unknown');
});
