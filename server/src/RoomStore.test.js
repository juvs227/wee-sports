import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_SECONDS,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  PHASES,
  PROTOCOL_VERSION,
  READY_AT_PLAYERS,
  isRoomCode,
  playerCapacity,
} from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';

const v = PROTOCOL_VERSION;

function openRoom(store = new RoomStore(), sport = 'tennis') {
  const room = store.createRoom('tv', { v, sport });
  assert.equal(room.ok, true);
  return { store, code: room.code };
}

test('createRoom opens a tennis lobby with a valid, empty code', () => {
  const store = new RoomStore();
  const room = store.createRoom('tv', { v, sport: 'tennis' });
  assert.equal(room.ok, true);
  assert.ok(isRoomCode(room.code), `${room.code} is not a room code`);
  assert.equal(room.sport, 'tennis');
  assert.deepEqual(room.players, []);
  assert.equal(store.hostedBy('tv'), room.code);
});

test('createRoom rejects an old client and a sport that is not open', () => {
  const store = new RoomStore();
  assert.deepEqual(store.createRoom('tv', { v: 0, sport: 'tennis' }), { ok: false, error: ERRORS.BAD_VERSION });
  assert.deepEqual(store.createRoom('tv', { v, sport: 'golf' }), { ok: false, error: ERRORS.BAD_SPORT });
  assert.equal(store.roomCount, 0);
});

test('createRoom retries when a code is already taken', () => {
  const codes = ['CCCC', 'CCCC', 'DDDD'];
  const store = new RoomStore({ makeCode: () => codes.shift() });
  assert.equal(store.createRoom('tv1', { v, sport: 'tennis' }).code, 'CCCC');
  assert.equal(store.createRoom('tv2', { v, sport: 'tennis' }).code, 'DDDD');
});

test('players take the lowest seat and every join returns the lobby', () => {
  const { store, code } = openRoom();
  const first = store.join('a', { v, code, name: 'Ada' });
  const second = store.join('b', { v, code, name: 'Bo' });
  assert.equal(first.slot, 0);
  assert.equal(second.slot, 1);
  assert.deepEqual(second.players, [
    { slot: 0, name: 'Ada', ready: false, setup: null },
    { slot: 1, name: 'Bo', ready: false, setup: null },
  ]);
});

for (const sport of ['tennis', 'bowling']) test(`${sport} rejects joins beyond its playing seats, including reserved seats`, () => {
  const { store, code } = openRoom(new RoomStore(), sport);
  let first;
  for (let i = 0; i < playerCapacity(sport); i += 1) {
    const seat = store.join(`p${i}`, { v, code, name: `P${i}` });
    assert.equal(seat.ok, true);
    if (i === 0) first = seat;
  }
  store.disconnect('p0');
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.ROOM_FULL });
  const resumed = store.resume('back', { v, code, role: 'player', token: first.token });
  assert.equal(resumed.slot, 0);
  assert.equal(resumed.players.length, playerCapacity(sport));
});

test('a wrong or malformed code is no-room', () => {
  const { store } = openRoom(new RoomStore({ makeCode: () => 'CCCC' }));
  assert.equal(store.join('a', { v, code: 'DDDD', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: 'cccc', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: 'OOOO', name: 'Ada' }).error, ERRORS.NO_ROOM);
  assert.equal(store.join('a', { v, code: undefined, name: 'Ada' }).error, ERRORS.NO_ROOM);
});

test('names are cleaned, capped, and required', () => {
  const { store, code } = openRoom();
  assert.equal(store.join('a', { v, code, name: '   ' }).error, ERRORS.BAD_NAME);
  assert.equal(store.join('a', { v, code, name: 42 }).error, ERRORS.BAD_NAME);
  const long = store.join('b', { v, code, name: '  Maximilian   the Great  ' });
  assert.equal(long.name, 'Maximilian t');
  assert.ok([...long.name].length <= NAME_MAX);
});

test('duplicate names get a number and still fit', () => {
  const { store, code } = openRoom(new RoomStore(), 'bowling');
  assert.equal(store.join('a', { v, code, name: 'Sam' }).name, 'Sam');
  assert.equal(store.join('b', { v, code, name: 'sam' }).name, 'sam 2');
  assert.equal(store.join('c', { v, code, name: 'Sam' }).name, 'Sam 3');
});

test('a numbered duplicate of a full-length name still fits NAME_MAX', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Christopher!' });
  const twin = store.join('b', { v, code, name: 'Christopher!' });
  assert.equal(twin.name, 'Christophe 2');
  assert.ok([...twin.name].length <= NAME_MAX);
});

