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
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  OPEN_SPORTS,
  PROTOCOL_VERSION,
  cleanName,
  isRoomCode,
} from '@wee/shared/protocol.js';

const MAX_CODE_ATTEMPTS = 50;

export function randomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomStore {
  /** code -> { code, sport, hostId, players: Map<id, { slot, name }> } */
  #rooms = new Map();
  /** id -> { code, role: 'host' | 'player' } */
  #members = new Map();
  #makeCode;
  #maxPlayers;

  constructor({ makeCode = randomCode, maxPlayers = MAX_PLAYERS } = {}) {
    this.#makeCode = makeCode;
    this.#maxPlayers = maxPlayers;
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

    this.#rooms.set(code, { code, sport, hostId, players: new Map() });
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

    const unique = this.#uniqueName(room, cleaned);
    room.players.set(playerId, { slot, name: unique });
    this.#members.set(playerId, { code, role: 'player' });
    return { ok: true, slot, name: unique, ...this.lobby(code) };
  }

  /** What the TV and phones render. Null when the room doesn't exist. */
  lobby(code) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const players = [...room.players.values()]
      .map(({ slot, name }) => ({ slot, name }))
      .sort((a, b) => a.slot - b.slot);
    return { code: room.code, sport: room.sport, players };
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
    return { code: room.code, closed: false };
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
