/**
 * Every lobby the server knows about, with no networking in it.
 *
 * The rules are ported from gameboystudio's RoomServer: a code is the room's
 * address, a room has exactly one TV, seats are capped, and when the TV leaves
 * the room closes instead of leaving phones on a dead connection. Socket.io
 * lives in index.js. Keeping it out of here means the tests exercise the same
 * code that runs in production.
 *
 * Ids are opaque strings (socket ids in production).
 *
 * There are no timers in here either. The countdown deadline is read from an
 * injectable clock, and index.js owns the setTimeout that calls
 * finishCountdown().
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  COUNTDOWN_SECONDS,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  OPEN_SPORTS,
  PHASES,
  PROTOCOL_VERSION,
  READY_AT_PLAYERS,
  cleanName,
  isRoomCode,
} from '@wee/shared/protocol.js';

const MAX_CODE_ATTEMPTS = 50;

/**
 * Where a lobby goes once every player is ready. The one place to change if
 * something (the tutorial vote, say) should come between the ready check and
 * the TV's Play button.
 */
function nextPhaseAfterReady() {
  return PHASES.ALL_READY;
}

/** Phases where a full lobby is part of the deal, so a leaver sends everyone back to 'lobby'. */
const NEEDS_FULL_LOBBY = new Set([PHASES.READY, PHASES.ALL_READY, PHASES.COUNTDOWN]);

