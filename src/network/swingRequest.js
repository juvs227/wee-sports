export const SWING_TRANSPORT_WAIT_MS = 80;
const waiting = new WeakSet();

/** Allow a normal polling handoff, but never retain input through a long stall. */
export function waitForSwingTransport(writable, connected, current = () => true) {
  const deadline = performance.now() + SWING_TRANSPORT_WAIT_MS;
  return new Promise(resolve => {
    const check = () => {
      if (!current()) return resolve('not-playing');
      if (!connected()) return resolve('disconnected');
      if (performance.now() >= deadline) return resolve('network-busy');
      if (writable()) return resolve('ready');
      setTimeout(check, 4);
    };
    check();
  });
}

/** At most one stroke waits for this socket; emitted strokes are never retried. */
export async function sendSwingRequest(socket, event, payload, current = () => true) {
  if (waiting.has(socket)) return {ok: false, error: 'network-busy'};
  waiting.add(socket);
  const state = await waitForSwingTransport(() => Boolean(socket.io.engine?.transport?.writable),
    () => socket.connected, current);
  waiting.delete(socket);
  if (state !== 'ready') return {ok: false, error: state};
  return new Promise(resolve => {
    socket.volatile.timeout(2000).emit(event, payload, (err, response) => {
      resolve(err ? {ok: false, error: 'timeout'} : response);
    });
  });
}
