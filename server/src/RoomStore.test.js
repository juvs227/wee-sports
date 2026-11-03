import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_SECONDS,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  PHASES,
  PICKS,
  PROTOCOL_VERSION,
  READY_AT_PLAYERS,
  TUTORIAL_MOVES,
  VOTE_SECONDS,
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
const VOTE_MS = VOTE_SECONDS * 1000;

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
  assert.deepEqual(store.setReady('p1', { ready: true }), { ok: true, code });
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
    assert.equal(store.setReady(`p${i}`, { ready: true }).countdownStarted, undefined);
  }
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.equal(store.lobby(code).countdown, null);
});

test('un-readying before the last player is ready keeps the check open', () => {
  const { store, code } = startReadyCheck();
  for (let i = 0; i < MAX_PLAYERS - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  store.setReady('p0', { ready: false });
  assert.equal(store.setReady(`p${MAX_PLAYERS - 1}`, { ready: true }).countdownStarted, undefined);
  assert.equal(store.lobby(code).phase, PHASES.READY);
});

test('ready outside the ready check and the countdown is rejected', () => {
  // A bowling room with nobody seated has no ready check yet.
  const { store, code } = openRoom(new RoomStore(), 'bowling');
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  // Once the vote opens, readiness is locked.
  const voting = openVote();
  assert.deepEqual(voting.store.setReady('p0', { ready: false }), { ok: false, error: ERRORS.NO_READY_CHECK });
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

test('the host leaving during the ready check still closes the room', () => {
  const { store, code } = startReadyCheck();
  store.setReady('p0', { ready: true });
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, MAX_PLAYERS);
  assert.equal(store.lobby(code), null);
  assert.deepEqual(store.setReady('p1', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});

// The countdown starts by itself ---------------------------------------------

test('the last player to ready up starts the countdown on its own', () => {
  const { store, code } = startReadyCheck();
  for (let i = 0; i < MAX_PLAYERS - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  assert.equal(store.lobby(code).countdown, null);
  assert.deepEqual(store.setReady(`p${MAX_PLAYERS - 1}`, { ready: true }),
    { ok: true, code, countdownStarted: true, msLeft: COUNTDOWN_MS });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.COUNTDOWN);
  assert.deepEqual(lobby.countdown, { msLeft: COUNTDOWN_MS });
  assert.equal(typeof lobby.gameId, 'string');
  // Everyone stays ready while the countdown runs, so anyone can still back out.
  assert.deepEqual(readyFlags(store, code), [true, true, true, true]);
});

test('msLeft counts down with the clock and never goes negative', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  clock.t += 2000;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: COUNTDOWN_MS - 2000 });
  clock.t += COUNTDOWN_MS;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: 0 });
});

test('un-readying during the countdown cancels it, and everyone else stays ready', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  assert.deepEqual(store.setReady('p2', { ready: false }), { ok: true, code, countdownCancelled: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.READY);
  assert.equal(lobby.countdown, null);
  assert.equal(lobby.gameId, null);
  assert.deepEqual(readyFlags(store, code), [true, true, false, true]);
  // The cancelled countdown's deadline passing later changes nothing.
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
  // Readying up again restarts it straight away.
  assert.equal(store.setReady('p2', { ready: true }).countdownStarted, true);
});

test('a bowling countdown ends in the game, and not a moment early', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  clock.t += COUNTDOWN_MS - 1;
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  clock.t += 1;
  assert.deepEqual(store.finishCountdown(code), { code });
  const lobby = store.lobby(code);
  // Bowling has no tutorial, so there is no vote either.
  assert.equal(lobby.phase, PHASES.GAME);
  assert.equal(lobby.countdown, null);
  assert.equal(lobby.vote, null);
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
  // A second, stale tick changes nothing.
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.finishCountdown('ZZZZ'), null);
});

test('a player leaving during the countdown cancels it and clears the ready flags', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  assert.deepEqual(store.remove('p1'), { code, closed: false, countdownCancelled: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.READY);
  assert.equal(lobby.countdown, null);
  assert.deepEqual(readyFlags(store, code), [false, false, false]);
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
  // A new 4th player starts a fresh ready check.
  assert.equal(store.join('new', { v, code, name: 'New' }).phase, PHASES.READY);
});

