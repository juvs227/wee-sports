/**
 * The room protocol, shared by the server, the TV and the phones.
 *
 * Ported from gameboystudio's src/net/protocol.ts. It has to stay free of DOM
 * and Node APIs, because every side imports it.
 */

/** Bumped when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/**
 * No vowels, so a code can never spell a word. No lookalikes (0/O, 1/I, 8/B,
 * S), so nobody misreads it from the couch.
 */
export const CODE_ALPHABET = '23456789CDFGHJKLMNPQRTVWXYZ';

/** Four characters: easy to read off a TV and quick to type on a phone. */
export const CODE_LENGTH = 4;

export const MAX_PLAYERS = 4;
export const NAME_MAX = 12;

/** The countdown starts once this many players are in and every one is ready. */
export const PLAYERS_TO_START = 4;
/** The 5, 4, 3, 2, 1 once everyone is ready. */
export const COUNTDOWN_SECONDS = 5;
/** How long the tutorial vote stays open. Anyone who hasn't voted by then counts as No. */
export const VOTE_SECONDS = 20;

/** Sports a lobby can be opened for. Art and copy live in client/src/lib/sports.js. */
export const OPEN_SPORTS = ['tennis'];

/**
 * The moves each sport's tutorial teaches, in order, one step per move. A step
 * ends when every player who voted Yes has done its move. Art and copy live in
 * client/src/lib/tutorials.js.
 */
export const TUTORIAL_MOVES = {
  tennis: ['forehand', 'backhand', 'serve'],
};

/**
 * Where a lobby is:
 *
 *   'lobby' -> (everyone ready) -> 'countdown' -> 'vote' -> 'tutorial' | 'game'
 *   'tutorial' -> (every Yes voter did every move) -> 'game'
 *
 * Nobody touches the TV: phones press Ready, vote, and do the tutorial moves.
 * Un-readying or leaving during the countdown, or leaving during the vote,
 * sends it back to 'lobby'.
 */
export const PHASES = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  VOTE: 'vote',
  TUTORIAL: 'tutorial',
  GAME: 'game',
};

/**
 * Every lobby snapshot below has this shape:
 *
 *   { code, sport, phase, players: [{ slot, name, ready }], countdown, vote, tutorial }
 *
 * ready can only be true in 'lobby' and 'countdown'.
 *
 * countdown is null except in 'countdown', where it is { msLeft }.
 *
 * vote is null until the vote opens. While it is open it says who has voted
 * but not what they picked: { msLeft, voted: [slot] }. Once resolved, it
 * reveals every pick: { picks: [{ slot, pick: 'yes' | 'no' | 'none' }] }.
 *
 * tutorial is null except in 'tutorial', where it is
 * { step, moves, learners: [slot], done: [slot] }. moves is the sport's
 * TUTORIAL_MOVES and step indexes it. learners are the players who voted Yes;
 * done is which of them have done the current step's move.
 *
 * msLeft is time remaining, not a timestamp, so clock skew between devices
 * doesn't matter.
 */
export const EVENTS = {
  /** TV -> server: open a lobby. Ack: { ok, ...snapshot }. */
  HOST_CREATE: 'host:create',
  /** TV -> server: the TV page went away. */
  HOST_CLOSE: 'host:close',
  /** TV -> server: current lobby, if this socket hosts it. Ack: { ok, ...snapshot }. */
  LOBBY_GET: 'lobby:get',
  /** Phone -> server: take a seat. Ack: { ok, slot, name, ...snapshot }. */
  PLAYER_JOIN: 'player:join',
  /** Phone -> server: give the seat back. */
  PLAYER_LEAVE: 'player:leave',
  /** Phone -> server: { ready: boolean }. Toggles in the lobby and during the countdown. Ack: { ok }. */
  PLAYER_READY: 'player:ready',
  /** Phone -> server: { watch: boolean }. One final vote per player. Ack: { ok }. */
  TUTORIAL_VOTE: 'tutorial:vote',
  /**
   * Phone -> server: { step }. This learner did the move for that step. Sent
   * by the motion controls once they recognize the move. Repeats and a step
   * that has already ended are harmless. Ack: { ok }.
   */
  TUTORIAL_MOVE: 'tutorial:move',
  /** Server -> everyone in a lobby: the snapshot. */
  LOBBY_UPDATE: 'lobby:update',
  /** Server -> phones: the TV left, so there is nothing left to control. */
  ROOM_CLOSED: 'room:closed',
};

export const ERRORS = {
  NO_ROOM: 'no-room',
  ROOM_FULL: 'room-full',
  BAD_NAME: 'bad-name',
  BAD_VERSION: 'bad-version',
  BAD_SPORT: 'bad-sport',
  SERVER_BUSY: 'server-busy',
  IN_PROGRESS: 'in-progress',
  NOT_PLAYER: 'not-player',
  READY_LOCKED: 'ready-locked',
  BAD_READY: 'bad-ready',
  NO_VOTE: 'no-vote',
  BAD_VOTE: 'bad-vote',
  ALREADY_VOTED: 'already-voted',
  NO_TUTORIAL: 'no-tutorial',
  NOT_LEARNER: 'not-learner',
  BAD_MOVE: 'bad-move',
};

/** What a resolved vote shows for each player. */
export const PICKS = {
  YES: 'yes',
  NO: 'no',
  NONE: 'none',
};

export function isRoomCode(value) {
  return (
    typeof value === 'string' &&
    value.length === CODE_LENGTH &&
    [...value].every((character) => CODE_ALPHABET.includes(character))
  );
}

/** Uppercases and drops anything a code can't contain, so typing "k7pm" still works. */
export function normalizeCode(value) {
  return [...String(value ?? '').toUpperCase()]
    .filter((character) => CODE_ALPHABET.includes(character))
    .slice(0, CODE_LENGTH)
    .join('');
}

/**
 * Strips control characters, collapses whitespace and caps the length.
 * Returns '' when nothing usable is left. Counts code points, not UTF-16
 * units, so an emoji is never cut in half.
 */
export function cleanName(value) {
  if (typeof value !== 'string') return '';
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...collapsed].slice(0, NAME_MAX).join('').trim();
}
