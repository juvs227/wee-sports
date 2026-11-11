/**
 * The room protocol, shared by the server, the TV and the phones.
 *
 * Ported from gameboystudio's src/net/protocol.ts. It has to stay free of DOM
 * and Node APIs, because every side imports it.
 */

/** Bumped when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 4;

/** A dropped connection keeps its seat for one minute. */
export const RECONNECT_MS = 60_000;

/**
 * No vowels, so a code can never spell a word. No lookalikes (0/O, 1/I, 8/B,
 * S), so nobody misreads it from the couch.
 */
export const CODE_ALPHABET = '23456789CDFGHJKLMNPQRTVWXYZ';

/** Four characters: easy to read off a TV and quick to type on a phone. */
export const CODE_LENGTH = 4;

/** Largest supported party; tennis has two playing seats. */
export const MAX_PLAYERS = 4;
export function playerCapacity(sport) {
  return sport === 'tennis' ? 2 : sport === 'bowling' ? MAX_PLAYERS : 0;
}
export const NAME_MAX = 12;

/** One controller can play the current tennis prototype against the bot. */
export const READY_AT_PLAYERS = 1;
/** The 5, 4, 3, 2, 1 that starts by itself once every player is ready. */
export const COUNTDOWN_SECONDS = 5;
/** How long the tutorial vote stays open. Anyone who hasn't voted by then counts as No. */
export const VOTE_SECONDS = 20;

/** Sports a lobby can be opened for. Art and copy live in client/src/lib/sports.js. */
export const OPEN_SPORTS = ['tennis', 'bowling'];

export function isController(sport, slot) {
  return Number.isInteger(slot) && slot >= 0 && slot < playerCapacity(sport);
}

/**
 * The moves each sport's tutorial teaches, in order, one step per move. A step
 * ends when every player who voted Yes has done its move. A sport with no
 * entry skips the vote and goes straight from the countdown to the game. Art
 * and copy live in client/src/lib/tutorials.js.
 */
export const TUTORIAL_MOVES = {
  tennis: ['forehand', 'backhand', 'serve'],
};

export function hasTutorial(sport) {
  return Object.hasOwn(TUTORIAL_MOVES, sport);
}

/**
 * Where a lobby is:
 *
 *   'lobby' -> 'ready' -> (everyone ready) -> 'calibration' -> (TV confirms) -> 'countdown' -> 'vote' -> 'tutorial' | 'game'
 *   'tutorial' -> (every Yes voter did every move) -> 'game'
 *
 * Nobody touches the TV: phones press Ready, vote, and do the tutorial moves.
 * A sport without TUTORIAL_MOVES goes from 'countdown' straight to 'game'.
 * Un-readying during the countdown cancels it back to 'ready'. Seat changes
 * before the game reset readiness; an empty P1 seat waits in 'lobby'.
 */
export const PHASES = {
  LOBBY: 'lobby',
  READY: 'ready',
  CALIBRATION: 'calibration',
  COUNTDOWN: 'countdown',
  VOTE: 'vote',
  TUTORIAL: 'tutorial',
  GAME: 'game',
};

/**
 * Every lobby snapshot below has this shape:
 *
 *   { code, sport, phase, players: [{ slot, name, ready, setup }], countdown,
 *     vote, tutorial, paused, reconnecting: [{ name, msLeft }], setupPending: [name] }
 *
 * Create/join/resume acknowledgements additionally contain a private token
 * and role. Never send those fields in LOBBY_UPDATE or include them in a URL.
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
 * ready can only be true in 'ready' and 'countdown'. countdown is null except
 * in 'countdown', where it is { msLeft }: time remaining, not a timestamp, so
 * clock skew between devices doesn't matter.
 */
