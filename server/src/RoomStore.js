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
 * There are no timers in here either. The vote deadline is read from an
 * injectable clock, and index.js owns the setTimeout that calls expireVote().
 */

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  ERRORS,
  MAX_PLAYERS,
  NAME_MAX,
  OPEN_SPORTS,
  PHASES,
  PICKS,
  PROTOCOL_VERSION,
  VOTE_AT_PLAYERS,
  VOTE_SECONDS,
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
  /**
   * code -> { code, sport, hostId, phase, players: Map<id, { slot, name }>, vote }
   *
   * vote is null in 'lobby', { deadline, picks: Map<id, boolean> } while open,
   * and { picks: [{ slot, pick }] } once resolved, frozen so a later leaver
   * doesn't erase what they picked.
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

    this.#rooms.set(code, { code, sport, hostId, phase: PHASES.LOBBY, players: new Map(), vote: null });
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
    // Seats only change in the lobby. A newcomer can't vote in a vote that is
    // already open, or drop into a game that has started.
    if (room.phase !== PHASES.LOBBY) return { ok: false, error: ERRORS.IN_PROGRESS };

    const unique = this.#uniqueName(room, cleaned);
    room.players.set(playerId, { slot, name: unique });
    this.#members.set(playerId, { code, role: 'player' });

    const voteOpened = room.players.size >= VOTE_AT_PLAYERS;
    if (voteOpened) {
      room.phase = PHASES.VOTE;
      room.vote = { deadline: this.#now() + VOTE_SECONDS * 1000, picks: new Map() };
    }
    return { ok: true, slot, name: unique, voteOpened, ...this.lobby(code) };
  }

  /**
   * One final tutorial vote. watch: true is Yes. The vote resolves as soon as
   * every player has voted, and the result says whether it did.
   */
  vote(playerId, payload) {
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.VOTE) return { ok: false, error: ERRORS.NO_VOTE };
    const watch = payload?.watch;
    if (typeof watch !== 'boolean') return { ok: false, error: ERRORS.BAD_VOTE };
    if (room.vote.picks.has(playerId)) return { ok: false, error: ERRORS.ALREADY_VOTED };

    room.vote.picks.set(playerId, watch);
    const resolved = room.vote.picks.size === room.players.size;
    if (resolved) this.#resolveVote(room);
    return { ok: true, code: room.code, resolved };
  }

  /**
   * Resolves the vote once its deadline has passed; anyone who hasn't voted
   * counts as No. Returns null and changes nothing otherwise, so a stale or
   * early timer is harmless.
   */
  expireVote(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.VOTE || this.#now() < room.vote.deadline) return null;
    this.#resolveVote(room);
    return { code };
  }

  /** What the TV and phones render. Null when the room doesn't exist. */
  lobby(code) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const players = [...room.players.values()]
      .map(({ slot, name }) => ({ slot, name }))
      .sort((a, b) => a.slot - b.slot);
    return { code: room.code, sport: room.sport, phase: room.phase, players, vote: this.#voteView(room) };
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
    // Everyone has to get a say, so a leaver cancels the vote. The next
    // player to fill the lobby opens a fresh one.
    if (room.phase === PHASES.VOTE) {
      room.phase = PHASES.LOBBY;
      room.vote = null;
      return { code: room.code, closed: false, voteCancelled: true };
    }
    return { code: room.code, closed: false };
  }

  /** Any Yes means the tutorial. Picks are frozen by slot for the reveal. */
  #resolveVote(room) {
    const { picks } = room.vote;
    const frozen = [...room.players.entries()]
      .map(([id, { slot }]) => {
        if (!picks.has(id)) return { slot, pick: PICKS.NONE };
        return { slot, pick: picks.get(id) ? PICKS.YES : PICKS.NO };
      })
      .sort((a, b) => a.slot - b.slot);
    room.phase = frozen.some(({ pick }) => pick === PICKS.YES) ? PHASES.TUTORIAL : PHASES.GAME;
    room.vote = { picks: frozen };
  }

  /** While the vote is open, only who has voted. Never what they picked. */
  #voteView(room) {
    if (!room.vote) return null;
    if (room.phase !== PHASES.VOTE) return { picks: room.vote.picks.map((entry) => ({ ...entry })) };
    const voted = [...room.vote.picks.keys()].map((id) => room.players.get(id).slot).sort((a, b) => a - b);
    return { msLeft: Math.max(0, room.vote.deadline - this.#now()), voted };
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
