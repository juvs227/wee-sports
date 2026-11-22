import {EVENTS} from '../../shared/protocol.js';

const membership = new Set([EVENTS.HOST_CREATE, EVENTS.PLAYER_JOIN, EVENTS.SESSION_RESUME, EVENTS.HOST_RESTORE]);
const streams = new Set([EVENTS.PLAYER_AIM]);
const actions = new Set([EVENTS.PLAYER_SWING, EVENTS.PLAYER_ROLL]);

/** Per-connection buckets expire with the socket. Ordinary 60 Hz controller
 * streams have a separate budget from joining and deliberate actions. */
export function createEventLimiter(now = () => performance.now()) {
  const buckets = new Map();
  return event => {
    const [kind, capacity, rate] = membership.has(event) ? ['membership', 12, 2]
      : streams.has(event) ? ['stream', 240, 120]
      : actions.has(event) ? ['action', 20, 10] : ['control', 120, 60];
    const time = now();
    const bucket = buckets.get(kind) ?? {tokens: capacity, at: time};
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.at) * rate / 1000);
    bucket.at = time;
    buckets.set(kind, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  };
}
