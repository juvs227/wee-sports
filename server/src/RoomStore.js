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
 * There are no timers in here either. The countdown and vote deadlines are
 * read from an injectable clock; app.js periodically expires missing sessions
 * and calls finishCountdown() and expireVote().
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
  PICKS,
  PROTOCOL_VERSION,
  READY_AT_PLAYERS,
  RECONNECT_MS,
  TUTORIAL_MOVES,
  VOTE_SECONDS,
  cleanName,
  hasTutorial,
  isRoomCode,
  isSwing,
  isRoll,
  isGameHit,
  isTennisState,
  isBowlingState,
  isStrokeResult,
  isController,
  isGameCommand,
  isGameOptions,
  playerCapacity,
} from '../../shared/protocol.js';

const MAX_CODE_ATTEMPTS = 50;
const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;
const VOTE_MS = VOTE_SECONDS * 1000;

const BEFORE_PLAY = new Set([PHASES.LOBBY, PHASES.READY]);
/** After the countdown and before the game: the vote and the tutorial. */
const PREGAME = new Set([PHASES.VOTE, PHASES.TUTORIAL]);
/** Phases where a controller without setup pauses everyone. */
const NEEDS_SETUP = new Set([PHASES.VOTE, PHASES.TUTORIAL, PHASES.GAME]);