test('leaving frees the seat for the next player', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  store.join('b', { v, code, name: 'Bo' });
  assert.deepEqual(store.remove('a'), { code, closed: false });
  assert.equal(store.join('c', { v, code, name: 'Cy' }).slot, 0);
  assert.deepEqual(store.lobby(code).players.map((p) => p.name), ['Cy', 'Bo']);
});

test('the host leaving closes the room and lists who to tell', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  store.join('b', { v, code, name: 'Bo' });
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.deepEqual(result.playerIds.sort(), ['a', 'b']);
  assert.equal(store.lobby(code), null);
  assert.equal(store.roomCount, 0);
  assert.equal(store.join('c', { v, code, name: 'Cy' }).error, ERRORS.NO_ROOM);
  // The closed room's players are no longer members of anything.
  assert.equal(store.remove('a'), null);
});

test('removing someone who is not in a room is a no-op', () => {
  const store = new RoomStore();
  assert.equal(store.remove('nobody'), null);
});

// Ready check -------------------------------------------------------------

/** A room with a fake clock, filled with four players to retain multiplayer lobby coverage. Players are p0, p1, … */
function startReadyCheck(sport = 'bowling') {
  const clock = { t: 1_000_000 };
  const { store, code } = openRoom(new RoomStore({ now: () => clock.t }), sport);
  for (let i = 0; i < playerCapacity(sport); i += 1) store.join(`p${i}`, { v, code, name: `P${i}` });
  store.setSetup('p0', { setup: 'buttons' });
  for (let i = 1; i < playerCapacity(sport); i += 1) store.setSetup(`p${i}`, { setup: 'motion' });
  return { store, code, clock };
}

function everyoneReady(store) {
  for (let i = 0; i < MAX_PLAYERS; i += 1) store.setReady(`p${i}`, { ready: true });
}

const readyFlags = (store, code) => store.lobby(code).players.map((player) => player.ready);

const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;

test(`the ready check starts at ${READY_AT_PLAYERS} players and not before`, () => {
  const { store, code } = openRoom();
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  for (let i = 0; i < READY_AT_PLAYERS - 1; i += 1) {
    assert.equal(store.join(`p${i}`, { v, code, name: `P${i}` }).phase, PHASES.LOBBY);
  }
  // The join ack itself carries the new phase, so the last phone needs no update.
  const last = store.join('last', { v, code, name: 'Last' });
  assert.equal(last.phase, PHASES.READY);
  assert.ok(last.players.every((player) => player.ready === false));
});

test('ready toggles on and off, and the snapshot reflects it', () => {
  const { store, code } = startReadyCheck();
  assert.deepEqual(store.setReady('p1', { ready: true }), { ok: true, code, advanced: false });
  assert.deepEqual(readyFlags(store, code), [false, true, false, false]);
  store.setReady('p1', { ready: false });
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
  // Sending the same state twice is fine.
  store.setReady('p2', { ready: true });
  assert.equal(store.setReady('p2', { ready: true }).ok, true);
  assert.deepEqual(readyFlags(store, code), [false, false, true, false]);
});

test('3 of 4 ready stays in the ready check', () => {
  const { store, code } = startReadyCheck();
  for (let i = 0; i < MAX_PLAYERS - 1; i += 1) {
    assert.equal(store.setReady(`p${i}`, { ready: true }).advanced, false);
  }
  assert.equal(store.lobby(code).phase, PHASES.READY);
});

