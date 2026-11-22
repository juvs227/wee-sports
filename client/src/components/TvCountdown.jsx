/** The confirmed start owns the entire TV viewport. The server owns its timing. */

import { useEffect } from 'react';
import { PHASES } from '@wee/shared/protocol.js';
import { useCountdown } from '../lib/useCountdown.js';
import { sportName } from '../lib/sports.js';
import { LobbyBackdrop } from './LobbyBackdrop.jsx';
import { SelectedSportIcon } from './SelectedSportIcon.jsx';

export function TvCountdown({ lobby, onTick, fullscreen, fullscreenAvailable = true, onFullscreen }) {
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown.msLeft : null);
  useEffect(() => { if (counting) onTick?.(secondsLeft); }, [counting, secondsLeft, onTick, lobby.gameId]);

  if (!counting) return null;

  return (
    <main className="game-countdown game-countdown--immersive" data-state="counting">
      <LobbyBackdrop />
      {!fullscreen && fullscreenAvailable ? <button type="button" className="game-countdown__view" onClick={onFullscreen}
        title="Enter full screen on this screen" autoFocus>Full screen</button> : null}
      <p className="game-countdown__sport"><SelectedSportIcon sport={lobby.sport} />{sportName(lobby.sport)}</p>
      {/* Keyed by the number, so each one gets its own entrance. */}
      <span key={secondsLeft} className="play-slot__number game-countdown__number" aria-hidden="true">
        {secondsLeft > 0 ? secondsLeft : 'Go!'}
      </span>
      {/* Announced once, rather than once a second. */}
      <span className="visually-hidden" role="status">
        Everyone is ready. Starting in {Math.ceil(lobby.countdown.msLeft / 1000)} seconds.
      </span>
      <p className="game-countdown__hint">Eyes on the TV. Get ready!</p>
    </main>
  );
}
