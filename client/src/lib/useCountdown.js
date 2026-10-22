import { useEffect, useState } from 'react';

const TICK_MS = 250;

/**
 * Whole seconds left on a server countdown. The server sends time remaining,
 * not a timestamp, so the deadline is pinned to this device's clock when the
 * value arrives and skew between devices never matters. Pass null when no
 * countdown is running.
 */
export function useCountdown(msLeft) {
  const [deadline, setDeadline] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Every new snapshot (a new msLeft) re-pins the deadline.
  useEffect(() => {
    setDeadline(msLeft == null ? null : Date.now() + msLeft);
    setNow(Date.now());
  }, [msLeft]);

  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [deadline]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
