import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_SECONDS,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  PHASES,
  PLAYERS_TO_START,
  PROTOCOL_VERSION,
  VOTE_SECONDS,
  isRoomCode,
} from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';

const v = PROTOCOL_VERSION;

function openRoom(store = new RoomStore()) {
  const room = store.createRoom('tv', { v, sport: 'tennis' });
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
  assert.deepEqual(store.createRoom('tv', { v, sport: 'bowling' }), { ok: false, error: ERRORS.BAD_SPORT });
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
    { slot: 0, name: 'Ada', ready: false },
    { slot: 1, name: 'Bo', ready: false },
  ]);
});

test(`the lobby is full after ${MAX_PLAYERS} players`, () => {
  const { store, code } = openRoom();
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    assert.equal(store.join(`p${i}`, { v, code, name: `P${i}` }).ok, true);
  }
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.ROOM_FULL });
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
  const { store, code } = openRoom();
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

// Shared setup ---------------------------------------------------------------

const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;
const VOTE_MS = VOTE_SECONDS * 1000;

/** A room with a fake clock and a full lobby. Players are p0, p1, … */
function fullLobby() {
  const clock = { t: 1_000_000 };
  const { store, code } = openRoom(new RoomStore({ now: () => clock.t }));
  for (let i = 0; i < PLAYERS_TO_START; i += 1) store.join(`p${i}`, { v, code, name: `P${i}` });
  return { store, code, clock };
}

function everyoneReady(store) {
  for (let i = 0; i < PLAYERS_TO_START; i += 1) store.setReady(`p${i}`, { ready: true });
}

/** A full lobby where everyone is ready and the countdown has run out, so the vote is open. */
function openVote() {
  const room = fullLobby();
  everyoneReady(room.store);
  room.clock.t += COUNTDOWN_MS;
  room.store.finishCountdown(room.code);
  return room;
}

function everyoneVotes(store, watch = () => false) {
  for (let i = 0; i < PLAYERS_TO_START; i += 1) store.vote(`p${i}`, { watch: watch(i) });
}

const readyFlags = (store, code) => store.lobby(code).players.map((player) => player.ready);

// Ready ---------------------------------------------------------------------

test('a player can ready up as soon as they join', () => {
  const { store, code } = openRoom();
  store.join('a', { v, code, name: 'Ada' });
  assert.deepEqual(store.setReady('a', { ready: true }), { ok: true, code });
  assert.deepEqual(readyFlags(store, code), [true]);
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
});

test('ready toggles on and off, and the snapshot reflects it', () => {
  const { store, code } = fullLobby();
  store.setReady('p1', { ready: true });
  assert.deepEqual(readyFlags(store, code), [false, true, false, false]);
  store.setReady('p1', { ready: false });
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
  // Sending the same state twice is fine.
  store.setReady('p2', { ready: true });
  assert.equal(store.setReady('p2', { ready: true }).ok, true);
  assert.deepEqual(readyFlags(store, code), [false, false, true, false]);
});

test(`everyone ready with fewer than ${PLAYERS_TO_START} players does not start the countdown`, () => {
  const { store, code } = openRoom();
  for (let i = 0; i < PLAYERS_TO_START - 1; i += 1) {
    store.join(`p${i}`, { v, code, name: `P${i}` });
    assert.equal(store.setReady(`p${i}`, { ready: true }).countdownStarted, undefined);
  }
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  assert.equal(store.lobby(code).countdown, null);
});