export function randomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomStore {
  /**
   * code -> { code, sport, hostId, phase, players: Map<id, { slot, name, ready }>, deadline }
   *
   * deadline is when the countdown ends, or null when none is running.
   */
  #rooms = new Map();
  /** id -> { code, role: 'host' | 'player' } */
  #members = new Map();
  #makeCode;
  #maxPlayers;
  #now;

  constructor({ makeCode = randomCode, maxPlayers = MAX_PLAYERS, now = Date.now } = {}) {
    this.#makeCode = makeCode;
    this.#maxPlayers = maxPlayers;
    this.#now = now;
  }

  get roomCount() {
    return this.#rooms.size;
  }

  /** Callers remove() the id first. One socket is in at most one room. */
  createRoom(hostId, { v, sport } = {}) {
    if (v !== PROTOCOL_VERSION) return { ok: false, error: ERRORS.BAD_VERSION };
    if (!OPEN_SPORTS.includes(sport)) return { ok: false, error: ERRORS.BAD_SPORT };

    let code = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = this.#makeCode();
      if (!this.#rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) return { ok: false, error: ERRORS.SERVER_BUSY };

    this.#rooms.set(code, { code, sport, hostId, phase: PHASES.LOBBY, players: new Map(), deadline: null });
    this.#members.set(hostId, { code, role: 'host' });
    return { ok: true, ...this.lobby(code) };
  }

  join(playerId, { v, code, name } = {}) {
    if (v !== PROTOCOL_VERSION) return { ok: false, error: ERRORS.BAD_VERSION };
    const room = isRoomCode(code) ? this.#rooms.get(code) : undefined;
    if (!room) return { ok: false, error: ERRORS.NO_ROOM };

    const cleaned = cleanName(name);
    if (!cleaned) return { ok: false, error: ERRORS.BAD_NAME };

    const slot = this.#freeSlot(room);
    if (slot === null) return { ok: false, error: ERRORS.ROOM_FULL };
    // Seats only change in the lobby. A newcomer can't drop into a ready check
    // or a game that has started.
    if (room.phase !== PHASES.LOBBY) return { ok: false, error: ERRORS.IN_PROGRESS };

    const unique = this.#uniqueName(room, cleaned);
    room.players.set(playerId, { slot, name: unique, ready: false });
    this.#members.set(playerId, { code, role: 'player' });
    if (room.players.size >= READY_AT_PLAYERS) room.phase = PHASES.READY;
    return { ok: true, slot, name: unique, ...this.lobby(code) };
  }

  /**
   * Ready or not ready. Players can change their mind until everyone is
   * ready; then the lobby moves on and the result says so.
   */
  setReady(playerId, payload) {
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.READY) return { ok: false, error: ERRORS.NO_READY_CHECK };
    const ready = payload?.ready;
    if (typeof ready !== 'boolean') return { ok: false, error: ERRORS.BAD_READY };

    room.players.get(playerId).ready = ready;
    const advanced = [...room.players.values()].every((player) => player.ready);
    if (advanced) {
      this.#clearReady(room);
      room.phase = nextPhaseAfterReady();
    }
    return { ok: true, code: room.code, advanced };
  }

  /** The TV's Play button. Only the room's TV, and only once everyone is ready. */
  start(hostId) {
    const member = this.#members.get(hostId);
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.ALL_READY) return { ok: false, error: ERRORS.NOT_ALL_READY };

    room.phase = PHASES.COUNTDOWN;
    room.deadline = this.#now() + COUNTDOWN_SECONDS * 1000;
    return { ok: true, code: room.code, msLeft: COUNTDOWN_SECONDS * 1000 };
  }

  /**
   * Moves on to the tutorial once the countdown's deadline has passed.
   * Returns null and changes nothing otherwise, so a stale or early timer is
   * harmless.
   */
  finishCountdown(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.COUNTDOWN || this.#now() < room.deadline) return null;
    room.phase = PHASES.TUTORIAL;
    room.deadline = null;
    return { code };
  }

  /** What the TV and phones render. Null when the room doesn't exist. */
  lobby(code) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const players = [...room.players.values()]
      .map(({ slot, name, ready }) => ({ slot, name, ready }))
      .sort((a, b) => a.slot - b.slot);
    const countdown =
      room.phase === PHASES.COUNTDOWN ? { msLeft: Math.max(0, room.deadline - this.#now()) } : null;
    return { code: room.code, sport: room.sport, phase: room.phase, players, countdown };
  }

  /** The code this id is hosting, or null. */
  hostedBy(id) {
    const member = this.#members.get(id);
    return member?.role === 'host' ? member.code : null;
  }

  /**
   * Takes an id out of whatever room it is in.
   *
   * Returns null if it wasn't in one. A host leaving closes the room, and the
   * result lists the players to tell. A player leaving frees their seat.
   */
  remove(id) {
    const member = this.#members.get(id);
    if (!member) return null;
    this.#members.delete(id);

    const room = this.#rooms.get(member.code);
    if (!room) return null;

    if (member.role === 'host') {
      const playerIds = [...room.players.keys()];
      for (const playerId of playerIds) this.#members.delete(playerId);
      this.#rooms.delete(room.code);
      return { code: room.code, closed: true, playerIds };
    }

    room.players.delete(id);
    // Everything from the ready check to the countdown needs a full lobby, so a
    // leaver ends it. The next player to fill the lobby starts a fresh check.
    if (NEEDS_FULL_LOBBY.has(room.phase)) {
      const countdownCancelled = room.phase === PHASES.COUNTDOWN;
      room.phase = PHASES.LOBBY;
      room.deadline = null;
      this.#clearReady(room);
      if (countdownCancelled) return { code: room.code, closed: false, countdownCancelled };
    }
    return { code: room.code, closed: false };
  }

  #clearReady(room) {
    for (const player of room.players.values()) player.ready = false;
  }

  /** Lowest open seat, so a seat freed by a leaver is the next one filled. */
  #freeSlot(room) {
    const taken = new Set([...room.players.values()].map((player) => player.slot));
    for (let slot = 0; slot < this.#maxPlayers; slot += 1) {
      if (!taken.has(slot)) return slot;
    }
    return null;
  }

  /** "Sam", then "Sam 2", "Sam 3". Compared case-insensitively. */
  #uniqueName(room, name) {
    const taken = new Set([...room.players.values()].map((player) => player.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n += 1) {
      const suffix = ` ${n}`;
      // Shorten the name, not the number, so the result still fits NAME_MAX.
      const base = [...name].slice(0, NAME_MAX - suffix.length).join('').trim();
      const candidate = `${base}${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }
}
