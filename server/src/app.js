import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ERRORS, EVENTS } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';

/** Importable server for tests. index.js owns the listening port. */
export function createGameServer({ store = new RoomStore(), origins = [], tickMs = 250, requestHandler } = {}) {
  const http = createServer((request, response) => {
    if (request.url !== '/health' && requestHandler) return requestHandler(request, response);
    response.writeHead(request.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' });
    response.end(request.url === '/health' ? 'ok' : 'Not found');
  });
  const io = new Server(http, {
    cors: { origin: origins.length ? origins : true },
    pingInterval: 5000,
    pingTimeout: 5000,
    maxHttpBufferSize: 8192,
  });
  const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };
  const broadcast = code => { const lobby = store.lobby(code); if (lobby) io.to(code).emit(EVENTS.LOBBY_UPDATE, lobby); };
  function publish(result) {
    if (!result) return;
    if (result.closed) {
      io.to(result.code).emit(EVENTS.ROOM_CLOSED, { code: result.code });
      io.in(result.code).socketsLeave(result.code);
    } else broadcast(result.code);
  }
  io.on('connection', socket => {
    for (const [event, method] of [[EVENTS.HOST_CREATE, 'createRoom'], [EVENTS.PLAYER_JOIN, 'join'], [EVENTS.SESSION_RESUME, 'resume']]) {
      socket.on(event, (payload, ack) => {
        const result = store[method](socket.id, payload);
        if (result.ok) {
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
    socket.on(EVENTS.LOBBY_GET, (payload, ack) => {
      const code = payload?.code;
      reply(ack, code && store.hostedBy(socket.id) === code ? { ok: true, ...store.lobby(code) } : { ok: false, error: ERRORS.NO_ROOM });
    });
    socket.on(EVENTS.PLAYER_READY, (payload, ack) => {
      const result = store.setReady(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.HOST_START, (_payload, ack) => {
      const result = store.start(socket.id);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_SWING, (event, ack) => {
      const result = store.swingTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host) return reply(ack, { ok: false, error: 'disconnected' });
      // No retries or buffering: a late stroke must never replay after reconnect.
      host.timeout(1500).emit(EVENTS.GAME_SWING, result.event, (error, received) => {
        reply(ack, !error && received?.ok
          ? { ok: true, id: result.event.id, receivers: 1 }
          : { ok: false, error: 'game-loading' });
      });
    });
    const leave = (_payload, ack) => {
      const result = store.remove(socket.id);
      socket.leave(result?.code ?? '');
      reply(ack, { ok: true });
      publish(result);
    };
    socket.on(EVENTS.PLAYER_LEAVE, leave);
    socket.on(EVENTS.HOST_CLOSE, leave);
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
    for (const code of store.reconnectingCodes) broadcast(code);
  }, tickMs);
  timer.unref();
  return { http, io, store, close: () => new Promise(resolve => { clearInterval(timer); io.close(resolve); }) };
}
