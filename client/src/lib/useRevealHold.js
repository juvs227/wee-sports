import { useEffect, useState } from 'react';
import { PHASES } from '@wee/shared/protocol.js';

/** How long the vote reveal stays up before the tutorial or game takes over. */
export const REVEAL_MS = 3500;

/**
 * True for a few seconds after this page watches the vote resolve, so
 * everyone sees who picked what before the screen moves on. A page that
 * arrives after the vote goes straight to the current screen.
 */
export function useRevealHold(phase) {
  const [seen, setSeen] = useState(phase);
  const [holding, setHolding] = useState(false);

  // Adjusted during render, not in an effect, so the next screen never
  // flashes for a frame before the reveal.
  if (phase !== seen) {
    setSeen(phase);
    setHolding(seen === PHASES.VOTE);
  }

  useEffect(() => {
    if (!holding) return undefined;
    const timer = setTimeout(() => setHolding(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [holding]);

  return holding;
}