export function randomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomStore {
  /**
   * code -> { code, sport, hostId, phase, players: Map<id, { slot, name, ready }>, deadline, vote, tutorial }
   *
   * deadline is when the countdown or the vote ends, or null when neither is
   * running.
   * vote is null until it opens, { picks: Map<id, boolean> } while open, and
   * { picks: [{ slot, pick }] } once resolved, frozen so the reveal still shows
   * what everyone picked.
   * tutorial is null outside 'tutorial', and { step, learners: Set<id>,
   * done: Set<id> } in it. learners are the Yes voters.
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

    this.#rooms.set(code, { code, sport, hostId, phase: PHASES.LOBBY, players: new Map(), deadline: null, pausedAt: null, manuallyPaused: false,
      gameId: null, inputGeneration: 0, gameState: null, pendingRoll: null, seenRolls: new Set(),
      seenHits: new Set(), lastHitAt: new Map(), pendingStrokes: new Map(), soundMuted: null,
      gameOptions: null, seenCommands: new Set(), pendingGameCommand: null, vote: null, tutorial: null,
      calibrating: new Set() });
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
   * Ready or not ready, during the ready check and the countdown. When the
   * last player readies up the countdown starts by itself; anyone un-readying
   * during it cancels it. The result says which happened.
   */
  setReady(playerId, payload) {
    playerId = this.#sockets.get(playerId);
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.READY && room?.phase !== PHASES.CALIBRATION && room?.phase !== PHASES.COUNTDOWN) {
      return { ok: false, error: ERRORS.NO_READY_CHECK };
    }
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    const ready = payload?.ready;
    if (typeof ready !== 'boolean') return { ok: false, error: ERRORS.BAD_READY };

    const player = room.players.get(playerId);
    if (ready && isController(room.sport, player.slot) && !player.setup) return { ok: false, error: 'setup-required' };
    player.ready = ready;

    if (room.phase === PHASES.READY && [...room.players.values()].every((seat) => seat.ready)) {
      room.phase = PHASES.CALIBRATION;
      return { ok: true, code: room.code, calibrationStarted: true };
    }
    if (room.phase === PHASES.CALIBRATION && !ready) {
      room.phase = PHASES.READY;
      return { ok: true, code: room.code, calibrationCancelled: true };
    }
    if (room.phase === PHASES.COUNTDOWN && !ready) {
      // Everyone else stays ready, so readying up again restarts it at once.
      room.phase = PHASES.READY;
      room.deadline = null;
      room.gameId = null;
      room.inputGeneration++;
      return { ok: true, code: room.code, countdownCancelled: true };
    }
    return { ok: true, code: room.code };
  }

  /**
   * TV -> server: all players finished orientation calibration. Move to countdown.
   */
  calibrationDone(socketId) {
    const member = this.#members.get(this.#sockets.get(socketId));
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.CALIBRATION) return { ok: false, error: 'not-calibrating' };
    room.phase = PHASES.COUNTDOWN;
    room.gameId = randomUUID();
    room.deadline = this.#now() + COUNTDOWN_MS;
    return { ok: true, code: room.code, countdownStarted: true, msLeft: COUNTDOWN_MS };
  }

  /**
   * Phone -> server: this player finished orientation calibration.
   * When all controller players are done, advances to countdown.
   */
  playerCalibrationDone(socketId) {
    const playerId = this.#sockets.get(socketId);
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.CALIBRATION) return { ok: false, error: 'not-calibrating' };
    room.calibrating.add(playerId);
    const controllers = [...room.players.entries()].filter(([, p]) => isController(room.sport, p.slot));
    const allDone = controllers.length > 0 && controllers.every(([id]) => room.calibrating.has(id));
    if (!allDone) return { ok: true, code: room.code };
    room.phase = PHASES.COUNTDOWN;
    room.gameId = randomUUID();
    room.deadline = this.#now() + COUNTDOWN_MS;
    return { ok: true, code: room.code, countdownStarted: true, msLeft: COUNTDOWN_MS };
  }

  /**
   * One final tutorial vote. watch: true is Yes. The vote resolves as soon as
   * every player has voted, and the result says whether it did.
   */
  vote(socketId, payload) {
    const playerId = this.#sockets.get(socketId);
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.VOTE) return { ok: false, error: ERRORS.NO_VOTE };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
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
   * early tick is harmless. The deadline does not run while the room is paused.
   */
  expireVote(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.VOTE || room.pausedAt !== null || this.#now() < room.deadline) return null;
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
  tutorialMove(socketId, payload) {
    const playerId = this.#sockets.get(socketId);
    const member = this.#members.get(playerId);
    if (member?.role !== 'player') return { ok: false, error: ERRORS.NOT_PLAYER };
    const room = this.#rooms.get(member.code);
    if (room?.phase !== PHASES.TUTORIAL) return { ok: false, error: ERRORS.NO_TUTORIAL };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    const step = payload?.step;
    if (!Number.isInteger(step) || step < 0) return { ok: false, error: ERRORS.BAD_MOVE };
    const { tutorial } = room;
    if (!tutorial.learners.has(playerId)) return { ok: false, error: ERRORS.NOT_LEARNER };
    if (step !== tutorial.step) return { ok: true, code: room.code, advanced: false };

    tutorial.done.add(playerId);
    return { ok: true, code: room.code, advanced: this.#advanceTutorial(room) };
  }

  /** Room membership, never a client-supplied code, scopes the shared sound control. */
  setSound(socketId, payload) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (!room || (member.role !== 'host' && !room.players.has(member.id))) return { ok: false, error: ERRORS.NO_ROOM };
    if (typeof payload?.muted !== 'boolean' || (payload.initialize !== undefined && payload.initialize !== true)) {
      return { ok: false, error: 'bad-sound' };
    }
    if (payload.initialize && member.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    const changed = (!payload.initialize || room.soundMuted === null) && room.soundMuted !== payload.muted;
    if (changed) room.soundMuted = payload.muted;
    return { ok: true, code: room.code, muted: room.soundMuted, changed };
  }

  /** Only P1 can change the active match. The authenticated seat chooses its TV. */
  gameCommandTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    const player = room?.players.get(member.id);
    if (member?.role !== 'player' || player?.slot !== 0) return { ok: false, error: 'not-game-leader' };
    if (!isGameCommand(event, room.sport)) return { ok: false, error: 'bad-game-command' };
    if (room.phase !== PHASES.GAME || event.gameId !== room.gameId) return { ok: false, error: 'not-playing' };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    if (!room.gameOptions) return { ok: false, error: 'game-loading' };
    if (room.seenCommands.has(event.id)) return { ok: false, error: 'duplicate-command' };
    if (room.pendingGameCommand) return { ok: false, error: 'game-command-pending' };
    if (room.sport === 'bowling' && (room.gameState?.phase === 'rolling' || room.pendingRoll)) {
      return { ok: false, error: 'ball-in-play' };
    }
    const humanOpponent = [...room.players.values()].some(seat => seat.slot === 1);
    if (room.sport === 'tennis' && humanOpponent &&
        (event.action.startsWith('practice-') || event.action === 'configure' &&
          ('botDifficulty' in event.settings || 'splitView' in event.settings))) {
      return { ok: false, error: 'solo-only' };
    }
    // Retain IDs for this whole lobby match, including timed-out requests: a
    // delayed retry must never reset a match twice. Bound memory without eviction.
    if (room.seenCommands.size >= 1024) return { ok: false, error: 'game-command-limit' };
    room.seenCommands.add(event.id);
    if (event.action === 'new-match') { room.inputGeneration++; room.pendingStrokes.clear(); }
    room.pendingGameCommand = event.id;
    const command = { id: event.id, gameId: room.gameId, action: event.action };
    if (event.settings) command.settings = { ...event.settings };
    if (event.format) command.format = event.format;
    if (event.stroke) { command.stroke = event.stroke; command.hand = event.hand; }
    return { ok: true, code: room.code, hostSocketId: this.#members.get(room.hostId)?.socketId, event: command };
  }

  finishGameCommand(code, id, gameId) {
    const room = this.#rooms.get(code);
    if (room && room.gameId === gameId && room.pendingGameCommand === id) room.pendingGameCommand = null;
  }

  setGameOptions(socketId, payload) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (member?.role !== 'host' || room?.hostId !== member.id) return { ok: false, error: ERRORS.NOT_HOST };
    if (room.phase !== PHASES.GAME || payload?.gameId !== room.gameId) return { ok: false, error: 'not-playing' };
    if (!isGameOptions(payload, room.sport)) return { ok: false, error: 'bad-game-options' };
    const snapshot = { gameId: room.gameId, sport: room.sport };
    if (room.sport === 'tennis') {
      snapshot.settings = Object.fromEntries(['assistance', 'botDifficulty', 'autoMove', 'timingAssist', 'splitView', 'format']
        .map(key => [key, payload.settings[key]]));
      snapshot.practice = { active: payload.practice.active, stroke: payload.practice.stroke, hand: payload.practice.hand };
      // Roster, not client data, decides whether solo-only controls are available.
      snapshot.humanOpponent = [...room.players.values()].some(player => player.slot === 1);
    }
    const changed = JSON.stringify(room.gameOptions) !== JSON.stringify(snapshot);
    room.gameOptions = snapshot;
    return { ok: true, code: room.code, changed };
  }

  /** End only the caller's current match. Returning never releases a seat or controller setup. */
  returnToLobby(socketId, payload, role = 'host') {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (role === 'host') {
      if (member?.role !== 'host' || room?.hostId !== member.id) return { ok: false, error: ERRORS.NOT_HOST };
    } else if (role !== 'player' || member?.role !== 'player' || room?.players.get(member.id)?.slot !== 0) {
      return { ok: false, error: 'not-game-leader' };
    }
    // A delayed request from an older game must not cancel its replacement.
    if (![PHASES.COUNTDOWN, PHASES.VOTE, PHASES.TUTORIAL, PHASES.GAME].includes(room.phase) ||
        typeof payload?.gameId !== 'string' || payload.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    room.deadline = null;
    this.#resetReady(room);
    // Keep genuine reconnect pauses, but a missing setup no longer pauses a lobby.
    this.#updatePause(room);
    return { ok: true, code: room.code };
  }

  /** Shared pause never bypasses reconnect or controller setup requirements. */
  setPaused(socketId, payload, role = 'host') {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (role === 'host') {
      if (member?.role !== 'host' || room?.hostId !== member.id) return { ok: false, error: ERRORS.NOT_HOST };
    } else if (role !== 'player' || member?.role !== 'player' || room?.players.get(member.id)?.slot !== 0) {
      return { ok: false, error: 'not-game-leader' };
    }
    if (room.phase !== PHASES.GAME || typeof payload?.gameId !== 'string' || payload.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    if (typeof payload.paused !== 'boolean') return { ok: false, error: 'bad-pause' };
    const changed = room.manuallyPaused !== payload.paused;
    if (changed && payload.paused) {
      if (room.gameState?.phase === 'complete') return { ok: false, error: 'not-playing' };
      // Let an already-delivered reset/release finish its handshake before
      // stopping the TV. This avoids accepting a reset whose reply was cancelled.
      if (room.pendingGameCommand) return { ok: false, error: 'game-command-pending' };
      if (room.pendingRoll) return { ok: false, error: 'delivery-pending' };
    }
    room.manuallyPaused = payload.paused;
    this.#updatePause(room);
    return { ok: true, code: room.code, manuallyPaused: room.manuallyPaused, paused: room.pausedAt !== null, changed };
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
      } else if (BEFORE_PLAY.has(room.phase) || room.phase === PHASES.CALIBRATION || room.phase === PHASES.COUNTDOWN) {
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
    if (room.phase !== PHASES.GAME || event.gameId !== room.gameId || room.gameState?.phase === 'complete') {
      return { ok: false, error: 'not-playing' };
    }
    const now = this.#now();
    for (const [id, pending] of room.pendingStrokes) {
      if (now - pending.at > 5000) room.pendingStrokes.delete(id);
    }
    if (!room.pendingStrokes.has(event.id)) room.pendingStrokes.set(event.id, { player: player.slot + 1, at: now });
    if (room.pendingStrokes.size > 128) room.pendingStrokes.delete(room.pendingStrokes.keys().next().value);
    return { ok: true, code: room.code, inputGeneration: room.inputGeneration, hostSocketId: this.#members.get(room.hostId)?.socketId,
      event: { type: 'swing', id: event.id, label: event.label, hand: event.hand,
        ...(event.power === undefined ? {} : { power: event.power }), player: player.slot + 1, gameId: room.gameId } };
  }

  /** Correlated diagnostics are private, transient feedback for a real recent input. */
  strokeResultTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    if (!isStrokeResult(event)) return { ok: false, error: 'bad-stroke-result' };
    if (room.sport !== 'tennis' || room.phase !== PHASES.GAME || event.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    const pending = room.pendingStrokes.get(event.id);
    if (!pending || pending.player !== event.player || this.#now() - pending.at > 5000) {
      return { ok: false, error: 'unknown-stroke' };
    }
    room.pendingStrokes.delete(event.id);
    const seat = [...room.players.entries()].find(([, player]) => player.slot + 1 === event.player);
    const target = seat && this.#members.get(seat[0]);
    if (!target?.socketId) return { ok: false, error: 'disconnected' };
    return { ok: true, phoneSocketId: target.socketId, event: {
      id: event.id, gameId: room.gameId, player: event.player, result: event.result, reason: event.reason,
      ...(event.receivedToContactMs === undefined ? {} : { receivedToContactMs: event.receivedToContactMs }),
    } };
  }

  /** Only the current TV can report contact, and only to that match's live seat. */
  hitTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (member?.role !== 'host' || room?.hostId !== member.id) return { ok: false, error: ERRORS.NOT_HOST };
    if (!isGameHit(event, room.sport)) return { ok: false, error: 'bad-hit' };
    if (room.phase !== PHASES.GAME || event.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    if (room.sport === 'bowling' && (room.gameState?.phase !== 'rolling' || room.gameState.currentPlayer !== event.player)) {
      return { ok: false, error: 'not-playing' };
    }
    const seat = [...room.players.entries()].find(([, player]) => player.slot + 1 === event.player);
    const target = seat && this.#members.get(seat[0]);
    if (!target?.socketId || !seat[1].setup) return { ok: false, error: 'not-controller' };
    if (room.seenHits.has(event.id)) return { ok: false, error: 'duplicate-hit' };
    const now = this.#now();
    if (now - (room.lastHitAt.get(event.player) ?? -Infinity) < 150) return { ok: false, error: 'hit-rate-limited' };
    room.lastHitAt.set(event.player, now);
    room.seenHits.add(event.id);
    if (room.seenHits.size > 256) room.seenHits.delete(room.seenHits.values().next().value);
    return { ok: true, phoneSocketId: target.socketId,
      event: { id: event.id, gameId: room.gameId, kind: room.sport, player: event.player } };
  }

  /** The TV owns simulation; only its authenticated session can publish turns. */
  setGameState(socketId, payload) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    if (member?.role !== 'host') return { ok: false, error: ERRORS.NOT_HOST };
    if (room.phase !== PHASES.GAME || payload?.gameId !== room.gameId) {
      return { ok: false, error: 'not-playing' };
    }
    if (room.sport === 'tennis') {
      if (!isTennisState(payload)) return { ok: false, error: 'bad-game-state' };
      room.gameState = { phase: payload.phase, server: payload.server, winner: payload.winner,
        ...(payload.practice === undefined ? {} : { practice: payload.practice }),
        ...(payload.serveAttempt === undefined ? {} : { serveAttempt: payload.serveAttempt }) };
      return { ok: true, code: room.code };
    }
    if (room.sport !== 'bowling') return { ok: false, error: 'not-playing' };
    const { phase, currentPlayer, frame } = payload ?? {};
    const roster = new Set([...room.players.values()].map(player => player.slot + 1));
    if (!isBowlingState(payload) || (phase !== 'complete' && !roster.has(currentPlayer)) ||
        payload.winners?.some(player => !roster.has(player))) return { ok: false, error: 'bad-game-state' };
    room.gameState = { phase, currentPlayer, frame,
      ...(phase === 'complete' && payload.winners !== undefined
        ? { winners: [...payload.winners], winnerScore: payload.winnerScore } : {}) };
    return { ok: true, code: room.code };
  }

  rollTarget(socketId, event) {
    const member = this.#members.get(this.#sockets.get(socketId));
    const room = member && this.#rooms.get(member.code);
    const player = room?.players.get(member.id);
    if (!player || room.sport !== 'bowling') return { ok: false, error: 'not-controller' };
    if (!isRoll(event)) return { ok: false, error: 'bad-roll' };
    if (room.pausedAt !== null) return { ok: false, error: ERRORS.PAUSED };
    if (room.phase !== PHASES.GAME) return { ok: false, error: 'not-playing' };
    if (room.seenRolls.has(event.id)) return { ok: false, error: 'duplicate-roll' };
    // A reset and a release must never cross in flight. The game command owns
    // the lane until its acknowledgement (or timeout) releases this lock.
    if (room.pendingGameCommand) return { ok: false, error: 'game-command-pending' };
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

  finishRollDelivery(code, id, gameId) {
    const room = this.#rooms.get(code);
    if (room && room.gameId === gameId && room.pendingRoll === id) room.pendingRoll = null;
  }

  /**
   * Opens the tutorial vote once the countdown's deadline has passed, or starts
   * the game for a sport without a tutorial. Returns null and changes nothing
   * otherwise, so a stale or early tick is harmless.
   */
  finishCountdown(code) {
    const room = this.#rooms.get(code);
    if (room?.phase !== PHASES.COUNTDOWN || room.pausedAt !== null || this.#now() < room.deadline) return null;
    this.#clearReady(room);
    if (!hasTutorial(room.sport)) {
      room.phase = PHASES.GAME;
      room.deadline = null;
      return { code };
    }
    room.phase = PHASES.VOTE;
    room.deadline = this.#now() + VOTE_MS;
    room.vote = { picks: new Map() };
    return { code, msLeft: VOTE_MS };
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
    const calibratedSlots = [...room.players.entries()]
      .filter(([id]) => room.calibrating.has(id))
      .map(([, p]) => p.slot);
    return { code: room.code, sport: room.sport, phase: room.phase, players, countdown,
      vote: this.#voteView(room), tutorial: this.#tutorialView(room),
      paused: room.pausedAt !== null, manuallyPaused: room.manuallyPaused, reconnecting,
      setupPending: players.filter(player => isController(room.sport, player.slot) && !player.setup).map(player => player.name),
      gameId: room.gameId, gameState: room.gameState, soundMuted: room.soundMuted, gameOptions: room.gameOptions,
      calibratedSlots };
  }

  /** Slot + host socket for forwarding volatile player events. Null if not in a room. */
  memberRoom(socketId) {
    const id = this.#sockets.get(socketId);
    const member = this.#members.get(id);
    if (!member) return null;
    const room = this.#rooms.get(member.code);
    if (!room) return null;
    const player = member.role === 'player' ? room.players.get(id) : null;
    const hostSocketId = this.#members.get(room.hostId)?.socketId ?? null;
    return { slot: player?.slot ?? null, hostSocketId };
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
    // A controller leaving ends this match, the vote and tutorial before it
    // included; temporary drops keep their reserved seat.
    if ((room.phase === PHASES.GAME || PREGAME.has(room.phase)) && isController(room.sport, leavingSlot)) {
      room.phase = PHASES.LOBBY;
      this.#clearReady(room);
    } else if (room.phase === PHASES.TUTORIAL && room.tutorial.learners.delete(id)) {
      // A watcher has no seat in the game; the step may have waited only on them.
      room.tutorial.done.delete(id);
      this.#advanceTutorial(room);
    }
    // Any seat change before play cancels the countdown and asks the remaining
    // players to confirm again. Tennis needs P1 before a new match can start.
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
    const missing = room.manuallyPaused || [...this.#members.values()].some(member => member.code === room.code && member.disconnectedAt !== null) ||
      (NEEDS_SETUP.has(room.phase) && [...room.players.values()].some(player => isController(room.sport, player.slot) && !player.setup));
    if (missing && room.pausedAt === null) { room.pausedAt = this.#now(); room.inputGeneration++; room.pendingStrokes.clear(); }
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

  get voteCodes() {
    return [...this.#rooms.values()].filter(room => room.phase === PHASES.VOTE).map(room => room.code);
  }

  /** Rooms whose snapshots need a fresh reconnect countdown. */
  get reconnectingCodes() {
    return [...new Set([...this.#members.values()].filter(member => member.disconnectedAt !== null).map(member => member.code))];
  }

  #clearReady(room) {
    for (const player of room.players.values()) player.ready = false;
  }

  #resetReady(room) {
    room.inputGeneration++;
    this.#clearReady(room);
    room.manuallyPaused = false;
    room.gameId = null; room.gameState = null; room.pendingRoll = null; room.seenRolls.clear();
    room.seenHits.clear(); room.lastHitAt.clear();
    room.pendingStrokes.clear();
    room.gameOptions = null; room.seenCommands.clear(); room.pendingGameCommand = null;
    room.vote = null; room.tutorial = null;
    room.calibrating.clear();
    room.phase = room.players.size >= READY_AT_PLAYERS &&
      (room.sport === 'bowling' || [...room.players.values()].some(player => player.slot === 0)) ? PHASES.READY : PHASES.LOBBY;
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
    const learners = new Set([...picks.keys()].filter((id) => picks.get(id) && room.players.has(id)));
    room.vote = { picks: frozen };
    room.deadline = null;
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
    if (room.phase !== PHASES.TUTORIAL || !room.tutorial) return null;
    const slots = (ids) => [...ids].map((id) => room.players.get(id)?.slot)
      .filter((slot) => slot !== undefined).sort((a, b) => a - b);
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
    const voted = [...room.vote.picks.keys()].map((id) => room.players.get(id)?.slot)
      .filter((slot) => slot !== undefined).sort((a, b) => a - b);
    return { msLeft: Math.max(0, room.deadline - (room.pausedAt ?? this.#now())), voted };
  }

  /** Lowest open seat, so a seat freed by a leaver is the next one filled. */
  #freeSlot(room) {
    const taken = new Set([...room.players.values()].map((player) => player.slot));
    for (let slot = 0; slot < Math.min(this.#maxPlayers, playerCapacity(room.sport)); slot += 1) {
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