export const EVENTS = {
  /** TV -> server: open a lobby. Ack: { ok, ...snapshot }. */
  HOST_CREATE: 'host:create',
  SESSION_RESUME: 'session:resume',
  SESSION_AWAY: 'session:away',
  SESSION_REPLACED: 'session:replaced',
  /** TV -> server: explicitly close the lobby. Refreshes use session recovery. */
  HOST_CLOSE: 'host:close',
  /** TV -> server: current lobby, if this socket hosts it. Ack: { ok, ...snapshot }. */
  LOBBY_GET: 'lobby:get',
  /** Phone -> server: take a seat. Ack: { ok, slot, name, ...snapshot }. */
  PLAYER_JOIN: 'player:join',
  /** TV or P1 -> server: { gameId }. End this match while keeping the lobby and controller setup. */
  HOST_RETURN_TO_LOBBY: 'host:return-to-lobby',
  PLAYER_RETURN_TO_LOBBY: 'player:return-to-lobby',
  /** Current TV/P1 -> server: { gameId, paused }. Explicit, shared manual pause. */
  HOST_PAUSE: 'host:pause',
  PLAYER_PAUSE: 'player:pause',
  /** Phone -> server: give the seat back. */
  PLAYER_LEAVE: 'player:leave',
  /**
   * Phone -> server: { ready: boolean }. Toggles during the ready check and the
   * countdown. The last player to ready up starts the countdown; un-readying
   * during it cancels it. Ack: { ok }.
   */
  PLAYER_READY: 'player:ready',
  /** TV -> server: all players have finished orientation calibration. Start the countdown. */
  HOST_CALIBRATION_DONE: 'host:calibration-done',
  /** Phone -> server: this player has finished orientation calibration. */
  PLAYER_CALIBRATION_DONE: 'player:calibration-done',
  /** Phone -> server -> TV: live calibration progress (0–1). Volatile/throttled. */
  PLAYER_CALIBRATION_PROGRESS: 'player:calibration-progress',
  /** Phone -> server: { watch: boolean }. One final vote per player. Ack: { ok }. */
  TUTORIAL_VOTE: 'tutorial:vote',
  /**
   * Phone -> server: { step }. This learner did the move for that step. Repeats
   * and a step that has already ended are harmless. Ack: { ok }.
   */
  TUTORIAL_MOVE: 'tutorial:move',
  /** Controller setup is reported by each phone before it can become ready. */
  PLAYER_SETUP: 'player:setup',
  /** Current TV or seated phone -> shared TV sound preference for this lobby. */
  SOUND_SET: 'sound:set',
  /** P1 phone -> its TV: validated match options, with an actual game acknowledgement. */
  PLAYER_GAME_COMMAND: 'player:game-command',
  GAME_COMMAND: 'game:command',
  /** TV -> server: applied options, shared back to the phones in lobby snapshots. */
  HOST_GAME_OPTIONS: 'host:game-options',
  /** Joined P1/P2 -> server -> its TV. The server assigns the player number. */
  PLAYER_SWING: 'player:swing',
  GAME_SWING: 'game:swing',
  PLAYER_ROLL: 'player:roll',
  GAME_ROLL: 'game:roll',
  HOST_GAME_STATE: 'host:game-state',
  /** TV -> server -> the contacted player's phone. Transient collision feedback. */
  HOST_GAME_HIT: 'host:game-hit',
  GAME_HIT: 'game:hit',
  HOST_STROKE_RESULT: 'host:stroke-result',
  GAME_STROKE_RESULT: 'game:stroke-result',
  /** Server -> everyone in a lobby: the snapshot. */
  LOBBY_UPDATE: 'lobby:update',
  /** Server -> phones: the TV closed the lobby or its reconnect window expired. */
  ROOM_CLOSED: 'room:closed',
};

