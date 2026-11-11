/**
 * The TV during the game. The lobby session and game stay mounted when
 * changing view or reconnecting. The tutorial vote and the tutorial, if anyone
 * asked for it, both land here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sportName } from '../lib/sports.js';
import { GameFrame } from './GameFrame.jsx';
import { shouldTogglePause } from '../../../src/network/pauseShortcut.js';

export function TvGame({ lobby, paused, onClose, error, immersive = true, fullscreen = false, fullscreenAvailable = true, onToggleView, onAudio, audioControls,
  onReturnToLobby, returning = false, returnDisabled = false, onPauseToggle, pauseDisabled = false }) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [debugOn, setDebugOn] = useState(false);
  const [swingLabel, setSwingLabel] = useState(null);
  const swingTimer = useRef(null);
  const handleSwing = useCallback(event => {
    clearTimeout(swingTimer.current);
    setSwingLabel(`P${event.player} ${event.label}`);
    swingTimer.current = setTimeout(() => setSwingLabel(null), 1500);
  }, []);
  useEffect(() => () => clearTimeout(swingTimer.current), []);
  useEffect(() => {
    clearTimeout(swingTimer.current);
    setSwingLabel(null);
  }, [lobby.gameId, paused]);
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
          {audioControls}
          <span className="game-session__room" aria-label={`Room ${lobby.code}`}>{lobby.code}</span>
          {!fullscreen && fullscreenAvailable ? <button type="button" className="game-session__fullscreen" onClick={onToggleView}
            title="Enter full screen on this screen" autoFocus>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
            Full screen
          </button> : null}
          <details className="game-session__menu game-session__display" onToggle={event => { if (!event.currentTarget.open) setConfirmReturn(false); }}>
            <summary aria-label="TV display controls" title="TV display controls">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M9 21h6m-3-4v4" /></svg>
              <span>Display</span>
            </summary>
            <div className="game-session__menu-panel">
              <p>Sound and match settings are on your phone.</p>
              {fullscreen || fullscreenAvailable ? <button type="button" className="game-session__view" onClick={onToggleView}>
                {fullscreen ? 'Exit full screen' : 'Full screen'}
              </button> : <p>This browser keeps the game in its window.</p>}
              {onPauseToggle ? <button type="button" disabled={pauseDisabled} onClick={onPauseToggle}
                aria-keyshortcuts="P">{lobby.manuallyPaused ? 'Resume game' : 'Pause game'} · P</button> : null}
              {onReturnToLobby ? <div className="game-session__return">
                <button type="button" disabled={returnDisabled || returning}
                  aria-describedby={confirmReturn ? 'tv-return-explanation' : undefined}
                  onClick={() => { if (confirmReturn) void onReturnToLobby(); else setConfirmReturn(true); }}>
                  {confirmReturn ? returning ? 'Returning…' : 'Save and return' : 'Return to lobby'}
                </button>
                {confirmReturn ? <><p id="tv-return-explanation">Return with everyone? An unfinished match can continue from its last completed point or roll.</p>
                  <button type="button" disabled={returning} onClick={() => setConfirmReturn(false)}>Keep playing</button></> : null}
              </div> : null}
              <button type="button" onClick={onClose}>Close lobby</button>
            </div>
          </details>
        </div>
      </header>
      {error ? <p className="game-session__error" role="alert">{error}</p> : null}
      <GameFrame code={lobby.code} players={lobby.players} paused={paused} sport={lobby.sport} gameId={lobby.gameId} gameState={lobby.gameState} generation={lobby.inputGeneration} hostEpoch={lobby.hostEpoch} matchRound={lobby.matchRound}
        onAudio={onAudio} manuallyPaused={lobby.manuallyPaused} onPauseToggle={pauseDisabled ? undefined : onPauseToggle}
        onSwing={handleSwing}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.`
            : lobby.manuallyPaused ? 'Game paused · resume on Player 1’s phone or press P on the TV.' : undefined} />
      {/* later should be an easier way to register things inside the debug view*/}
      <button type="button" className="tv-debug-toggle" onClick={() => setDebugOn(v => !v)} aria-pressed={debugOn} title="Toggle swing diagnostics" aria-label="Toggle swing diagnostics">D</button>
      {debugOn && swingLabel ? <div className="tv-swing-debug" aria-hidden="true">{swingLabel}</div> : null}
    </main>
  );
}
