/**
 * The Wee Sports game server: rooms over Socket.io.
 *
 * All the rules live in RoomStore. This file only wires sockets to it and
 * decides who hears about each change.
 */

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ERRORS, EVENTS } from '@wee/shared/protocol.js';
import { RoomStore } from './RoomStore.js';

const PORT = Number(process.env.PORT ?? 3001);

/**
 * Comma-separated origins allowed to connect. Unset allows any origin, which is
 * only right for local development; a deployment must set it.
 */
const ORIGINS = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const http = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }
  response.writeHead(404);
  response.end();
});

const io = new Server(http, {
  cors: { origin: ORIGINS.length > 0 ? ORIGINS : true },
});

const store = new RoomStore();

function reply(ack, value) {
  if (typeof ack === 'function') ack(value);
}

function broadcastLobby(code) {
  io.to(code).emit(EVENTS.LOBBY_UPDATE, store.lobby(code));
}

/** code -> the timeout that ends that room's countdown. */
const countdownTimers = new Map();

function clearCountdownTimer(code) {
  clearTimeout(countdownTimers.get(code));
  countdownTimers.delete(code);
}

/** The store decides whether the deadline has passed; this only wakes it up. */
function armCountdownTimer(code, msLeft) {
  clearCountdownTimer(code);
  countdownTimers.set(
    code,
    setTimeout(() => {
      countdownTimers.delete(code);
      if (store.finishCountdown(code)) broadcastLobby(code);
    }, msLeft),
  );
}

io.on('connection', (socket) => {
  /** Takes this socket out of its room and tells whoever is left. */
  const drop = () => {
    const result = store.remove(socket.id);
    if (!result) return;
    if (result.closed || result.countdownCancelled) clearCountdownTimer(result.code);
    if (result.closed) {
      socket.to(result.code).emit(EVENTS.ROOM_CLOSED, { code: result.code });
      io.in(result.code).socketsLeave(result.code);
      return;
    }
    socket.leave(result.code);
    broadcastLobby(result.code);
  };

  socket.on(EVENTS.HOST_CREATE, (payload, ack) => {
    // A TV that opens a second lobby gives up its first one.
    drop();
    const result = store.createRoom(socket.id, payload);
    if (result.ok) socket.join(result.code);
    reply(ack, result);
  });

  socket.on(EVENTS.LOBBY_GET, (payload, ack) => {
    const code = payload?.code;
    // Only the TV that opened a lobby can read it this way. After a reload the
    // TV has a new socket, and the old lobby closed with the old one.
    if (!code || store.hostedBy(socket.id) !== code) {
      reply(ack, { ok: false, error: ERRORS.NO_ROOM });
      return;
    }
    reply(ack, { ok: true, ...store.lobby(code) });
  });

  socket.on(EVENTS.PLAYER_JOIN, (payload, ack) => {
    drop();
    const result = store.join(socket.id, payload);
    if (result.ok) {
      socket.join(result.code);
      socket.to(result.code).emit(EVENTS.LOBBY_UPDATE, store.lobby(result.code));
    }
    reply(ack, result);
  });

  socket.on(EVENTS.PLAYER_READY, (payload, ack) => {
    const result = store.setReady(socket.id, payload);
    if (!result.ok) {
      reply(ack, result);
      return;
    }
    reply(ack, { ok: true });
    // Everyone, the sender included, sees who is ready (or the next phase).
    broadcastLobby(result.code);
  });

  socket.on(EVENTS.HOST_START, (_payload, ack) => {
    const result = store.start(socket.id);
    if (!result.ok) {
      reply(ack, result);
      return;
    }
    armCountdownTimer(result.code, result.msLeft);
    reply(ack, { ok: true });
    broadcastLobby(result.code);
  });

  socket.on(EVENTS.PLAYER_LEAVE, drop);
  socket.on(EVENTS.HOST_CLOSE, drop);
  socket.on('disconnect', drop);
});

http.listen(PORT, () => {
  console.log(`Wee Sports server listening on http://localhost:${PORT}`);
});
