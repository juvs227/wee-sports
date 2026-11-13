import {ProfileError} from '../profiles/validation.js';
import {isAllowedOrigin} from '../origins.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ERRORS, EVENTS, PHASES } from '../../shared/protocol.js';
import { RoomStore } from './RoomStore.js';
import { waitForSwingTransport, remainingSwingTransportWait } from '../../src/network/swingRequest.js';
import {createDiagnostics, DIAGNOSTICS_PROBE} from '../../shared/diagnostics.js';
import {createEventLimiter} from './eventLimits.js';
import {createDirectInputBroker} from './directInputBroker.js';

/** Importable server for tests. index.js owns the listening port. */
export function createGameServer({ store = new RoomStore(), origins = [], tickMs = 250, requestHandler, profiles, persistence = profiles?.persistence ?? null } = {}) {
  let closing = false;
  let closePromise;
  const http = createServer(async (request, response) => {
    if (closing) {
      response.writeHead(503, {'content-type':'text/plain', 'cache-control':'no-store', 'retry-after':'5'});
      response.end('server-shutting-down'); return;
    }
    try {
      if (profiles && await profiles.handle(request, response)) return;
      if (!profiles && request.url?.startsWith('/api/profile')) {
        response.writeHead(503, {'content-type':'application/json', 'cache-control':'no-store'});
        response.end(JSON.stringify({error:'profile-storage-unavailable'})); return;
      }
      if (request.url !== '/health' && requestHandler) return await requestHandler(request, response);
      response.writeHead(request.url === '/health' ? 200 : 404, { 'content-type': 'text/plain', 'cache-control':'no-store',
        ...(request.url === '/health' ? {'x-wee-profiles':profiles?.status?.()?.available ? 'ready' : 'unavailable'} : {}) });
      response.end(request.url === '/health' ? 'ok' : 'Not found');
    } catch {
      // Optional handlers must not turn a failed request into an unhandled rejection.
      if (response.headersSent) {response.destroy(); return;}
      response.writeHead(500, {'content-type':'text/plain', 'cache-control':'no-store'});
      response.end('Internal server error');
    }
  });
  const io = new Server(http, {
    cors: { origin: origins.length ? origins : true },
    allowRequest: (request, callback) => callback(null, !closing && isAllowedOrigin(request, origins)),
    pingInterval: 5000,
    pingTimeout: 5000,
    maxHttpBufferSize: 8192,
  });
  const authenticateSocket = socket => {
    try {
    if (!profiles) return null;
    if (typeof socket.handshake.auth?.profileToken === 'string') return profiles.store.authenticate(socket.handshake.auth.profileToken);
    // WebSocket handshakes are not protected by fetch CORS. Never bind
    // browser account cookies sent by an untrusted same-site origin.
    const origin = socket.request.headers.origin;
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || (url.host !== socket.request.headers.host && !origins.includes(url.origin))) return null;
    } catch {return null;}
    return profiles.authenticateRequest(socket.request);
    } catch {return null;}
  };
  const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };
  const directInput = createDirectInputBroker({io, store});
  const diagnosticClients = new Set();
  const diagnosticFor = peer => {
    const entry = peer?.data?.weeDiagnostics;
    if (!entry || performance.now() >= entry.until) {
      if (peer) {diagnosticClients.delete(peer.id); delete peer.data.weeDiagnostics;}
      return null;
    }
    return entry.value;
  };
  const recordRelay = (source, target, kind, id, receivedAt, outcome) => {
    if (!diagnosticClients.size) return;
    for (const peer of [source, target]) {
      const diagnostic = diagnosticFor(peer);
      if (!diagnostic) continue;
      diagnostic.count(`${kind}.${outcome}`);
      if (Number.isFinite(receivedAt)) diagnostic.observe(`${kind}.serverProcessingMs`, performance.now() - receivedAt);
      if (outcome === 'relayed') {diagnostic.mark(id, 'serverReceived', receivedAt); diagnostic.mark(id, 'serverRelayed');}
    }
  };
  const broadcast = code => {
    directInput.sync(code);
    const lobby = store.lobby(code);
    if (lobby) for (const socketId of io.sockets.adapter.rooms.get(code) ?? []) {
      io.to(socketId).emit(EVENTS.LOBBY_UPDATE, store.lobbyForSocket(socketId, lobby));
    }
  };
  function publish(result) {
    if (!result) return;
    if (result.closed) {
      directInput.sync(result.code);
      if (result.recoverySource && profiles) {
        try {profiles.store.releaseRecovery(result.recoverySource.matchId,result.recoverySource.claimId);} catch { /* lease expiration handles a storage outage */ }
      }
      io.to(result.code).emit(EVENTS.ROOM_CLOSED, { code: result.code });
      io.in(result.code).socketsLeave(result.code);
    } else broadcast(result.code);
  }
  io.on('connection', socket => {
    const admitEvent = createEventLimiter();
    socket.use((packet, next) => {
      const error = closing ? 'server-shutting-down' : !admitEvent(packet[0]) ? 'rate-limited' : null;
      if (error) {reply(packet.at(-1), {ok:false, error}); return;}
      next();
    });
    let swingWaiting = false, rollWaiting = false;
    let lastProbe = -Infinity;
    socket.on(DIAGNOSTICS_PROBE, (payload, ack) => {
      if (payload?.enabled === false) {
        diagnosticClients.delete(socket.id); delete socket.data.weeDiagnostics;
        return reply(ack, {ok: true});
      }
      if (payload?.enabled !== true || !store.sessionContext(socket.id)) return reply(ack, {ok: false, error: 'not-in-room'});
      const now = performance.now();
      if (now - lastProbe < 1000) return reply(ack, {ok: false, error: 'rate-limited'});
      lastProbe = now;
      if (!diagnosticFor(socket)) socket.data.weeDiagnostics = {value: createDiagnostics({enabled: true, scope: 'serverRelay'}), until: now + 10000};
      socket.data.weeDiagnostics.until = now + 10000;
      diagnosticClients.add(socket.id);
      reply(ack, {ok: true, transport: socket.conn.transport.name, diagnostics: socket.data.weeDiagnostics.value.snapshot()});
    });
    socket.on('disconnect', () => diagnosticClients.delete(socket.id));
    persistence?.attach(socket, io, store);
    for (const [event, method] of [[EVENTS.HOST_CREATE, 'createRoom'], [EVENTS.PLAYER_JOIN, 'join'], [EVENTS.SESSION_RESUME, 'resume']]) {
      socket.on(event, (payload, ack) => {
        const profile = authenticateSocket(socket);
        const result = store[method](socket.id, payload, profile?.id);
        if (result.ok) {
          store.bindProfile(socket.id, profile?.id);
          if (result.replacedSocketId) {
            const old = io.sockets.sockets.get(result.replacedSocketId);
            old?.leave(result.code);
            old?.emit(EVENTS.SESSION_REPLACED);
          }
          socket.join(result.code);
        }
        const { replacedSocketId, ...response } = result;
        reply(ack, response);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_SWITCH_SPORT, 'host'], [EVENTS.PLAYER_SWITCH_SPORT, 'player']]) {
      socket.on(event, (payload, ack) => {
        const context = store.sessionContext(socket.id);
        const result = store.switchSport(socket.id, payload, role);
        if (result.ok && context.room.sport !== payload.sport && context.room.recoverySource && profiles) {
          try {profiles.store.releaseRecovery(context.room.recoverySource.matchId,context.room.recoverySource.claimId);} catch { /* The lease expires if storage is unavailable. */ }
        }
        reply(ack, result); if (result.ok) broadcast(result.code);
      });
    }
    let lastInputNotice = 0;
    for (const [event, kind, outbound] of [[EVENTS.PLAYER_AIM, 'aim', EVENTS.GAME_AIM]]) {
      socket.on(event, payload => {
        const receivedAt = diagnosticClients.size ? performance.now() : undefined;
        const result = store.continuousTarget(socket.id, payload, kind);
        if (!result.ok) {
          recordRelay(socket, null, kind, null, receivedAt, result.error === 'rate-limited' ? 'rateLimited' : 'rejected');
          if (Date.now() - lastInputNotice > 1000 && result.error !== 'rate-limited') {
            lastInputNotice = Date.now(); socket.volatile.emit(EVENTS.INPUT_STATUS, {kind, error: result.error});
          }
          return;
        }
        const host = io.sockets.sockets.get(result.hostSocketId);
        if (host?.connected && host.conn.transport.writable) {
          host.volatile.emit(outbound, result.event);
          recordRelay(socket, host, kind, `p${result.event.player}.${kind}.${result.event.seq}`, receivedAt, 'relayed');
        } else recordRelay(socket, host, kind, null, receivedAt, 'transportDropped');
      });
    }
    socket.on(EVENTS.PLAYER_ACTION_STATUS, (payload, ack) => reply(ack, store.actionStatus(socket.id, payload)));
    socket.on(EVENTS.HOST_RESTORE, (payload, ack) => {
      try {
        const profile = authenticateSocket(socket);
        if (!profile) return reply(ack, {ok:false,error:'not-signed-in'});
        const source = profiles.store.recoverySource(profile.id, payload?.matchId);
        const existing = store.sessionContext(socket.id);
        const result = store.createRecovery(socket.id, payload, source);
        if (result.ok) {
          const context = store.sessionContext(socket.id);
          try {profiles.store.reserveRecovery(profile.id,payload.matchId,context.memberId);}
          catch (error) {if (!existing) store.remove(socket.id); throw error;}
          socket.join(result.code); broadcast(result.code);
        }
        reply(ack, result);
      } catch (error) {reply(ack, {ok:false,error:error instanceof ProfileError ? error.code : 'recovery-unavailable'});}
    });
    socket.on(EVENTS.HOST_CHECKPOINT, (payload, ack) => {
      const result = store.saveCheckpoint(socket.id, payload);
      if (!result.ok) return reply(ack, result);
      let status = {saved: false, error: 'profile-storage-unavailable'};
      if (persistence && (!result.duplicate || !result.checkpoint.saved)) {
        try {status = persistence.save(store.sessionContext(socket.id), {payload: result.checkpoint.payload});}
        catch (error) {status = {saved:false,error:error instanceof ProfileError ? error.code : 'profile-storage-unavailable'};}
        store.checkpointStatus(result.code, result.checkpoint.revision, status);
      } else if (result.duplicate) status = {saved:result.checkpoint.saved, error: result.checkpoint.saveError};
      reply(ack, {ok:true, revision:result.checkpoint.revision, saved:status.saved, error:status.error});
      broadcast(result.code);
    });
    socket.on(EVENTS.HOST_RECOVERY, (payload, ack) => {
      const result = store.recovery(socket.id, payload);
      if (!result.ok) return reply(ack, result);
      const context = store.sessionContext(socket.id);
      if (context?.room.recoverySource && profiles) {
        try {profiles.store.reserveRecovery(context.profileId,context.room.recoverySource.matchId,context.room.recoverySource.claimId);}
        catch (error) {return reply(ack,{ok:false,error:error instanceof ProfileError ? error.code : 'recovery-unavailable'});}
      }
      // Rotation of the durable host lease makes older TV callbacks stale too.
      if (persistence) {
        try {persistence.restore(store.sessionContext(socket.id));} catch { /* live in-memory checkpoint remains usable */ }
      }
      reply(ack, result);
    });
    socket.on(EVENTS.LOBBY_GET, (payload, ack) => {
      const code = payload?.code;
      reply(ack, code && store.hostedBy(socket.id) === code ? { ok: true, ...store.lobby(code) } : { ok: false, error: ERRORS.NO_ROOM });
    });
    socket.on(EVENTS.PLAYER_START, (_payload, ack) => {
      const result = store.startGame(socket.id);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_READY, (payload, ack) => {
      const result = store.setReady(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_SETUP, (payload, ack) => {
      const result = store.setSetup(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    // Phones drive the vote and the tutorial; everyone sees each vote and check mark.
    for (const [event, method] of [[EVENTS.TUTORIAL_VOTE, 'vote'], [EVENTS.TUTORIAL_MOVE, 'tutorialMove']]) {
      socket.on(event, (payload, ack) => {
        const result = store[method](socket.id, payload);
        reply(ack, result.ok ? { ok: true } : result);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_RETURN_TO_LOBBY, 'host'], [EVENTS.PLAYER_RETURN_TO_LOBBY, 'player']]) {
      socket.on(event, (payload, ack) => {
        const result = store.returnToLobby(socket.id, payload, role);
        reply(ack, result);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_PAUSE, 'host'], [EVENTS.PLAYER_PAUSE, 'player']]) {
      socket.on(event, (payload, ack) => {
        const result = store.setPaused(socket.id, payload, role);
        reply(ack, result);
        if (result.ok && result.changed) broadcast(result.code);
      });
    }
    socket.on(EVENTS.HOST_RESOLVE_MATCH, (payload, ack) => {
      const result = store.resolveMatch(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.SOUND_SET, (payload, ack) => {
      const result = store.setSound(socket.id, payload);
      reply(ack, result);
      if (result.ok && result.changed) broadcast(result.code);
    });
    socket.on(EVENTS.HOST_GAME_OPTIONS, (payload, ack) => {
      const result = store.setGameOptions(socket.id, payload);
      reply(ack, result);
      if (result.ok && result.changed) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_GAME_COMMAND, (event, ack) => {
      const result = store.gameCommandTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host?.connected) {
        store.finishGameCommand(result.code, result.event.id, result.event.gameId);
        return reply(ack, { ok: false, error: 'disconnected' });
      }
      if (['new-match', 'practice-start', 'practice-stop'].includes(event.action)) broadcast(result.code);
      // The phone waits for the game to apply the change, not just relay delivery.
      host.timeout(2500).emit(EVENTS.GAME_COMMAND, result.event, (error, received) => {
        store.finishGameCommand(result.code, result.event.id, result.event.gameId);
        const current = store.lobby(result.code);
        if (current?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        if (current.hostEpoch !== result.hostEpoch || current.inputGeneration !== result.inputGeneration) return reply(ack, {ok:false,error:'outcome-unknown'});
        reply(ack, !error && received?.ok === true ? { ok: true, id: result.event.id }
          : { ok: false, error: !error && typeof received?.error === 'string' && received.error.length <= 160
            ? received.error : 'game-loading' });
      });
    });
    socket.on(EVENTS.HOST_GAME_STATE, (payload, ack) => {
      const result = store.setGameState(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.HOST_GAME_HIT, (event, ack) => {
      const result = store.hitTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const phone = io.sockets.sockets.get(result.phoneSocketId);
      if (!phone?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      // A missed tactile cue is preferable to replaying an old hit on reconnect.
      phone.volatile.emit(EVENTS.GAME_HIT, result.event);
      reply(ack, { ok: true });
    });
    socket.on(EVENTS.PLAYER_ROLL, async (event, ack) => {
      const receivedAt = diagnosticClients.size ? performance.now() : undefined;
      if (rollWaiting) {recordRelay(socket, null, 'roll', event?.id, receivedAt, 'rejected'); return reply(ack, {ok: false, error: 'network-busy'});}
      const result = store.rollTarget(socket.id, event);
      if (!result.ok) {recordRelay(socket, null, 'roll', event?.id, receivedAt, 'rejected'); return reply(ack, result);}
      const sourceMember = store.sessionContext(socket.id)?.memberId;
      const frame = store.lobby(result.code)?.gameState?.frame;
      const host = io.sockets.sockets.get(result.hostSocketId);
      const recordStage = (stage, previous, metric) => {
        if (!diagnosticClients.size) return;
        for (const peer of [socket, host]) {
          const diagnostic = diagnosticFor(peer);
          if (!diagnostic) continue;
          diagnostic.count(`roll.${stage}`);
          diagnostic.mark(result.event.id, stage);
          if (previous) diagnostic.measure(result.event.id, previous, stage, metric);
        }
      };
      const reject = error => {
        const outcome = {ok: false, error, id: result.event.id};
        store.finishRollDelivery(result.code, result.event.id, result.event.gameId, outcome);
        recordRelay(socket, host, 'roll', result.event.id, receivedAt, 'transportDropped');
        reply(ack, outcome);
      };
      if (!host?.connected) return reject('disconnected');
      // rollTarget reserves the lane. Recheck without reserving a second time:
      // a setup reset, replaced phone/TV, changed turn or lobby return must not
      // release an old ball after a stalled transport starts accepting data.
      const currentInput = () => {
        const current = store.lobby(result.code);
        const source = store.sessionContext(socket.id);
        return source?.memberId === sourceMember && source?.role === 'player' &&
          store.hostedBy(host.id) === result.code && current?.sport === 'bowling' &&
          current.phase === PHASES.GAME && !current.paused &&
          current.gameId === result.event.gameId && current.hostEpoch === result.hostEpoch &&
          current.inputGeneration === result.inputGeneration &&
          current.gameState?.phase === 'ready' && current.gameState.currentPlayer === result.event.player &&
          current.gameState.frame === frame;
      };
      rollWaiting = true;
      recordStage('serverWaitStarted');
      const available = await waitForSwingTransport(() => host.conn.transport.writable,
        () => socket.connected && host.connected, currentInput);
      rollWaiting = false;
      recordStage('serverWaitFinished', 'serverWaitStarted', 'roll.transportWaitMs');
      if (available !== 'ready') return reject(available);
      if (!currentInput()) return reject('not-playing');
      // Acknowledge the actual game result. A regular emit queues behind a
      // blocked transport; volatile delivery keeps a release transient.
      recordRelay(socket, host, 'roll', result.event.id, receivedAt, 'relayed');
      host.volatile.timeout(2500).emit(EVENTS.GAME_ROLL, result.event, (error, received) => {
        recordStage('deliverySettled', 'serverRelayed', 'roll.relayRoundTripMs');
        const current = store.lobby(result.code);
        if (current?.hostEpoch !== result.hostEpoch || current?.inputGeneration !== result.inputGeneration) {
          recordStage('unknown');
          store.finishRollDelivery(result.code, result.event.id, result.event.gameId, {ok:false,error:'outcome-unknown'});
          return reply(ack, {ok:false,error:'outcome-unknown',id:result.event.id});
        }
        const outcome = !error && received?.ok === true ? {ok: true, id: result.event.id, receivers: 1}
          : {ok: false, id: result.event.id, error: error ? 'outcome-unknown'
            : typeof received?.error === 'string' && received.error.length <= 160 ? received.error : 'game-loading'};
        recordStage(outcome.ok ? 'accepted' : outcome.error === 'outcome-unknown' ? 'unknown' : 'rejected');
        store.finishRollDelivery(result.code, result.event.id, result.event.gameId, outcome);
        if (store.lobby(result.code)?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        reply(ack, outcome);
      });
    });
    socket.on(EVENTS.HOST_STROKE_RESULT, (event, ack) => {
      const result = store.strokeResultTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const phone = io.sockets.sockets.get(result.phoneSocketId);
      if (!phone?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      phone.volatile.emit(EVENTS.GAME_STROKE_RESULT, result.event);
      reply(ack, { ok: true });
    });
    socket.on(EVENTS.PLAYER_SWING, async (event, ack) => {
      const receivedAt = diagnosticClients.size ? performance.now() : undefined;
      if (swingWaiting) {recordRelay(socket, null, 'swing', event?.id, receivedAt, 'rejected'); return reply(ack, { ok: false, error: 'network-busy' });}
      const result = store.swingTarget(socket.id, event);
      if (!result.ok) {recordRelay(socket, null, 'swing', event?.id, receivedAt, 'rejected'); return reply(ack, result);}
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      swingWaiting = true;
      const available = await waitForSwingTransport(() => host.conn.transport.writable, () => host.connected,
        () => socket.connected, remainingSwingTransportWait(event));
      swingWaiting = false;
      if (available !== 'ready') {recordRelay(socket, host, 'swing', event?.id, receivedAt, 'transportDropped'); return reply(ack, { ok: false, error: available });}
      // Recheck both authenticated sockets and the match after waiting: resume
      // may replace a still-connected phone/TV; pause/replay also invalidates input.
      const current = store.swingTarget(socket.id, event);
      if (!current.ok) return reply(ack, current);
      if (current.hostSocketId !== result.hostSocketId || current.inputGeneration !== result.inputGeneration) {
        return reply(ack, { ok: false, error: 'not-playing' });
      }
      // Once emitted there is no automatic retry or reconnect-buffered delivery.
      recordRelay(socket, host, 'swing', result.event.id, receivedAt, 'relayed');
      host.volatile.timeout(1500).emit(EVENTS.GAME_SWING, result.event, (error, received) => {
        const current = store.lobby(result.code);
        if (current?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        if (current.hostEpoch !== result.hostEpoch || current.inputGeneration !== result.inputGeneration) return reply(ack, {ok:false,error:'outcome-unknown'});
        reply(ack, !error && received?.ok === true
          ? { ok: true, id: result.event.id, receivers: 1 }
          : { ok: false, error: 'game-loading' });
      });
    });
    for (const [event, role] of [[EVENTS.PLAYER_LEAVE, 'player'], [EVENTS.HOST_CLOSE, 'host']]) socket.on(event, (payload, ack) => {
      const result = store.leaveSession(socket.id, payload, role);
      if (result.ok) socket.leave(result.code ?? '');
      reply(ack, {ok:result.ok, ...(result.error ? {error:result.error} : {})});
      if (result.ok && result.code) publish(result);
    });
    socket.on(EVENTS.SESSION_AWAY, payload => {
      const result = store.disconnect(socket.id, payload?.code);
      if (result) socket.leave(result.code);
      publish(result);
    });
    socket.on('disconnect', () => publish(store.disconnect(socket.id)));
  });
  const timer = setInterval(() => {
    for (const result of store.expireDisconnected()) publish(result);
    for (const code of store.countdownCodes) { if (store.finishCountdown(code)) broadcast(code); }
    for (const code of store.voteCodes) { if (store.expireVote(code)) broadcast(code); }
    for (const code of store.reconnectingCodes) broadcast(code);
  }, tickMs);
  timer.unref();
  const beginShutdown = () => {closing = true; clearInterval(timer); directInput.close();};
  const close = () => {
    beginShutdown();
    return closePromise ??= new Promise(resolve => io.close(resolve));
  };
  return {http, io, store, beginShutdown, close};
}