test('nobody can join during the countdown', () => {
  const { store, code } = openRoom(new RoomStore(), 'bowling');
  store.join('p0', { v, code, name: 'P0' });
  store.setSetup('p0', { setup: 'buttons' });
  store.setReady('p0', { ready: true });
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

test('the host leaving during the countdown closes the room', () => {
  const { store, code, clock } = startReadyCheck();
  everyoneReady(store);
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, MAX_PLAYERS);
  assert.equal(store.lobby(code), null);
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
});

// Tutorial vote (tennis) -----------------------------------------------------

/** Two tennis players, p0 and p1, through the countdown and into the vote. */
function openVote() {
  const fixture = startReadyCheck('tennis');
  everyoneReady(fixture.store);
  fixture.clock.t += COUNTDOWN_MS;
  assert.deepEqual(fixture.store.finishCountdown(fixture.code), { code: fixture.code, msLeft: VOTE_MS });
  return fixture;
}

test('a tennis countdown opens the vote, keeping the same game id', () => {
  const { store, code, clock } = startReadyCheck('tennis');
  everyoneReady(store);
  const { gameId } = store.lobby(code);
  clock.t += COUNTDOWN_MS;
  assert.deepEqual(store.finishCountdown(code), { code, msLeft: VOTE_MS });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.VOTE);
  assert.equal(lobby.gameId, gameId);
  assert.deepEqual(readyFlags(store, code), [false, false]);
});

test('vote msLeft counts down with the clock and never goes negative', () => {
  const { store, code, clock } = openVote();
  assert.deepEqual(store.lobby(code).vote, { msLeft: VOTE_MS, voted: [] });
  clock.t += 5000;
  assert.equal(store.lobby(code).vote.msLeft, VOTE_MS - 5000);
  clock.t += VOTE_MS;
  assert.equal(store.lobby(code).vote.msLeft, 0);
});

test('the open vote shows who voted but never their pick', () => {
  const { store, code } = openVote();
  assert.deepEqual(store.vote('p1', { watch: true }), { ok: true, code, resolved: false });
  assert.deepEqual(store.lobby(code).vote.voted, [1]);
  assert.equal('picks' in store.lobby(code).vote, false);
});

test('one Yes means the tutorial, and the resolved vote reveals every pick', () => {
  const { store, code } = openVote();
  store.vote('p0', { watch: false });
  assert.deepEqual(store.vote('p1', { watch: true }), { ok: true, code, resolved: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.TUTORIAL);
  assert.deepEqual(lobby.vote, { picks: [{ slot: 0, pick: PICKS.NO }, { slot: 1, pick: PICKS.YES }] });
  assert.deepEqual(lobby.tutorial, { step: 0, moves: TUTORIAL_MOVES.tennis, learners: [1], done: [] });
});

test('all No skips to the game', () => {
  const { store, code } = openVote();
  store.vote('p0', { watch: false });
  store.vote('p1', { watch: false });
  assert.equal(store.lobby(code).phase, PHASES.GAME);
  assert.equal(store.lobby(code).tutorial, null);
});

test('on timeout, non-voters count as No, and not a moment early', () => {
  const { store, code, clock } = openVote();
  store.vote('p0', { watch: false });
  clock.t += VOTE_MS - 1;
  assert.equal(store.expireVote(code), null);
  clock.t += 1;
  assert.deepEqual(store.expireVote(code), { code });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.GAME);
  assert.deepEqual(lobby.vote.picks, [{ slot: 0, pick: PICKS.NO }, { slot: 1, pick: PICKS.NONE }]);
  // A stale tick after the vote resolved is harmless.
  assert.equal(store.expireVote(code), null);
});

test('on timeout, one Yes still means the tutorial', () => {
  const { store, code, clock } = openVote();
  store.vote('p0', { watch: true });
  clock.t += VOTE_MS;
  store.expireVote(code);
  assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
  assert.deepEqual(store.lobby(code).tutorial.learners, [0]);
});

test('the vote deadline does not run while someone is reconnecting', () => {
  const { store, code, clock } = openVote();
  clock.t += 5000;
  store.disconnect('p1');
  clock.t += VOTE_MS;
  assert.equal(store.expireVote(code), null);
  assert.equal(store.lobby(code).vote.msLeft, VOTE_MS - 5000);
  assert.deepEqual(store.vote('p0', { watch: true }), { ok: false, error: ERRORS.PAUSED });
});

test('a vote is final, and bad or late votes are rejected', () => {
  const { store, code } = openVote();
  for (const payload of [undefined, null, {}, { watch: 'yes' }, { watch: 1 }]) {
    assert.deepEqual(store.vote('p0', payload), { ok: false, error: ERRORS.BAD_VOTE });
  }
  assert.deepEqual(store.lobby(code).vote.voted, []);
  store.vote('p0', { watch: true });
  assert.deepEqual(store.vote('p0', { watch: false }), { ok: false, error: ERRORS.ALREADY_VOTED });
  assert.deepEqual(store.vote('tv', { watch: true }), { ok: false, error: ERRORS.NOT_PLAYER });
  assert.deepEqual(store.vote('stranger', { watch: true }), { ok: false, error: ERRORS.NOT_PLAYER });
  store.vote('p1', { watch: false });
  assert.deepEqual(store.vote('p1', { watch: true }), { ok: false, error: ERRORS.NO_VOTE });
});

