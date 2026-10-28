/**
 * Every lobby the server knows about, with no networking in it.
 *
 * The rules are ported from gameboystudio's RoomServer: a code is the room's
 * address, a room has exactly one TV, seats are capped, and when the TV leaves
 * the room closes instead of leaving phones on a dead connection. Socket.io
 * lives in app.js. Keeping it out of here means the tests exercise the same
 * code that runs in production.
 *
 * A member keeps a stable id across socket replacements; private tokens
 * authorize reattachment. Public lobby snapshots never include tokens.
 *
 * There are no timers in here either. The countdown deadline is read from an
 * injectable clock; app.js periodically expires missing sessions and calls
 * finishCountdown().
 */

import { randomBytes, randomUUID } from 'node:crypto';

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
  RECONNECT_MS,
  cleanName,
  isRoomCode,
  isSwing,
  isRoll,
  isController,
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

const BEFORE_PLAY = new Set([PHASES.LOBBY, PHASES.READY, PHASES.ALL_READY]);

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
  #tokens = new Map();
  #sockets = new Map();
  #makeCode;
  #maxPlayers;
  #now;
  #graceMs;

  constructor({ makeCode = randomCode, maxPlayers = MAX_PLAYERS, now = Date.now, graceMs = RECONNECT_MS } = {}) {
    this.#makeCode = makeCode;
    this.#maxPlayers = maxPlayers;
    this.#now = now;
    this.#graceMs = graceMs;
  }

  get roomCount() {
    return this.#rooms.size;
  }

  /** Retrying a request on the same socket does not create another room. */
  createRoom(hostId, payload = {}) {
    const { v, sport } = payload ?? {};
    if (v !== PROTOCOL_VERSION) return { ok: false, error: ERRORS.BAD_VERSION };
    if (!OPEN_SPORTS.includes(sport)) return { ok: false, error: ERRORS.BAD_SPORT };
    const existing = this.#sockets.get(hostId);
    if (existing) return this.#members.get(existing).role === 'host'
      ? this.#sessionView(existing) : { ok: false, error: ERRORS.ALREADY_IN_ROOM };

    let code = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const candidate = this.#makeCode();
      if (!this.#rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) return { ok: false, error: ERRORS.SERVER_BUSY };

    this.#rooms.set(code, { code, sport, hostId, phase: PHASES.LOBBY, players: new Map(), deadline: null, pausedAt: null,
      gameId: null, gameState: null, pendingRoll: null, seenRolls: new Set() });
    const memberId = this.#addSession(hostId, code, 'host');
    this.#rooms.get(code).hostId = memberId;
    return this.#sessionView(memberId);
  }

  join(playerId, payload = {}) {
    const { v, code, name } = payload ?? {};
    if (v !== PROTOCOL_VERSION) return { ok: false, error: ERRORS.BAD_VERSION };
    const room = isRoomCode(code) ? this.#rooms.get(code) : undefined;
    if (!room) return { ok: false, error: ERRORS.NO_ROOM };

    const existing = this.#sockets.get(playerId);
    if (existing) {
      const member = this.#members.get(existing);
      return member.code === code && member.role === 'player' ? this.#sessionView(existing)
        : { ok: false, error: ERRORS.ALREADY_IN_ROOM };
    }

    const cleaned = cleanName(name);
    if (!cleaned) return { ok: false, error: ERRORS.BAD_NAME };

    const slot = this.#freeSlot(room);
    if (slot === null) return { ok: false, error: ERRORS.ROOM_FULL };
    // More friends can join until the host starts the countdown.
    if (!BEFORE_PLAY.has(room.phase)) return { ok: false, error: ERRORS.IN_PROGRESS };

    const unique = this.#uniqueName(room, cleaned);
    const memberId = this.#addSession(playerId, code, 'player');
    room.players.set(memberId, { slot, name: unique, ready: false, setup: null });
    this.#resetReady(room);
    return this.#sessionView(memberId);
  }

  /**
   * Ready or not ready. Players can change their mind until everyone is
   * ready; then the lobby moves on and the result says so.
   */
  setReady(playerId, payload) {
    playerId = this.#sockets.get(playerId);
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.READY) return { ok: false, error: ERRORS.NO_READY_CHECK };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    const ready = payload?.ready;
    if (typeof ready !== 'boolean') return { ok: false, error: ERRORS.BAD_READY };

    const player = room.players.get(playerId);
    if (ready && isController(room.sport, player.slot) && !player.setup) return { ok: false, error: 'setup-required' };
    player.ready = ready;
    const advanced = [...room.players.values()].every((player) => player.ready);
    if (advanced) {
      this.#clearReady(room);
      room.phase = nextPhaseAfterReady();
    }
    return { ok: true, code: room.code, advanced };
  }

  /** The TV's Play button. Only the room's TV, and only once everyone is ready. */
  start(hostId) {
    hostId = this.#sockets.get(hostId);
    const member = this.#members.get(hostId);
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.ALL_READY) return { ok: false, error: ERRORS.NOT_ALL_READY };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };

    room.phase = PHASES.COUNTDOWN;
    room.gameId = randomUUID();
    room.deadline = this.#now() + COUNTDOWN_SECONDS * 1000;
    return { ok: true, code: room.code, msLeft: COUNTDOWN_SECONDS * 1000 };
  }

  setSetup(socketId, payload) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    const player = room?.players.get(member.id);
    if (!player || !isController(room.sport, player.slot)) return { ok: false, error: 'not-controller' };
    if (![null, 'motion', 'buttons'].includes(payload?.setup)) return { ok: false, error: 'bad-setup' };
    if (player.setup !== payload.setup) {
      player.setup = payload.setup;
      if (room.phase === PHASES.READY) {
        player.ready = false;
      } else if (BEFORE_PLAY.has(room.phase) || room.phase === PHASES.COUNTDOWN) {
        room.deadline = null;
        this.#resetReady(room);
      }
      this.#updatePause(room);
    }
    return { ok: true, code: room.code };
  }

  /** Resolve the target from the authenticated seat; clients cannot choose another room. */
  swingTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    const player = room?.players.get(member.id);
    if (member?.role !== 'player' || !player || room.sport !== 'tennis' || player.slot > 1) {
      return { ok: false, error: 'not-controller' };
    }
    if (!isSwing(event)) return { ok: false, error: 'bad-swing' };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    if (room.phase !== PHASES.TUTORIAL) return { ok: false, error: 'not-playing' };
    return { ok: true, hostSocketId: this.#members.get(room.hostId)?.socketId,
      event: { type: 'swing', id: event.id, label: event.label, hand: event.hand, player: player.slot + 1 } };
  }

  /** The TV owns bowling simulation; only its authenticated session can publish turns. */
  setGameState(socketId, payload) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    if (room.sport !== 'bowling' || room.phase !== PHASES.TUTORIAL || payload?.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    const { phase, currentPlayer, frame } = payload ?? {};
    const validPlayer = phase === 'complete' ? currentPlayer === null :
      [...room.players.values()].some(player => player.slot + 1 === currentPlayer);
    if (!['ready', 'rolling', 'complete'].includes(phase) || !validPlayer ||
        !Number.isInteger(frame) || frame < 1 || frame > 10) return { ok: false, error: 'bad-game-state' };
    room.gameState = { phase, currentPlayer, frame };
    return { ok: true, code: room.code };
  }

  rollTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    const player = room?.players.get(member.id);
    if (!player || room.sport !== 'bowling') return { ok: false, error: 'not-controller' };
    if (!isRoll(event)) return { ok: false, error: 'bad-roll' };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    if (room.phase !== PHASES.TUTORIAL) return { ok: false, error: 'not-playing' };
    if (room.seenRolls.has(event.id)) return { ok: false, error: 'duplicate-roll' };
    if (!room.gameState) return { ok: false, error: 'game-loading' };
    if (room.gameState.phase !== 'ready' || room.pendingRoll) return { ok: false, error: 'not-ready-to-roll' };
    if (room.gameState.currentPlayer !== player.slot + 1) return { ok: false, error: 'not-your-turn' };
    room.pendingRoll = event.id;
    room.seenRolls.add(event.id);
    if (room.seenRolls.size > 256) room.seenRolls.delete(room.seenRolls.values().next().value);
    return { ok: true, code: room.code, hostSocketId: this.#members.get(room.hostId)?.socketId,
      event: { type: 'roll', id: event.id, power: event.power, spin: event.spin, aim: event.aim,
        player: player.slot + 1, gameId: room.gameId } };
  }

  finishRollDelivery(code, id) {
    const room = this.#rooms.get(code);
    if (room?.pendingRoll === id) room.pendingRoll = null;
  }

  /**
   * Moves on to the tutorial once the countdown's deadline has passed.
   * Returns null and changes nothing otherwise, so a stale or early timer is
   * harmless.
   */
  finishCountdown(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.COUNTDOWN || room.pausedAt !== null || this.#now() < room.deadline) return null;
    room.phase = PHASES.TUTORIAL;
    room.deadline = null;
    return { code };
  }

  /** What the TV and phones render. Null when the room doesn't exist. */
  lobby(code) {
    const room = this.#rooms.get(code);
    if (!room) return null;
    const players = [...room.players.values()]
      .map(({ slot, name, ready, setup }) => ({ slot, name, ready, setup }))
      .sort((a, b) => a.slot - b.slot);
    const countdown =
      room.phase === PHASES.COUNTDOWN ? { msLeft: Math.max(0, room.deadline - (room.pausedAt ?? this.#now())) } : null;
    const reconnecting = [...this.#members.values()]
      .filter(member => member.code === code && member.disconnectedAt !== null)
      .map(member => ({ name: member.role === 'host' ? 'TV' : room.players.get(member.id)?.name,
        msLeft: Math.max(0, this.#graceMs - (this.#now() - member.disconnectedAt)) }));
    return { code: room.code, sport: room.sport, phase: room.phase, players, countdown,
      paused: room.pausedAt !== null, reconnecting,
      setupPending: players.filter(player => isController(room.sport, player.slot) && !player.setup).map(player => player.name),
      gameId: room.gameId, gameState: room.gameState };
  }

  /** The code this id is hosting, or null. */
  hostedBy(id) {
    id = this.#sockets.get(id);
    const member = this.#members.get(id);
    return member?.role === 'host' ? member.code : null;
  }

  /**
   * Takes an id out of whatever room it is in.
   *
   * Returns null if it wasn't in one. A host leaving closes the room, and the
   * result lists the players to tell. A player leaving frees their seat.
   */
  remove(socketId) {
    return this.#removeMember(this.#sockets.get(socketId));
  }

  #removeMember(id) {
    const member = this.#members.get(id);
    if (!member) return null;
    this.#deleteSession(id);

    const room = this.#rooms.get(member.code);
    if (!room) return null;

    if (member.role === 'host') {
      const playerIds = [...room.players.keys()].map(id => this.#members.get(id)?.socketId).filter(Boolean);
      for (const playerId of room.players.keys()) this.#deleteSession(playerId);
      this.#rooms.delete(room.code);
      return { code: room.code, closed: true, playerIds };
    }

    const leavingSlot = room.players.get(id)?.slot;
    room.players.delete(id);
    this.#updatePause(room);
    // A controller leaving ends this match; spectators can leave freely.
    if (room.phase === PHASES.TUTORIAL && isController(room.sport, leavingSlot)) {
      room.phase = PHASES.LOBBY;
      this.#clearReady(room);
    }
    // Any seat change before play cancels the countdown and asks the remaining
    // players to confirm again. P1 must exist, even if spectator seats remain.
    if (BEFORE_PLAY.has(room.phase) || room.phase === PHASES.COUNTDOWN) {
      const countdownCancelled = room.phase === PHASES.COUNTDOWN;
      room.deadline = null;
      this.#resetReady(room);
      this.#updatePause(room);
      if (countdownCancelled) return { code: room.code, closed: false, countdownCancelled };
    }
    return { code: room.code, closed: false };
  }

  #addSession(socketId, code, role) {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    this.#members.set(id, { id, code, role, token, socketId, disconnectedAt: null });
    this.#tokens.set(token, id);
    this.#sockets.set(socketId, id);
    return id;
  }

  #deleteSession(id) {
    const member = this.#members.get(id);
    if (!member) return;
    this.#tokens.delete(member.token);
    if (member.socketId) this.#sockets.delete(member.socketId);
    this.#members.delete(id);
  }

  #sessionView(id) {
    const member = this.#members.get(id);
    const room = this.#rooms.get(member.code);
    const player = member.role === 'player' ? room.players.get(id) : null;
    return { ok: true, token: member.token, role: member.role,
      ...(player ? { slot: player.slot, name: player.name } : {}), ...this.lobby(member.code) };
  }

  #updatePause(room) {
    const missing = [...this.#members.values()].some(member => member.code === room.code && member.disconnectedAt !== null) ||
      (room.phase === PHASES.TUTORIAL && [...room.players.values()].some(player => isController(room.sport, player.slot) && !player.setup));
    if (missing && room.pausedAt === null) room.pausedAt = this.#now();
    else if (!missing && room.pausedAt !== null) {
      if (room.deadline !== null) room.deadline += this.#now() - room.pausedAt;
      room.pausedAt = null;
    }
  }

  /** A temporary drop reserves the identity/seat; an explicit Leave still removes it. */
  disconnect(socketId, expectedCode) {
    const id = this.#sockets.get(socketId);
    const member = this.#members.get(id);
    if (!member || (expectedCode && member.code !== expectedCode)) return null;
    this.#sockets.delete(socketId);
    member.socketId = null;
    member.disconnectedAt = this.#now();
    const room = this.#rooms.get(member.code);
    this.#updatePause(room);
    return { code: member.code };
  }

  resume(socketId, payload = {}) {
    const { v, code, token, role } = payload ?? {};
    if (v !== PROTOCOL_VERSION) return { ok: false, error: ERRORS.BAD_VERSION };
    if (!this.#rooms.has(code)) return { ok: false, error: ERRORS.NO_ROOM };
    const id = this.#tokens.get(token);
    const member = this.#members.get(id);
    if (!member || member.code !== code || member.role !== role ||
        (member.disconnectedAt !== null && this.#now() - member.disconnectedAt >= this.#graceMs)) {
      return { ok: false, error: ERRORS.BAD_SESSION };
    }
    const occupying = this.#sockets.get(socketId);
    if (occupying && occupying !== id) return { ok: false, error: ERRORS.ALREADY_IN_ROOM };
    const replacedSocketId = member.socketId !== socketId ? member.socketId : null;
    if (replacedSocketId) this.#sockets.delete(replacedSocketId);
    member.socketId = socketId;
    member.disconnectedAt = null;
    this.#sockets.set(socketId, id);
    this.#updatePause(this.#rooms.get(code));
    return { ...this.#sessionView(id), replacedSocketId };
  }

  /** Called by the server clock, independently of incoming socket traffic. */
  expireDisconnected() {
    const changes = [];
    for (const member of [...this.#members.values()]) {
      if (member.disconnectedAt === null || this.#now() - member.disconnectedAt < this.#graceMs) continue;
      const result = this.#removeMember(member.id);
      if (result) changes.push(result);
    }
    return changes;
  }

  get countdownCodes() {
    return [...this.#rooms.values()].filter(room => room.phase === PHASES.COUNTDOWN).map(room => room.code);
  }

  /** Rooms whose snapshots need a fresh reconnect countdown. */
  get reconnectingCodes() {
    return [...this.#rooms.values()].filter(room => room.pausedAt !== null).map(room => room.code);
  }

  #clearReady(room) {
    for (const player of room.players.values()) player.ready = false;
  }

  #resetReady(room) {
    this.#clearReady(room);
    room.gameId = null; room.gameState = null; room.pendingRoll = null; room.seenRolls.clear();
    room.phase = room.players.size >= READY_AT_PLAYERS &&
      (room.sport === 'bowling' || [...room.players.values()].some(player => player.slot === 0)) ? PHASES.READY : PHASES.LOBBY;
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
