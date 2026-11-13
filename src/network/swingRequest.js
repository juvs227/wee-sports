import {TENNIS_TRANSPORT_WAIT_MS} from '../../shared/protocol.js';

export const SWING_TRANSPORT_WAIT_MS = TENNIS_TRANSPORT_WAIT_MS;
export const ROLL_TRANSPORT_WAIT_MS = 80;
const waiting = new WeakSet();

/** Allow a normal polling handoff, but never retain input through a long stall. */
export function waitForSwingTransport(writable, connected, current = () => true, maxWaitMs = ROLL_TRANSPORT_WAIT_MS) {
  const deadline = performance.now() + Math.max(0,maxWaitMs);
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

/** A phone's queue time spends the same budget at the server. Missing metadata
 * supports older/native senders; invalid values cannot increase the cap. */
export function remainingSwingTransportWait(event) {
  const spent = event?.transportWaitMs ?? 0;
  return Number.isFinite(spent) && spent >= 0 && spent <= SWING_TRANSPORT_WAIT_MS
    ? SWING_TRANSPORT_WAIT_MS-spent : 0;
}

/** At most one stroke waits for this socket; emitted strokes are never retried. */
export async function sendSwingRequest(socket, event, payload, current = () => true, ackTimeoutMs = 2000) {
  if (waiting.has(socket)) return {ok: false, error: 'network-busy'};
  waiting.add(socket);
  const started = performance.now(), tennis = payload?.type === 'swing';
  const budget = tennis ? SWING_TRANSPORT_WAIT_MS : ROLL_TRANSPORT_WAIT_MS;
  const state = await waitForSwingTransport(() => Boolean(socket.io.engine?.transport?.writable),
    () => socket.connected, current, budget);
  waiting.delete(socket);
  if (state !== 'ready') return {ok: false, error: state};
  const waited = Math.ceil(performance.now()-started);
  if (waited >= budget) return {ok:false,error:'network-busy'};
  const envelope = {...payload};
  // Never trust caller-supplied queue time; this side measured its own wait.
  delete envelope.transportWaitMs;
  if (tennis && waited > 0) envelope.transportWaitMs = waited;
  return new Promise(resolve => {
    socket.volatile.timeout(ackTimeoutMs).emit(event, envelope, (err, response) => {
      resolve(err ? {ok: false, error: 'timeout'} : response);
    });
  });
}
