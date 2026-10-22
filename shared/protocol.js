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

/** The ready check starts when the lobby reaches this many players. */
export const READY_AT_PLAYERS = 4;
/** The 5, 4, 3, 2, 1 after the TV presses Play. */
export const COUNTDOWN_SECONDS = 5;

/** Sports a lobby can be opened for. Art and copy live in client/src/lib/sports.js. */
export const OPEN_SPORTS = ['tennis'];

/**
 * Where a lobby is:
 *
 *   'lobby' -> 'ready' -> 'all-ready' -> (TV presses Play) -> 'countdown' -> 'tutorial'
 *
 * A player leaving anywhere before 'tutorial' sends it back to 'lobby'.
 */
export const PHASES = {
  LOBBY: 'lobby',
  READY: 'ready',
  ALL_READY: 'all-ready',
  COUNTDOWN: 'countdown',
  TUTORIAL: 'tutorial',
};

/**
 * Every lobby snapshot below has this shape:
 *
 *   { code, sport, phase, players: [{ slot, name, ready }], countdown }
 *
 * ready is always false outside the 'ready' phase. countdown is null except
 * in 'countdown', where it is { msLeft }: time remaining, not a timestamp, so
 * clock skew between devices doesn't matter.
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
  /** TV -> server: Play, once everyone is ready. Starts the countdown. Ack: { ok }. */
  HOST_START: 'host:start',
  /** Phone -> server: give the seat back. */
  PLAYER_LEAVE: 'player:leave',
  /** Phone -> server: { ready: boolean }. Can be toggled until everyone is ready. Ack: { ok }. */
  PLAYER_READY: 'player:ready',
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
  NO_READY_CHECK: 'no-ready-check',
  BAD_READY: 'bad-ready',
  NOT_HOST: 'not-host',
  NOT_ALL_READY: 'not-all-ready',
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
