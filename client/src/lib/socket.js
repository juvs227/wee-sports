import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * One connection per tab, shared by every page, so moving between pages never
 * drops a seat. Same origin by default: in development Vite proxies
 * /socket.io to the game server.
 */
export const socket = io(import.meta.env.VITE_SERVER_URL || undefined);

const TIMEOUT_MS = 5000;

/** Emits and waits for the server's ack. Resolves { ok: false, error: 'timeout' } rather than hanging. */
export function request(event, payload) {
  return new Promise((resolve) => {
    socket.timeout(TIMEOUT_MS).emit(event, payload, (err, response) => {
      resolve(err ? { ok: false, error: 'timeout' } : response);
    });
  });
}

/** 'connecting' | 'online' | 'offline'. Socket.io keeps retrying while offline. */
export function useConnection() {
  const [state, setState] = useState(socket.connected ? 'online' : 'connecting');

  useEffect(() => {
    const online = () => setState('online');
    const offline = () => setState('offline');
    socket.on('connect', online);
    socket.on('disconnect', offline);
    socket.on('connect_error', offline);
    if (socket.connected) online();
    return () => {
      socket.off('connect', online);
      socket.off('disconnect', offline);
      socket.off('connect_error', offline);
    };
  }, []);

  return state;
}

/**
 * Leaving a page gives up its seat or closes its lobby. StrictMode unmounts
 * and remounts every effect once in development, so the leave is deferred by
 * a tick and the remount cancels it. Only a real departure reaches the server.
 */
const pendingLeaves = new Map();

export function leaveSoon(event) {
  clearTimeout(pendingLeaves.get(event));
  pendingLeaves.set(
    event,
    setTimeout(() => {
      pendingLeaves.delete(event);
      socket.emit(event);
    }, 0),
  );
}

export function cancelLeave(event) {
  clearTimeout(pendingLeaves.get(event));
  pendingLeaves.delete(event);
}