test('everyone ready moves to the next phase and clears the flags', () => {
  const { store, code } = startReadyCheck();
  for (let i = 0; i < MAX_PLAYERS - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  assert.deepEqual(store.setReady(`p${MAX_PLAYERS - 1}`, { ready: true }), { ok: true, code, advanced: true });
  assert.equal(store.lobby(code).phase, PHASES.ALL_READY);
  // ready is always false outside the 'ready' phase.
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
});

test('un-readying before the last player is ready keeps the check open', () => {
  const { store, code } = startReadyCheck();
  for (let i = 0; i < MAX_PLAYERS - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  store.setReady('p0', { ready: false });
  assert.equal(store.setReady(`p${MAX_PLAYERS - 1}`, { ready: true }).advanced, false);
  assert.equal(store.lobby(code).phase, PHASES.READY);
});

test('ready outside the ready phase is rejected', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  store.setSetup('a', { setup: 'buttons' });
  assert.equal(store.setReady('a', { ready: true }).ok, true);
  store.start('tv');
  assert.deepEqual(store.setReady('a', { ready: true }), { ok: false, error: ERRORS.NO_READY_CHECK });

  // Once everyone is ready, the flags are locked.
  const started = startReadyCheck();
  everyoneReady(started.store);
  assert.deepEqual(started.store.setReady('p0', { ready: false }), { ok: false, error: ERRORS.NO_READY_CHECK });
});

test('only players in a room can send ready', () => {
  const { store } = startReadyCheck();
  assert.deepEqual(store.setReady('stranger', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
  assert.deepEqual(store.setReady('tv', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});

test('a bad ready payload is rejected and changes nothing', () => {
  const { store, code } = startReadyCheck();
  for (const payload of [undefined, null, {}, { ready: 'yes' }, { ready: 1 }, 'true']) {
    assert.deepEqual(store.setReady('p0', payload), { ok: false, error: ERRORS.BAD_READY });
  }
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
});

test('a player leaving restarts readiness for the remaining players', () => {
  const { store, code } = startReadyCheck();
  store.setReady('p0', { ready: true });
  store.setReady('p2', { ready: true });
  assert.deepEqual(store.remove('p1'), { code, closed: false });
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.deepEqual(readyFlags(store, code), [false, false, false]);
  assert.equal(store.setReady('p0', { ready: true }).ok, true);
});

test('a new 4th player restarts the ready check from scratch', () => {
  const { store, code } = startReadyCheck();
  store.setReady('p0', { ready: true });
  store.remove('p3');
  const back = store.join('new', { v, code, name: 'New' });
  assert.equal(back.slot, 3);
  assert.equal(back.phase, PHASES.READY);
  assert.ok(back.players.every((player) => player.ready === false));
});

test('an active tennis game rejects mid-game joining', () => {
  const { store, code, clock } = startReadyCheck('tennis');
  store.remove('p1');
  everyoneReady(store);
  store.start('tv');
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

test('the host leaving during the ready check still closes the room', () => {
  const { store, code } = startReadyCheck();
  store.setReady('p0', { ready: true });
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, MAX_PLAYERS);
  assert.equal(store.lobby(code), null);
  assert.deepEqual(store.setReady('p1', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});

// Play and the countdown ----------------------------------------------------

test('Play starts the countdown once everyone is ready', () => {
  const { store, code } = startReadyCheck();
  everyoneReady(store);
  assert.equal(store.lobby(code).countdown, null);
  assert.deepEqual(store.start('tv'), { ok: true, code, msLeft: COUNTDOWN_MS });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.COUNTDOWN);
  assert.deepEqual(lobby.countdown, { msLeft: COUNTDOWN_MS });
});

test('Play before everyone is ready is rejected', () => {
  const { store, code } = openRoom();
  assert.deepEqual(store.start('tv'), { ok: false, error: ERRORS.NOT_ALL_READY });

  const checking = startReadyCheck();
  checking.store.setReady('p0', { ready: true });
  assert.deepEqual(checking.store.start('tv'), { ok: false, error: ERRORS.NOT_ALL_READY });
  assert.equal(checking.store.lobby(checking.code).phase, PHASES.READY);
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
});

test('only the TV can press Play, and only once', () => {
  const { store } = startReadyCheck();
  everyoneReady(store);
  assert.deepEqual(store.start('p0'), { ok: false, error: ERRORS.NOT_HOST });
  assert.deepEqual(store.start('stranger'), { ok: false, error: ERRORS.NOT_HOST });
  assert.equal(store.start('tv').ok, true);
  assert.deepEqual(store.start('tv'), { ok: false, error: ERRORS.NOT_ALL_READY });
});

test('msLeft counts down with the clock and never goes negative', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  store.start('tv');
  clock.t += 2000;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: COUNTDOWN_MS - 2000 });
  clock.t += COUNTDOWN_MS;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: 0 });
});

test('the countdown ends in the tutorial, and not a moment early', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  store.start('tv');
  clock.t += COUNTDOWN_MS - 1;
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  clock.t += 1;
  assert.deepEqual(store.finishCountdown(code), { code });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.TUTORIAL);
  assert.equal(lobby.countdown, null);
  // A second, stale timer changes nothing.
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.finishCountdown('ZZZZ'), null);
});

test('a player leaving after everyone is ready goes back to the lobby', () => {
  const { store, code } = startReadyCheck();
  everyoneReady(store);
  assert.deepEqual(store.remove('p2'), { code, closed: false });
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.deepEqual(store.start('tv'), { ok: false, error: ERRORS.NOT_ALL_READY });
});

