/** The lobby session and game stay mounted when changing view or reconnecting. */
import { useEffect, useState } from 'react';
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';
import { shouldTogglePause } from '../../../src/network/pauseShortcut.js';

export function TvTutorial({ lobby, paused, onClose, error, immersive = true, fullscreen = false, onToggleView, onAudio,
  onReturnToLobby, returning = false, returnDisabled = false, onPauseToggle, pauseDisabled = false }) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  useEffect(() => {
    const keydown = event => {
      if (pauseDisabled || !onPauseToggle || !shouldTogglePause(event)) return;
      event.preventDefault(); void onPauseToggle();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onPauseToggle, pauseDisabled]);
  return (
    <main className={`game-session${immersive ? ' game-session--immersive' : ''}`}>
      <header className="game-session__bar">
        <div className="game-session__identity"><span className="game-session__brand">wee.</span>
          <h1>{sportName(lobby.sport)}</h1></div>
        <div className="game-session__actions">
          <span className="game-session__room" aria-label={`Room ${lobby.code}`}>{lobby.code}</span>
          <details className="game-session__menu game-session__display" onToggle={event => { if (!event.currentTarget.open) setConfirmReturn(false); }}>
            <summary aria-label="TV display controls" title="TV display controls">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" /></svg>
            </summary>
            <div className="game-session__menu-panel">
              <p>Sound and match settings are on your phone.</p>
              <button type="button" className="game-session__view" onClick={onToggleView}>
                {immersive ? fullscreen ? 'Exit full screen' : 'Windowed view' : 'Full screen'}
              </button>
              {onPauseToggle ? <button type="button" disabled={pauseDisabled} onClick={onPauseToggle}
                aria-keyshortcuts="P">{lobby.manuallyPaused ? 'Resume game' : 'Pause game'} · P</button> : null}
              {onReturnToLobby ? <div className="game-session__return">
                <button type="button" disabled={returnDisabled || returning}
                  aria-describedby={confirmReturn ? 'tv-return-explanation' : undefined}
                  onClick={() => { if (confirmReturn) void onReturnToLobby(); else setConfirmReturn(true); }}>
                  {confirmReturn ? returning ? 'Returning…' : 'End match and return' : 'Return to lobby'}
                </button>
                {confirmReturn ? <><p id="tv-return-explanation">End this match and clear its score? Players and controller setup stay in the lobby.</p>
                  <button type="button" disabled={returning} onClick={() => setConfirmReturn(false)}>Keep playing</button></> : null}
              </div> : null}
              <button type="button" onClick={onClose}>Close lobby</button>
            </div>
          </details>
        </div>
      </header>
      {error ? <p className="game-session__error" role="alert">{error}</p> : null}
      <PrototypeFrame code={lobby.code} players={lobby.players} paused={paused} sport={lobby.sport} gameId={lobby.gameId} gameState={lobby.gameState}
        onAudio={onAudio} manuallyPaused={lobby.manuallyPaused} onPauseToggle={pauseDisabled ? undefined : onPauseToggle}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.`
            : lobby.manuallyPaused ? 'Game paused · resume on Player 1’s phone or press P on the TV.' : undefined} />
    </main>
  );
}