test('there is no vote outside the vote phase', () => {
  const { store } = startReadyCheck('tennis');
  assert.deepEqual(store.vote('p0', { watch: true }), { ok: false, error: ERRORS.NO_VOTE });
});

test('a player leaving during the vote ends the match back to the lobby', () => {
  const { store, code, clock } = openVote();
  store.vote('p0', { watch: true });
  store.remove('p1');
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.READY);
  assert.equal(lobby.vote, null);
  assert.equal(lobby.gameId, null);
  clock.t += VOTE_MS;
  assert.equal(store.expireVote(code), null);
});

test('nobody can join during the vote', () => {
  const clock = { t: 0 };
  const { store, code } = openRoom(new RoomStore({ now: () => clock.t }));
  store.join('solo', { v, code, name: 'Solo' });
  store.setSetup('solo', { setup: 'buttons' });
  store.setReady('solo', { ready: true });
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  assert.equal(store.lobby(code).phase, PHASES.VOTE);
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

// Tutorial (tennis) ----------------------------------------------------------

const MOVES = TUTORIAL_MOVES.tennis;

/** Both tennis players vote, then the tutorial starts for whoever said Yes. */
function openTutorial(watch = [true, true]) {
  const fixture = openVote();
  watch.forEach((pick, i) => fixture.store.vote(`p${i}`, { watch: pick }));
  return fixture;
}

test('a step waits for every learner, then the next one starts', () => {
  const { store, code } = openTutorial();
  assert.deepEqual(store.tutorialMove('p0', { step: 0 }), { ok: true, code, advanced: false });
  assert.deepEqual(store.lobby(code).tutorial.done, [0]);
  assert.deepEqual(store.tutorialMove('p1', { step: 0 }), { ok: true, code, advanced: true });
  assert.deepEqual(store.lobby(code).tutorial, { step: 1, moves: MOVES, learners: [0, 1], done: [] });
});

test('after the last step the game starts', () => {
  const { store, code } = openTutorial([false, true]);
  for (let step = 0; step < MOVES.length; step += 1) {
    assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
    assert.equal(store.tutorialMove('p1', { step }).advanced, true);
  }
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.GAME);
  assert.equal(lobby.tutorial, null);
  // The game the tutorial leads into is the one the countdown started.
  assert.equal(typeof lobby.gameId, 'string');
});

test('a repeat or a step that already ended changes nothing', () => {
  const { store, code } = openTutorial();
  store.tutorialMove('p0', { step: 0 });
  assert.deepEqual(store.tutorialMove('p0', { step: 0 }), { ok: true, code, advanced: false });
  store.tutorialMove('p1', { step: 0 });
  assert.deepEqual(store.tutorialMove('p0', { step: 0 }), { ok: true, code, advanced: false });
  assert.deepEqual(store.lobby(code).tutorial.done, []);
});

test('only learners can do the moves, and bad moves do not count', () => {
  const { store, code } = openTutorial([false, true]);
  assert.deepEqual(store.tutorialMove('p0', { step: 0 }), { ok: false, error: ERRORS.NOT_LEARNER });
  assert.deepEqual(store.tutorialMove('tv', { step: 0 }), { ok: false, error: ERRORS.NOT_PLAYER });
  for (const payload of [undefined, {}, { step: -1 }, { step: 0.5 }, { step: '0' }]) {
    assert.deepEqual(store.tutorialMove('p1', payload), { ok: false, error: ERRORS.BAD_MOVE });
  }
  assert.deepEqual(store.lobby(code).tutorial.done, []);
});

test('there is no tutorial outside the tutorial phase', () => {
  const { store } = openVote();
  assert.deepEqual(store.tutorialMove('p0', { step: 0 }), { ok: false, error: ERRORS.NO_TUTORIAL });
});

test('a player leaving during the tutorial ends the match back to the lobby', () => {
  const { store, code } = openTutorial();
  store.remove('p0');
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.LOBBY);
  assert.equal(lobby.tutorial, null);
  assert.equal(store.join('replacement', { v, code, name: 'Replacement' }).slot, 0);
});