test('a player leaving during the countdown cancels it and clears the ready flags', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  store.start('tv');
  assert.deepEqual(store.remove('p1'), { code, closed: false, countdownCancelled: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.READY);
  assert.equal(lobby.countdown, null);
  assert.deepEqual(readyFlags(store, code), [false, false, false]);
  // The cancelled countdown's timer firing later changes nothing.
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
  // A new 4th player starts a fresh ready check.
  assert.equal(store.join('new', { v, code, name: 'New' }).phase, PHASES.READY);
});

test('the tennis controller leaving returns everyone to the lobby to refill P1', () => {
  const { store, code, clock } = startReadyCheck('tennis');
  everyoneReady(store);
  store.start('tv');
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  assert.deepEqual(store.remove('p0'), { code, closed: false });
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  assert.equal(store.join('replacement', { v, code, name: 'Replacement' }).slot, 0);
});

test('the host leaving during the countdown closes the room', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  store.start('tv');
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, MAX_PLAYERS);
  assert.equal(store.lobby(code), null);
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
});


test('one phone can ready, start tennis, and reconnect without extra players', () => {
  const clock = { t: 0 };
  const { store, code } = openRoom(new RoomStore({ now: () => clock.t }));
  const seat = store.join('solo', { v, code, name: 'Solo' });
  assert.equal(seat.phase, PHASES.READY);
  store.setSetup('solo', { setup: 'buttons' });
  assert.equal(store.setReady('solo', { ready: true }).advanced, true);
  assert.equal(store.start('tv').ok, true);
  assert.equal(store.join('late', { v, code, name: 'Late' }).error, ERRORS.IN_PROGRESS);
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  store.disconnect('solo');
  assert.equal(store.lobby(code).paused, true);
  assert.equal(store.resume('back', { v, code, role: 'player', token: seat.token }).phase, PHASES.TUTORIAL);
  store.remove('back');
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
});

test('joining after all-ready reopens readiness before the countdown', () => {
  const { store, code } = openRoom();
  store.join('solo', { v, code, name: 'Solo' });
  store.setSetup('solo', { setup: 'motion' });
  store.setReady('solo', { ready: true });
  const friend = store.join('friend', { v, code, name: 'Friend' });
  assert.equal(friend.ok, true);
  assert.equal(friend.phase, PHASES.READY);
  assert.equal(store.start('tv').ok, false);
  assert.equal(store.setReady('solo', { ready: true }).advanced, false);
  store.setSetup('friend', { setup: 'buttons' });
  store.setReady('solo', { ready: true });
  assert.equal(store.setReady('friend', { ready: true }).advanced, true);
  assert.equal(store.start('tv').ok, true);
});

test('setup gates readiness, cancels a countdown, and pauses a running match until restored', () => {
  let now = 0;
  const { store, code } = openRoom(new RoomStore({ now: () => now }));
  store.join('p0', { v, code, name: 'Blue' });
  store.join('p1', { v, code, name: 'Red' });
  assert.equal(store.setReady('p0', { ready: true }).error, 'setup-required');
  assert.equal(store.setSetup('tv', { setup: 'buttons' }).error, 'not-controller');
  assert.equal(store.setSetup('p0', { setup: 'fake' }).error, 'bad-setup');
  store.setSetup('p0', { setup: 'motion' }); store.setSetup('p1', { setup: 'buttons' });
  store.setReady('p0', { ready: true }); store.setReady('p1', { ready: true }); store.start('tv');
  store.setSetup('p1', { setup: null });
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.equal(store.lobby(code).countdown, null);
  store.setSetup('p1', { setup: 'motion' });
  store.setReady('p0', { ready: true }); store.setReady('p1', { ready: true }); store.start('tv');
  now += 5000; store.finishCountdown(code);
  store.setSetup('p1', { setup: null });
  assert.equal(store.lobby(code).paused, true);
  assert.deepEqual(store.lobby(code).setupPending, ['Red']);
  const stroke = { type: 'swing', id: 'one', label: 'Forehand', hand: 'Right' };
  assert.equal(store.swingTarget('p0', stroke).error, 'paused');
  store.setSetup('p1', { setup: 'buttons' });
  assert.equal(store.lobby(code).paused, false);
  assert.equal(store.swingTarget('p1', { ...stroke, player: 1 }).event.player, 2);
  store.remove('p1');
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.equal(store.lobby(code).paused, false);
});
