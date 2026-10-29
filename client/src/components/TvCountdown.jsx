/**
 * The Play slot in the TV lobby. Nobody clicks it: it waits, grayed out,
 * until every phone is ready, then turns into a big 5, 4, 3, 2, 1. The server
 * ends the countdown; this only shows the time left.
 */

import { PHASES } from '@wee/shared/protocol.js';
import { useCountdown } from '../lib/useCountdown.js';

export function TvCountdown({ lobby }) {
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown.msLeft : null);

  if (!counting) {
    return (
      <p className="play-slot" data-state="waiting">
        <span className="play-slot__label">Play</span>
        <span className="play-slot__hint">Starts when everyone is ready</span>
      </p>
    );
  }

  return (
    <p className="play-slot" data-state="counting">
      {/* Keyed by the number, so each one gets its own entrance. */}
      <span key={secondsLeft} className="play-slot__number" aria-hidden="true">
        {secondsLeft > 0 ? secondsLeft : 'Go!'}
      </span>
      {/* Announced once, rather than once a second. */}
      <span className="visually-hidden" role="status">
        Everyone is ready. Starting in {Math.ceil(lobby.countdown.msLeft / 1000)} seconds.
      </span>
    </p>
  );
}