test('3 of 4 ready does not start the countdown', () => {
  const { store, code } = fullLobby();
  for (let i = 0; i < PLAYERS_TO_START - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
});

test('a bad ready payload is rejected and changes nothing', () => {
  const { store, code } = fullLobby();
  for (const payload of [undefined, null, {}, { ready: 'yes' }, { ready: 1 }, 'true']) {
    assert.deepEqual(store.setReady('p0', payload), { ok: false, error: ERRORS.BAD_READY });
  }
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
});

test('only players in a room can send ready', () => {
  const { store } = fullLobby();
  assert.deepEqual(store.setReady('stranger', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
  assert.deepEqual(store.setReady('tv', { ready: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});

test('ready is locked once the vote opens', () => {
  const { store, code } = openVote();
  assert.deepEqual(store.setReady('p0', { ready: false }), { ok: false, error: ERRORS.READY_LOCKED });
  // The flags were cleared when the vote opened.
  assert.deepEqual(readyFlags(store, code), [false, false, false, false]);
});

// Countdown -------------------------------------------------------------------

test(`all ${PLAYERS_TO_START} ready starts the countdown on its own`, () => {
  const { store, code } = fullLobby();
  for (let i = 0; i < PLAYERS_TO_START - 1; i += 1) store.setReady(`p${i}`, { ready: true });
  assert.deepEqual(store.setReady(`p${PLAYERS_TO_START - 1}`, { ready: true }), {
    ok: true,
    code,
    countdownStarted: true,
    msLeft: COUNTDOWN_MS,
  });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.COUNTDOWN);
  assert.deepEqual(lobby.countdown, { msLeft: COUNTDOWN_MS });
  assert.deepEqual(readyFlags(store, code), [true, true, true, true]);
});

test('countdown msLeft follows the clock and never goes negative', () => {
  const { store, code, clock } = fullLobby();
  everyoneReady(store);
  clock.t += 2000;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: COUNTDOWN_MS - 2000 });
  clock.t += COUNTDOWN_MS;
  assert.deepEqual(store.lobby(code).countdown, { msLeft: 0 });
});

test('un-readying during the countdown cancels it, and everyone else stays ready', () => {
  const { store, code } = fullLobby();
  everyoneReady(store);
  assert.deepEqual(store.setReady('p2', { ready: false }), { ok: true, code, countdownCancelled: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.LOBBY);
  assert.equal(lobby.countdown, null);
  assert.deepEqual(readyFlags(store, code), [true, true, false, true]);
  // Readying again restarts a fresh countdown.
  assert.equal(store.setReady('p2', { ready: true }).countdownStarted, true);
});

test('a player leaving during the countdown cancels it', () => {
  const { store, code, clock } = fullLobby();
  everyoneReady(store);
  assert.deepEqual(store.remove('p1'), { code, closed: false, countdownCancelled: true });
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  // The cancelled countdown's timer firing later changes nothing.
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
  // A new 4th player who readies up starts it again.
  store.join('new', { v, code, name: 'New' });
  assert.equal(store.setReady('new', { ready: true }).countdownStarted, true);
});

test('nobody can join during the countdown', () => {
  const store = new RoomStore({ maxPlayers: PLAYERS_TO_START + 1 });
  const { code } = openRoom(store);
  for (let i = 0; i < PLAYERS_TO_START; i += 1) store.join(`p${i}`, { v, code, name: `P${i}` });
  everyoneReady(store);
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

test('the countdown opens the vote, and not a moment early', () => {
  const { store, code, clock } = fullLobby();
  everyoneReady(store);
  clock.t += COUNTDOWN_MS - 1;
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  clock.t += 1;
  assert.deepEqual(store.finishCountdown(code), { code, msLeft: VOTE_MS });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.VOTE);
  assert.equal(lobby.countdown, null);
  assert.deepEqual(lobby.vote, { msLeft: VOTE_MS, voted: [] });
  // A second, stale timer changes nothing.
  assert.equal(store.finishCountdown(code), null);
  assert.equal(store.finishCountdown('ZZZZ'), null);
});

test('the host leaving during the countdown closes the room', () => {
  const { store, code, clock } = fullLobby();
  everyoneReady(store);
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, PLAYERS_TO_START);
  assert.equal(store.lobby(code), null);
  clock.t += COUNTDOWN_MS;
  assert.equal(store.finishCountdown(code), null);
});

// Tutorial vote ------------------------------------------------------------

test('a full lobby alone does not open the vote', () => {
  const { store, code } = fullLobby();
  assert.equal(store.lobby(code).phase, PHASES.LOBBY);
  assert.equal(store.lobby(code).vote, null);
  assert.deepEqual(store.vote('p0', { watch: true }), { ok: false, error: ERRORS.NO_VOTE });
});

test('vote msLeft counts down with the clock and never goes negative', () => {
  const { store, code, clock } = openVote();
  clock.t += 5000;
  assert.equal(store.lobby(code).vote.msLeft, VOTE_MS - 5000);
  clock.t += VOTE_MS;
  assert.equal(store.lobby(code).vote.msLeft, 0);
});

test('the open vote shows who voted but never their pick', () => {
  const { store, code } = openVote();
  assert.deepEqual(store.vote('p2', { watch: true }), { ok: true, code, resolved: false });
  store.vote('p0', { watch: false });
  assert.deepEqual(store.lobby(code).vote, { msLeft: VOTE_MS, voted: [0, 2] });
});

test('one Yes means the tutorial, and the resolved vote reveals every pick', () => {
  const { store, code } = openVote();
  store.vote('p0', { watch: false });
  store.vote('p1', { watch: true });
  store.vote('p2', { watch: false });
  assert.deepEqual(store.vote('p3', { watch: false }), { ok: true, code, resolved: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.TUTORIAL);
  assert.deepEqual(lobby.vote, {
    picks: [
      { slot: 0, pick: 'no' },
      { slot: 1, pick: 'yes' },
      { slot: 2, pick: 'no' },
      { slot: 3, pick: 'no' },
    ],
  });
});

test('all No skips to the game', () => {
  const { store, code } = openVote();
  everyoneVotes(store);
  assert.equal(store.lobby(code).phase, PHASES.GAME);
});

test('the vote resolves as soon as everyone has voted, before the deadline', () => {
  const { store, code } = openVote();
  for (let i = 0; i < PLAYERS_TO_START - 1; i += 1) {
    assert.equal(store.vote(`p${i}`, { watch: false }).resolved, false);
    assert.equal(store.lobby(code).phase, PHASES.VOTE);
  }
  assert.equal(store.vote(`p${PLAYERS_TO_START - 1}`, { watch: true }).resolved, true);
  assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
});

test('expireVote before the deadline does nothing', () => {
  const { store, code, clock } = openVote();
  clock.t += VOTE_MS - 1;
  assert.equal(store.expireVote(code), null);
  assert.equal(store.lobby(code).phase, PHASES.VOTE);
});

test('on timeout, non-voters count as No', () => {
  const { store, code, clock } = openVote();
  store.vote('p1', { watch: false });
  clock.t += VOTE_MS;
  assert.deepEqual(store.expireVote(code), { code });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.GAME);
  assert.deepEqual(lobby.vote.picks, [
    { slot: 0, pick: 'none' },
    { slot: 1, pick: 'no' },
    { slot: 2, pick: 'none' },
    { slot: 3, pick: 'none' },
  ]);
});

test('on timeout, one Yes still means the tutorial', () => {
  const { store, code, clock } = openVote();
  store.vote('p3', { watch: true });
  clock.t += VOTE_MS;
  store.expireVote(code);
  assert.equal(store.lobby(code).phase, PHASES.TUTORIAL);
});

test('a stale vote timer after the vote resolved is harmless', () => {
  const { store, code, clock } = openVote();
  everyoneVotes(store, (i) => i === 0);
  const before = store.lobby(code);
  clock.t += VOTE_MS;
  assert.equal(store.expireVote(code), null);
  assert.equal(store.expireVote('ZZZZ'), null);
  assert.deepEqual(store.lobby(code), before);
});

test('a vote is final', () => {
  const { store } = openVote();
  store.vote('p0', { watch: true });
  assert.deepEqual(store.vote('p0', { watch: false }), { ok: false, error: ERRORS.ALREADY_VOTED });
  assert.deepEqual(store.vote('p0', { watch: true }), { ok: false, error: ERRORS.ALREADY_VOTED });
});

test('voting after the vote resolved is rejected', () => {
  const { store } = openVote();
  everyoneVotes(store);
  assert.deepEqual(store.vote('p0', { watch: true }), { ok: false, error: ERRORS.NO_VOTE });
});

test('only players in a room can vote', () => {
  const { store } = openVote();
  assert.deepEqual(store.vote('stranger', { watch: true }), { ok: false, error: ERRORS.NOT_PLAYER });
  assert.deepEqual(store.vote('tv', { watch: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});

test('a bad vote payload is rejected and does not count', () => {
  const { store, code } = openVote();
  for (const payload of [undefined, null, {}, { watch: 'yes' }, { watch: 1 }, 'true']) {
    assert.deepEqual(store.vote('p0', payload), { ok: false, error: ERRORS.BAD_VOTE });
  }
  assert.deepEqual(store.lobby(code).vote.voted, []);
});

test('a player leaving cancels the vote; the lobby must ready up again for a fresh one', () => {
  const { store, code, clock } = openVote();
  store.vote('p0', { watch: true });
  assert.deepEqual(store.remove('p1'), { code, closed: false, voteCancelled: true });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.LOBBY);
  assert.equal(lobby.vote, null);
  assert.deepEqual(readyFlags(store, code), [false, false, false]);
  // The cancelled vote's timer firing later changes nothing.
  clock.t += VOTE_MS;
  assert.equal(store.expireVote(code), null);

  store.join('new', { v, code, name: 'New' });
  everyoneReady(store);
  store.setReady('new', { ready: true });
  assert.equal(store.lobby(code).phase, PHASES.COUNTDOWN);
  clock.t += COUNTDOWN_MS;
  store.finishCountdown(code);
  // A fresh vote: the full time, and p0's old Yes is gone.
  assert.deepEqual(store.lobby(code).vote, { msLeft: VOTE_MS, voted: [] });
});

test('leaving after the vote resolved keeps the result and the reveal', () => {
  const { store, code } = openVote();
  everyoneVotes(store, (i) => i === 2);
  assert.deepEqual(store.remove('p2'), { code, closed: false });
  const lobby = store.lobby(code);
  assert.equal(lobby.phase, PHASES.TUTORIAL);
  assert.equal(lobby.vote.picks.length, PLAYERS_TO_START);
});

test('nobody can join once the vote has resolved', () => {
  const { store, code } = openVote();
  everyoneVotes(store);
  store.remove('p0');
  assert.deepEqual(store.join('late', { v, code, name: 'Late' }), { ok: false, error: ERRORS.IN_PROGRESS });
});

test('the host leaving during the vote still closes the room', () => {
  const { store, code } = openVote();
  store.vote('p0', { watch: true });
  const result = store.remove('tv');
  assert.equal(result.closed, true);
  assert.equal(result.playerIds.length, PLAYERS_TO_START);
  assert.equal(store.lobby(code), null);
  assert.equal(store.expireVote(code), null);
  assert.deepEqual(store.vote('p1', { watch: true }), { ok: false, error: ERRORS.NOT_PLAYER });
});
