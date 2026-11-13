import { io } from 'socket.io-client';
import { EVENTS, PROTOCOL_VERSION, isRoomCode, normalizeCode } from '../../../shared/protocol.js';
import {sendSwingRequest} from '../../../src/network/swingRequest.js';
import {nativeDiagnostics} from '../../../shared/diagnostics.js';

export function serverOrigin(value, allowLocal = false) {
  const url = new URL(value);
  const local = allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('Use the HTTPS address of your TV’s game server.');
  return url.origin;
}

/** Public QR links carry only a room code, never account or reconnect tokens. */
export function parseRoomLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.pathname !== '/join' || [...url.searchParams.keys()].some(key => key !== 'code') ||
      url.searchParams.getAll('code').length !== 1) throw new Error('Scan a Wee Sports room QR code from your TV.');
  const code = url.searchParams.get('code');
  if (!isRoomCode(code)) throw new Error('The room code is not valid.');
  return { origin: url.origin, code };
}

export function actionId() {
  return `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** No gameplay retry queue: each action is attempted once with one identity. */
export class ControllerSession {
  constructor(origin, { makeSocket = io, changed = () => {}, feedback = () => {}, save = async () => {}, saveClaim = null, now = () => performance.now(), profileToken = null } = {}) {
    this.origin = serverOrigin(origin, typeof __DEV__ !== 'undefined' && __DEV__);
    this.changed = changed;
    this.feedback = feedback;
    this.save = save;
    this.saveClaim = saveClaim;
    this.claimMatch = null;
    this.now = now;
    this.diagnostics = nativeDiagnostics('phone.native.session');
    this.seat = null;
    this.token = null;
    this.active = true;
    this.detached = false;
    this.inputActive = true;
    this.controlsActive = true;
    this.sequence = 0;
    this.hand = 'Right';
    this.connectionAttempt = 0;
    this.bowlingTurn = 0;
    this.bowlingTurnKey = null;
    this.lastSent = { aim: -Infinity };
    this.feedbackIds = new Set();
    this.socket = makeSocket(this.origin, { transports: ['websocket', 'polling'], autoConnect: false, reconnection: true,
      auth: profileToken ? { profileToken } : {} });
    this.socket.on('connect', () => this.onConnect());
    this.socket.on('disconnect', () => { clearTimeout(this.resumeRetry); this.connectionAttempt++; this.resuming = false; this.clearTransient(); if (!this.detached) this.changed(this.seat, 'offline'); });
    this.socket.on('connect_error', () => {if (!this.detached) this.changed(this.seat, 'offline');});
    this.socket.on(EVENTS.LOBBY_UPDATE, snapshot => {
      if (!this.seat || snapshot.code !== this.seat.code) return;
      if (snapshot.gameId !== this.seat.gameId || snapshot.inputGeneration !== this.seat.inputGeneration || snapshot.hostEpoch !== this.seat.hostEpoch) this.clearTransient();
      this.seat = { ...this.seat, ...snapshot };
      this.observeBowlingTurn();
      if (!this.resuming) this.changed(this.seat, 'online');
      this.captureGuestClaim();
    });
    this.socket.on(EVENTS.GAME_HIT, event => this.onFeedback(event));
    this.socket.on(EVENTS.SESSION_REPLACED, () => this.ended('This controller is active on another device.'));
    this.socket.on(EVENTS.ROOM_CLOSED, () => this.ended('The TV closed this room.'));
  }

  clearTransient({clearFeedback = true} = {}) {
    this.transientGeneration = (this.transientGeneration || 0) + 1;
    this.lastSent = { aim: -Infinity };
    if (clearFeedback) this.feedbackIds.clear();
    this.socket.sendBuffer.length = 0;
  }

  async onConnect() {
    clearTimeout(this.resumeRetry);
    if (!this.active || this.leaving) { if (!this.leaving) this.socket.disconnect(); return; }
    const attempt = ++this.connectionAttempt;
    const current = () => this.active && !this.leaving && this.socket.connected && attempt === this.connectionAttempt;
    if (this.token && this.seat?.code) {
      this.resuming = true;
      const result = await this.request(EVENTS.SESSION_RESUME, { v: PROTOCOL_VERSION, role: 'player', code: this.seat.code, token: this.token });
      if (!current()) return;
      if (!result?.ok) {
        if (['no-room','bad-session','recovery-owner-required'].includes(result?.error)) this.ended('Your room session expired. Join again.');
        else {
          this.changed(this.seat, 'offline');
          this.resumeRetry = setTimeout(() => {if (current()) void this.onConnect();}, 2000);
        }
        return;
      }
      await this.accept(result, {notify:false});
      if (!current()) return;
      // Clear old setup before allowing the automatic flow to restart.
      await this.request(EVENTS.PLAYER_SETUP, { setup: null });
      if (!current()) return;
      this.resuming = false;
    }
    this.changed(this.seat, 'online');
    this.captureGuestClaim();
  }

  async captureGuestClaim() {
    if (!this.saveClaim || !this.seat?.gameId || this.seat.phase !== 'game' || !['bowling'].includes(this.seat.sport)) return;
    const match = `${this.seat.gameId}:${this.seat.matchRound || 0}`;
    if (this.claimMatch === match) return this.claimCapture;
    this.claimMatch = match;
    this.claimCapture = (async () => {
      try {
        const response = await this.request('profile:claim-token', {});
        if (!response.ok) {if (this.claimMatch === match) this.claimMatch = null; return;}
        if (typeof response.claim === 'string') await this.saveClaim(this.origin, response.claim);
      } catch {if (this.claimMatch === match) this.claimMatch = null;}
    })();
    return this.claimCapture;
  }

  async connect() {
    if (this.detached) throw new Error('This controller has returned home. Choose Return to room to reconnect.');
    if (this.socket.connected) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Could not connect to this game server.')); }, 7000);
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Could not connect. Check the HTTPS server address.')); };
      const cleanup = () => { clearTimeout(timer); this.socket.off('connect', done); this.socket.off('connect_error', failed); };
      this.socket.once('connect', done);
      this.socket.once('connect_error', failed);
      this.socket.connect();
    });
  }

  request(event, payload) {
    if (!this.active || !this.socket.connected) return Promise.resolve({ ok: false, error: 'disconnected' });
    return new Promise(resolve => this.socket.timeout(5000).emit(event, payload, (error, result) =>
      resolve(error ? { ok: false, error: 'outcome-unknown' } : result || { ok: false, error: 'invalid-response' })));
  }

  async accept(result, {notify = true} = {}) {
    this.seat = result;
    this.observeBowlingTurn();
    if (result.token) this.token = result.token;
    this.clearTransient();
    await this.save({ origin: this.origin, code: result.code, token: this.token });
    if (notify && this.active && this.socket.connected) this.changed(this.seat, 'online');
  }

  observeBowlingTurn() {
    const seat = this.seat;
    if (seat?.sport !== 'bowling') return;
    const state = seat.gameState;
    const identity = `${seat.gameId}:${seat.matchRound || 0}:${state?.frame}:${state?.currentPlayer}`;
    if (identity !== this.bowlingIdentity || (state?.phase === 'ready' && ['rolling','settling','resetting'].includes(this.bowlingPhase))) {
      this.bowlingTurn++;
    }
    this.bowlingIdentity = identity;
    this.bowlingPhase = state?.phase;
    this.bowlingTurnKey = `${identity}:${this.bowlingTurn}`;
  }

  async join(code, name, capabilities) {
    await this.connect();
    const attempt = this.connectionAttempt;
    const result = await this.request(EVENTS.PLAYER_JOIN, { v: PROTOCOL_VERSION, code: normalizeCode(code), name, capabilities });
    if (result.ok && this.active && !this.leaving && this.socket.connected && attempt === this.connectionAttempt) await this.accept(result);
    else if (result.ok) return {ok:false,error:'room-ended'};
    return result;
  }

  async restore({ code, token }) {
    if (this.detached) return {ok:false,error:'room-ended'};
    this.token = token;
    this.seat = { code };
    this.resuming = true;
    this.changed(this.seat, 'offline');
    if (this.socket.connected) await this.onConnect();
    else await this.connect();
  }

  playing() {
    return this.active && this.inputActive && !this.leaving && !this.resuming && this.socket.connected && this.seat?.phase === 'game' && !this.seat.paused && this.seat.gameId;
  }

  configure({hand} = {}) {if (['Left','Right'].includes(hand)) this.hand = hand;}
  setControlsActive(active) {this.controlsActive=Boolean(active);this.clearTransient({clearFeedback:false});}
  controlsPlaying() {return this.playing() && this.controlsActive && Boolean(this.inputSetup) && this.seat.gameState?.phase!=='complete';}

  latest(kind, value) {
    // Aim is a pre-release preview, never steering for a ball already in play.
    if (kind !== 'aim' || this.seat?.sport !== 'bowling' || !this.playing() ||
        this.seat.gameState?.phase !== 'ready' || this.seat.gameState.currentPlayer !== this.seat.slot + 1) return false;
    const now = this.now();
    // The gyro provides about 60 samples/second. A little scheduling headroom
    // keeps alternate 16 ms callbacks from being dropped by a 16.67 ms gate.
    // Congestion still drops the current sample; no old aim is queued.
    if (now - this.lastSent[kind] < 12) {this.diagnostics.count(`${kind}.coalesced`); return false;}
    const transport = this.socket.io?.engine?.transport;
    if (transport && !transport.writable) {this.diagnostics.count(`${kind}.congested`); return false;}
    this.lastSent[kind] = now;
    const { gameId, inputGeneration, hostEpoch } = this.seat;
    this.socket.volatile.emit(EVENTS.PLAYER_AIM, {
      ...value, gameId, generation: inputGeneration, hostEpoch, seq: this.sequence++,
    });
    this.diagnostics.count(`${kind}.sent`);
    return true;
  }

  async action(event, payload) {
    if (!this.playing()) return { ok: false, error: 'not-playing' };
    if ([EVENTS.PLAYER_ROLL,EVENTS.PLAYER_SWING].includes(event) && !this.controlsPlaying()) return {ok:false,error:'not-playing'};
    const id = actionId();
    const generation = [EVENTS.PLAYER_ROLL, EVENTS.PLAYER_SWING].includes(event)
      ? { generation: this.seat.inputGeneration, hostEpoch: this.seat.hostEpoch } : {};
    const envelope = { ...payload, ...generation, id, gameId: this.seat.gameId };
    const boundary = this.transientGeneration;
    if (event === EVENTS.PLAYER_SWING) {this.diagnostics.count('swing.attempted'); this.diagnostics.mark(id,'request');}
    const result = [EVENTS.PLAYER_SWING, EVENTS.PLAYER_ROLL].includes(event)
      ? await sendSwingRequest(this.socket, event, envelope, () => this.controlsPlaying() &&
        boundary === this.transientGeneration && this.seat.gameId === envelope.gameId &&
        this.seat.inputGeneration === envelope.generation && this.seat.hostEpoch === envelope.hostEpoch,
        event === EVENTS.PLAYER_ROLL ? 5000 : 2000)
      : await this.request(event, envelope);
    if (event === EVENTS.PLAYER_SWING) {
      this.diagnostics.mark(id,'result'); this.diagnostics.measure(id,'request','result','swing.requestResultMs');
      this.diagnostics.count(result?.ok ? 'swing.accepted' : 'swing.rejected');
    }
    if (!result) return {ok:false,error:'invalid-response',id};
    if ([EVENTS.PLAYER_SWING, EVENTS.PLAYER_ROLL].includes(event) && result.error === 'timeout') return {ok:false,error:'outcome-unknown',id};
    return { ...result, id };
  }

  onFeedback(event) {
    if (!this.playing() || !event || event.gameId !== this.seat.gameId || typeof event.id !== 'string' || this.feedbackIds.has(event.id)) return;
    if (event.generation !== undefined && event.generation !== this.seat.inputGeneration) return;
    if (event.hostEpoch !== undefined && event.hostEpoch !== this.seat.hostEpoch) return;
    this.feedbackIds.add(event.id);
    if (this.feedbackIds.size > 256) this.feedbackIds.delete(this.feedbackIds.values().next().value);
    this.feedback(event);
  }

  background() {
    if (this.detached) return;
    if (this.socket.connected) this.socket.emit(EVENTS.SESSION_AWAY, {});
    this.active = false;
    this.inputActive = false;
    this.clearTransient();
    this.socket.disconnect();
    this.changed(this.seat, 'suspended');
  }

  // Native 'inactive' includes permission sheets and transient system overlays.
  // Suppress input without abandoning the room or cancelling a permission prompt.
  inactive() { this.inputActive = false; this.clearTransient({clearFeedback:false}); }
  foreground() {
    if (this.detached) return;
    const suspended = !this.active;
    this.active = true; this.inputActive = true; this.clearTransient({clearFeedback:suspended});
    if (this.token && !this.socket.connected) this.socket.connect();
  }
  setProfileToken(token) {
    this.socket.auth = token ? { profileToken: token } : {};
    // Server reads account identity from the authenticated handshake, never room data.
    if (this.active && this.token) { this.socket.disconnect(); this.socket.connect(); }
  }
  detach(message, saved) {
    clearTimeout(this.resumeRetry);
    this.connectionAttempt++;
    this.detached = true;
    this.active = false;
    this.inputActive = false;
    this.resuming = false;
    this.token = null;
    this.seat = null;
    this.inputSetup = null;
    this.clearTransient();
    this.socket.disconnect();
    void this.save(saved);
    this.changed(null, message);
  }
  ended(message) { this.detach(message, null); }
  home() {
    if (this.detached) return;
    const saved = this.token && this.seat?.code ? {origin:this.origin, code:this.seat.code, token:this.token} : null;
    if (this.socket.connected) this.socket.emit(EVENTS.SESSION_AWAY, {});
    this.detach('Ready to join', saved);
  }
  async leave() {
    this.leaving = true;
    // Departure must work even when the TV or network is gone. Try to release
    // the seat now; a disconnected seat otherwise expires at the server.
    if (this.socket.connected) void this.request(EVENTS.PLAYER_LEAVE, {code:this.seat?.code,token:this.token});
    this.ended('Left room');
    return {ok:true};
  }
  dispose() { clearTimeout(this.resumeRetry); this.detached = true; this.active = false; this.clearTransient(); this.socket.removeAllListeners(); this.socket.disconnect(); }
}