export function isSwing(event) {
  return event?.type === 'swing' && typeof event.id === 'string' && event.id.length > 0 &&
    event.id.length <= 100 && ['Forehand', 'Backhand'].includes(event.label) &&
    ['Left', 'Right'].includes(event.hand) &&
    (event.power === undefined || (Number.isFinite(event.power) && event.power >= 0 && event.power <= 1));
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIdentifier = value => typeof value === 'string' && value.length > 0 && value.length <= 100;
const optionValidators = {
  assistance: value => ['beginner', 'standard'].includes(value),
  botDifficulty: value => ['beginner', 'standard'].includes(value),
  autoMove: value => typeof value === 'boolean',
  timingAssist: value => typeof value === 'boolean',
  splitView: value => typeof value === 'boolean',
};
const validPractice = practice => isRecord(practice) && typeof practice.active === 'boolean' &&
  ['alternate', 'forehand', 'backhand'].includes(practice.stroke) && ['Right', 'Left'].includes(practice.hand);

/** Commands intentionally expose game settings, never arbitrary methods or DOM selectors. */
export function isGameCommand(event, sport) {
  if (!isRecord(event) || !isIdentifier(event.id) || !isIdentifier(event.gameId)) return false;
  let fields = ['id', 'gameId', 'action'];
  let valid = false;
  if (sport === 'bowling') valid = event.action === 'new-match';
  else if (sport === 'tennis') {
    if (event.action === 'configure') {
      fields.push('settings');
      valid = isRecord(event.settings) && Object.keys(event.settings).length > 0 &&
        Object.entries(event.settings).every(([key, value]) => Object.hasOwn(optionValidators, key) && optionValidators[key](value));
    } else if (event.action === 'new-match') {
      fields.push('format'); valid = ['full', 'quick'].includes(event.format);
    } else if (event.action === 'practice-start') {
      fields.push('stroke', 'hand');
      valid = ['alternate', 'forehand', 'backhand'].includes(event.stroke) && ['Right', 'Left'].includes(event.hand);
    } else valid = event.action === 'practice-stop';
  }
  return valid && Object.keys(event).every(key => fields.includes(key));
}

/** The host reports actual applied options; phones do not optimistically own simulation state. */
export function isGameOptions(snapshot, sport) {
  if (!isRecord(snapshot) || !isIdentifier(snapshot.gameId) || snapshot.sport !== sport) return false;
  if (sport === 'bowling') return true;
  return sport === 'tennis' && isRecord(snapshot.settings) &&
    Object.entries(optionValidators).every(([key, validate]) => validate(snapshot.settings[key])) &&
    ['full', 'quick'].includes(snapshot.settings.format) &&
    validPractice(snapshot.practice) && typeof snapshot.humanOpponent === 'boolean';
}

/** TV-published tennis status; scoring/physics remain on the TV. */
export function isTennisState(state) {
  return ['prepare', 'serve', 'rally', 'complete'].includes(state?.phase) &&
    (state.practice === undefined || typeof state.practice === 'boolean') &&
    (state.serveAttempt === undefined || [1, 2].includes(state.serveAttempt)) &&
    [1, 2].includes(state.server) && (state.phase === 'complete'
      ? [1, 2].includes(state.winner) : state.winner === null);
}

/** Optional final results keep older bowling TVs compatible; names stay in the lobby roster. */
export function isBowlingState(state) {
  if (!isRecord(state) || !['ready', 'rolling', 'complete'].includes(state.phase) ||
      !Number.isInteger(state.frame) || state.frame < 1 || state.frame > 10) return false;
  if (state.phase !== 'complete') {
    return Number.isInteger(state.currentPlayer) && state.currentPlayer >= 1 && state.currentPlayer <= 4 &&
      state.winners === undefined && state.winnerScore === undefined;
  }
  if (state.currentPlayer !== null || state.frame !== 10) return false;
  if (state.winners === undefined && state.winnerScore === undefined) return true;
  return Array.isArray(state.winners) && state.winners.length > 0 && state.winners.length <= 4 &&
    state.winners.every(player => Number.isInteger(player) && player >= 1 && player <= 4) &&
    new Set(state.winners).size === state.winners.length &&
    Number.isInteger(state.winnerScore) && state.winnerScore >= 0 && state.winnerScore <= 300;
}

export function isStrokeResult(event) {
  return typeof event?.id === 'string' && event.id.length > 0 && event.id.length <= 100 &&
    typeof event.gameId === 'string' && event.gameId.length > 0 && event.gameId.length <= 100 &&
    [1, 2].includes(event.player) && ['hit', 'miss', 'rejected'].includes(event.result) &&
    typeof event.reason === 'string' && event.reason.length <= 160 &&
    (event.receivedToContactMs === undefined || (event.result === 'hit' &&
      Number.isFinite(event.receivedToContactMs) && event.receivedToContactMs >= 0 && event.receivedToContactMs <= 10000));
}

export function isGameSoundEvent(sport, event) {
  const events = sport === 'tennis'
    ? ['hit', 'bounce', 'serve', 'point', 'game', 'set', 'match', 'fault', 'let', 'start', 'stop']
    : sport === 'bowling' ? ['release', 'roll', 'roll-end', 'pin', 'gutter', 'strike', 'spare', 'result', 'match', 'start', 'stop'] : [];
  return events.includes(event);
}

export function isRoll(event) {
  return event?.type === 'roll' && typeof event.id === 'string' && event.id.length > 0 &&
    event.id.length <= 100 && Number.isFinite(event.power) && event.power >= 0 && event.power <= 1 &&
    Number.isFinite(event.spin) && Math.abs(event.spin) <= 1 &&
    Number.isFinite(event.aim) && Math.abs(event.aim) <= 1;
}

export function isTennisHit(event) {
  return isGameHit(event, 'tennis');
}

export function isGameHit(event, sport) {
  return ['tennis', 'bowling'].includes(sport) &&
    (event?.kind === undefined || event.kind === sport) &&
    typeof event?.id === 'string' && event.id.length > 0 && event.id.length <= 100 &&
    typeof event.gameId === 'string' && event.gameId.length > 0 && event.gameId.length <= 100 &&
    Number.isInteger(event.player) && event.player >= 1 && event.player <= (sport === 'tennis' ? 2 : 4);
}

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
  NO_VOTE: 'no-vote',
  BAD_VOTE: 'bad-vote',
  ALREADY_VOTED: 'already-voted',
  NO_TUTORIAL: 'no-tutorial',
  NOT_LEARNER: 'not-learner',
  BAD_MOVE: 'bad-move',
  BAD_SESSION: 'bad-session',
  ALREADY_IN_ROOM: 'already-in-room',
  PAUSED: 'paused',
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
