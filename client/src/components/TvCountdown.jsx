/**
 * The full-screen 5, 4, 3, 2, 1 after the TV presses Play. The server ends
 * it; this only shows the time left.
 */

import { sportName } from '../lib/sports.js';
import { useCountdown } from '../lib/useCountdown.js';

export function TvCountdown({ lobby }) {
  const secondsLeft = useCountdown(lobby.countdown?.msLeft ?? null);

  return (
    <main className="countdown">
      <p className="countdown__label">Get ready!</p>
      {/* Keyed by the number, so each one gets its own entrance. */}
      <p key={secondsLeft} className="countdown__number" aria-hidden="true">
        {secondsLeft > 0 ? secondsLeft : 'Go!'}
      </p>
      <p className="countdown__label">{sportName(lobby.sport)} is about to start</p>
      {/* Announced once, rather than once a second. */}
      <p className="visually-hidden" role="status">
        Starting in {Math.ceil((lobby.countdown?.msLeft ?? 0) / 1000)} seconds.
      </p>
    </main>
  );
}
