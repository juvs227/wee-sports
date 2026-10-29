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
 * There are no timers in here either. Deadlines are read from an injectable
 * clock, and index.js owns the setTimeouts that call finishCountdown() and
 * expireVote().
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
  PICKS,
  PLAYERS_TO_START,
  PROTOCOL_VERSION,
  TUTORIAL_MOVES,
  VOTE_SECONDS,
  cleanName,
  isRoomCode,
} from '@wee/shared/protocol.js';

const MAX_CODE_ATTEMPTS = 50;
const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;
const VOTE_MS = VOTE_SECONDS * 1000;

/** Ready can be changed while waiting and during the countdown, which it can cancel. */
const READY_PHASES = new Set([PHASES.LOBBY, PHASES.COUNTDOWN]);

export function randomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomStore {
  /**
   * code -> { code, sport, hostId, phase, players: Map<id, { slot, name, ready }>, countdownEnds, vote, tutorial }
   *
   * countdownEnds is when the countdown finishes, or null when none is running.
   * vote is null until it opens, { deadline, picks: Map<id, boolean> } while
   * open, and { picks: [{ slot, pick }] } once resolved, frozen so a later
   * leaver doesn't erase what they picked.
   * tutorial is null outside 'tutorial', and { step, learners: Set<id>,
   * done: Set<id> } in it. learners are the Yes voters still in the room.
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

    this.#rooms.set(code, {
      code,
      sport,
      hostId,
      phase: PHASES.LOBBY,
      players: new Map(),
      countdownEnds: null,
      vote: null,
      tutorial: null,
    });
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
    // Seats only change in the lobby. A newcomer can't drop into a countdown,
    // a vote, or a game that has started.
    if (room.phase !== PHASES.LOBBY) return { ok: false, error: ERRORS.IN_PROGRESS };

    const unique = this.#uniqueName(room, cleaned);
    room.players.set(playerId, { slot, name: unique, ready: false });
    this.#members.set(playerId, { code, role: 'player' });
    return { ok: true, slot, name: unique, ...this.lobby(code) };
  }

  /**
   * Ready or not ready, from the moment a player joins. When the lobby is full
   * and everyone is ready, the countdown starts; anyone un-readying during it
   * cancels it. The result says which happened, so index.js can run the timer.
   */
  setReady(playerId, payload) {
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (!READY_PHASES.has(room?.phase)) return { ok: false, error: ERRORS.READY_LOCKED };
    const ready = payload?.ready;
    if (typeof ready !== 'boolean') return { ok: false, error: ERRORS.BAD_READY };

    room.players.get(playerId).ready = ready;

    if (room.phase === PHASES.LOBBY && this.#everyoneReady(room)) {
      room.phase = PHASES.COUNTDOWN;
      room.countdownEnds = this.#now() + COUNTDOWN_MS;
      return { ok: true, code: room.code, countdownStarted: true, msLeft: COUNTDOWN_MS };
    }
    if (room.phase === PHASES.COUNTDOWN && !ready) {
      this.#cancelCountdown(room);
      return { ok: true, code: room.code, countdownCancelled: true };
    }
    return { ok: true, code: room.code };
  }

  /**
   * Opens the tutorial vote once the countdown's deadline has passed. Returns
   * null and changes nothing otherwise, so a stale or early timer is harmless.
   */
  finishCountdown(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.COUNTDOWN || this.#now() < room.countdownEnds) return null;
    room.countdownEnds = null;
    this.#clearReady(room);
    room.phase = PHASES.VOTE;
    room.vote = { deadline: this.#now() + VOTE_MS, picks: new Map() };
    return { code, msLeft: VOTE_MS };
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

  /**
   * A learner did the move for a tutorial step. Once every learner has done
   * it, the next step starts, and after the last step the game does. The
   * result says whether the step advanced.
   *
   * A step that has already ended (a phone a beat behind) and a repeat are
   * both accepted and change nothing, so a twitchy motion detector can't
   * error or skip a step.
   */
  tutorialMove(playerId, payload) {
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.TUTORIAL) return { ok: false, error: ERRORS.NO_TUTORIAL };
    const step = payload?.step;
    if (!Number.isInteger(step) || step < 0) return { ok: false, error: ERRORS.BAD_MOVE };
    const { tutorial } = room;
    if (!tutorial.learners.has(playerId)) return { ok: false, error: ERRORS.NOT_LEARNER };
    if (step !== tutorial.step) return { ok: true, code: room.code, advanced: false };

    tutorial.done.add(playerId);
    return { ok: true, code: room.code, advanced: this.#advanceTutorial(room) };
  }

  /** What the TV and phones render. Null when the room doesn't exist. */
  lobby(code) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const players = [...room.players.values()]
      .map(({ slot, name, ready }) => ({ slot, name, ready }))
      .sort((a, b) => a.slot - b.slot);
    const countdown =
      room.phase === PHASES.COUNTDOWN ? { msLeft: Math.max(0, room.countdownEnds - this.#now()) } : null;
    return {
      code: room.code,
      sport: room.sport,
      phase: room.phase,
      players,
      countdown,
      vote: this.#voteView(room),
      tutorial: this.#tutorialView(room),
    };
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
   * result lists the players to tell. A player leaving frees their seat, and
   * cancels a countdown or an open vote, which both need a full lobby. A
   * learner leaving the tutorial no longer holds up its steps.
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
    // Everyone else stays ready, so a new 4th player who readies up restarts
    // the countdown straight away.
    if (room.phase === PHASES.COUNTDOWN) {
      this.#cancelCountdown(room);
      return { code: room.code, closed: false, countdownCancelled: true };
    }
    // Everyone has to get a say, so a leaver cancels the vote.
    if (room.phase === PHASES.VOTE) {
      room.phase = PHASES.LOBBY;
      room.vote = null;
      return { code: room.code, closed: false, voteCancelled: true };
    }
    if (room.phase === PHASES.TUTORIAL && room.tutorial.learners.delete(id)) {
      room.tutorial.done.delete(id);
      // The step may have been waiting only on them.
      if (this.#advanceTutorial(room)) return { code: room.code, closed: false, tutorialAdvanced: true };
    }
    return { code: room.code, closed: false };
  }

  #everyoneReady(room) {
    return (
      room.players.size >= PLAYERS_TO_START && [...room.players.values()].every((player) => player.ready)
    );
  }

  #cancelCountdown(room) {
    room.phase = PHASES.LOBBY;
    room.countdownEnds = null;
  }

  #clearReady(room) {
    for (const player of room.players.values()) player.ready = false;
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
    const learners = new Set([...picks.keys()].filter((id) => picks.get(id)));
    room.vote = { picks: frozen };
    if (learners.size === 0) {
      room.phase = PHASES.GAME;
      return;
    }
    room.phase = PHASES.TUTORIAL;
    room.tutorial = { step: 0, learners, done: new Set() };
  }

  /**
   * Starts the next step once every learner has done this one, and the game
   * after the last step or once no learners are left. Returns whether
   * anything moved.
   */
  #advanceTutorial(room) {
    const { tutorial } = room;
    const waiting = [...tutorial.learners].some((id) => !tutorial.done.has(id));
    if (waiting && tutorial.learners.size > 0) return false;
    tutorial.step += 1;
    tutorial.done.clear();
    if (tutorial.learners.size === 0 || tutorial.step >= TUTORIAL_MOVES[room.sport].length) {
      room.phase = PHASES.GAME;
      room.tutorial = null;
    }
    return true;
  }

  #tutorialView(room) {
    if (!room.tutorial) return null;
    const slots = (ids) => [...ids].map((id) => room.players.get(id).slot).sort((a, b) => a - b);
    return {
      step: room.tutorial.step,
      moves: [...TUTORIAL_MOVES[room.sport]],
      learners: slots(room.tutorial.learners),
      done: slots(room.tutorial.done),
    };
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