test('the TV or P1 can return to the lobby from the vote or the tutorial', () => {
  for (const open of [openVote, openTutorial]) {
    const { store, code } = open();
    const { gameId } = store.lobby(code);
    assert.deepEqual(store.returnToLobby('tv', { gameId }), { ok: true, code });
    const lobby = store.lobby(code);
    assert.equal(lobby.phase, PHASES.READY);
    assert.equal(lobby.vote, null);
    assert.equal(lobby.tutorial, null);
  }
});

test('game input waits until the tutorial is over', () => {
  const { store, code } = openTutorial([true, false]);
  const stroke = { type: 'swing', id: 'one', gameId: store.lobby(code).gameId, label: 'Forehand', hand: 'Right' };
  assert.equal(store.swingTarget('p0', stroke).error, 'not-playing');
  for (let step = 0; step < MOVES.length; step += 1) store.tutorialMove('p0', { step });
  assert.equal(store.swingTarget('p0', stroke).ok, true);
});

test('the host leaving during the tutorial closes the room', () => {
  const { store, code } = openTutorial();
  assert.equal(store.remove('tv').closed, true);
  assert.equal(store.lobby(code), null);
});

// Solo, setup and reconnects ---------------------------------------------------

test('an active tennis game rejects mid-game joining', () => {
  const { store, code, clock } = startReadyCheck('tennis');
  store.remove('p1');
  everyoneReady(store);
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  clock.t += VOTE_MS;
  store.expireVote(code);
  assert.equal(store.lobby(code).phase, PHASES.GAME);
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

test('the tennis controller leaving returns everyone to the lobby to refill P1', () => {
  const { store, code, clock } = startReadyCheck('tennis');
  everyoneReady(store);
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  clock.t += VOTE_MS;
  store.expireVote(code);
  assert.deepEqual(store.remove('p0'), { code, closed: false });
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  assert.equal(store.join('replacement', { v, code, name: 'Replacement' }).slot, 0);
});

test('one phone can ready, start tennis, and reconnect without extra players', () => {
  const clock = { t: 0 };
  const { store, code } = openRoom(new RoomStore({ now: () => clock.t }));
  const seat = store.join('solo', { v, code, name: 'Solo' });
  assert.equal(seat.phase, PHASES.READY);
  store.setSetup('solo', { setup: 'buttons' });
  assert.equal(store.setReady('solo', { ready: true }).countdownStarted, true);
  assert.equal(store.join('late', { v, code, name: 'Late' }).error, ERRORS.IN_PROGRESS);
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  assert.equal(store.vote('solo', { watch: false }).resolved, true);
  store.disconnect('solo');
  assert.equal(store.lobby(code).paused, true);
  assert.equal(store.resume('back', { v, code, role: 'player', token: seat.token }).phase, PHASES.GAME);
  store.remove('back');
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
});

test('joining during the ready check reopens readiness before the countdown', () => {
  const { store, code } = openRoom();
  store.join('solo', { v, code, name: 'Solo' });
  store.setSetup('solo', { setup: 'motion' });
  const friend = store.join('friend', { v, code, name: 'Friend' });
  assert.equal(friend.ok, true);
  assert.equal(friend.phase, PHASES.READY);
  assert.equal(store.setReady('solo', { ready: true }).countdownStarted, undefined);
  store.setSetup('friend', { setup: 'buttons' });
  assert.equal(store.setReady('friend', { ready: true }).countdownStarted, true);
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
  store.setReady('p0', { ready: true }); store.setReady('p1', { ready: true });
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  store.setSetup('p1', { setup: null });
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.equal(store.lobby(code).countdown, null);
  store.setSetup('p1', { setup: 'motion' });
  store.setReady('p0', { ready: true }); store.setReady('p1', { ready: true });
  now += 5000; store.finishCountdown(code);
  now += VOTE_MS; store.expireVote(code);
  store.setSetup('p1', { setup: null });
  assert.equal(store.lobby(code).paused, true);
  assert.deepEqual(store.lobby(code).setupPending, ['Red']);
  const stroke = { type: 'swing', id: 'one', gameId: store.lobby(code).gameId, label: 'Forehand', hand: 'Right' };
  assert.equal(store.swingTarget('p0', stroke).error, 'paused');
  store.setSetup('p1', { setup: 'buttons' });
  assert.equal(store.lobby(code).paused, false);
  assert.equal(store.swingTarget('p1', { ...stroke, player: 1 }).event.player, 2);
  store.remove('p1');
  assert.equal(store.lobby(code).phase, PHASES.READY);
  assert.equal(store.lobby(code).paused, false);
});
