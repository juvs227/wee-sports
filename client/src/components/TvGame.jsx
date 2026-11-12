/**
 * The TV during the game. The lobby session and game stay mounted when
 * changing view or reconnecting. The tutorial vote and the tutorial, if anyone
 * asked for it, both land here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';
import { shouldTogglePause } from '../../../src/network/pauseShortcut.js';

const PLAYER_COLORS = { 1: 'red', 2: 'blue', 3: 'lime', 4: 'orange' };


export function TvGame({ lobby, paused, onClose, error, immersive = true, fullscreen = false, onToggleView, onAudio,
  onReturnToLobby, returning = false, returnDisabled = false, onPauseToggle, pauseDisabled = false, startPracticeOnReady = false }) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [debugOn, setDebugOn] = useState(false);
  const [debugArrows, setDebugArrows] = useState(true);
  const [debugLabel, setDebugLabel] = useState(true);
  const [debugPractice, setDebugPractice] = useState(false);
  const [debugLaunch, setDebugLaunch] = useState(true);
  const [aimSensitivity, setAimSensitivity] = useState(1);
  const [swingDebug, setSwingDebug] = useState(null);
  const swingTimer = useRef(null);
  const commandRef = useRef(null);
  const debugRef = useRef(null);
  const handleReady = useCallback(() => {
    if (startPracticeOnReady) commandRef.current?.('practice-start', { stroke: 'alternate', hand: 'Right' });
  }, [startPracticeOnReady]);
  const handleSwing = useCallback(event => {
    clearTimeout(swingTimer.current);
    console.log("swing data received");
    console.log("event net normal", event.netNormal);
    console.log("event swing normal", event.swingNormal);
    if (event.netNormal && event.swingNormal) {
      console.log('swing debug', { netNormal: event.netNormal, swingNormal: event.swingNormal, label: event.label, player: event.player });
      setSwingDebug({ netNormal: event.netNormal, swingNormal: event.swingNormal, label: event.label, player: event.player });
    }
    swingTimer.current = setTimeout(() => setSwingDebug(null), 3000);
  }, []);
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
        onSwing={handleSwing}
        commandRef={commandRef}
        debugRef={debugRef}
        onReady={handleReady}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.`
            : lobby.manuallyPaused ? 'Game paused · resume on Player 1\u2019s phone or press P on the TV.' : undefined} />
      <button type="button" className="tv-debug-toggle" onClick={() => setDebugOn(v => !v)} aria-pressed={debugOn} title="Toggle debug">D</button>
      {debugOn && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10000, background: 'black', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: 'white' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={debugArrows} onChange={e => setDebugArrows(e.target.checked)} /> arrows
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={debugLabel} onChange={e => setDebugLabel(e.target.checked)} /> label
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <span style={{ minWidth: 60 }}>aim {Math.round(aimSensitivity * 100)}%</span>
          <input type="range" min="0" max="100" step="0.1" value={aimSensitivity} style={{ cursor: 'pointer' }} onChange={e => {
            const v = Number(e.target.value);
            console.log("oh baby aim sensitivity to: ", v); 
            setAimSensitivity(v);
            commandRef.current?.('configure', { settings: { aimSensitivity: v } });
          }} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={debugLaunch} onChange={e => {
            const on = e.target.checked;
            setDebugLaunch(on);
            debugRef.current?.({ launchArrow: on });
          }} /> launch arrow
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={debugPractice} onChange={e => {
            const on = e.target.checked;
            setDebugPractice(on);
            commandRef.current?.(on ? 'practice-start' : 'practice-stop', on ? { stroke: 'alternate', hand: 'Right' } : {});
          }} /> practice
        </label>
      </div>}
      {debugOn && debugLabel && swingDebug && <div style={{ position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 9999, background: 'black', borderRadius: 8, padding: '12px 16px', fontSize: 24, fontWeight: 'bold', color: PLAYER_COLORS[swingDebug.player] ?? 'white' }} aria-hidden="true">P{swingDebug.player} {swingDebug.label}</div>}
      {debugOn && debugArrows && swingDebug && <svg style={{ position: 'fixed', top: 16, left: 16, zIndex: 9999, background: 'black', borderRadius: 8 }} viewBox="0 0 200 200" width="300" height="300" aria-hidden="true">
        <line x1="100" y1="100" x2={100 + swingDebug.netNormal[0] * 80} y2={100 - swingDebug.netNormal[1] * 80} stroke="cyan" strokeWidth="3" />
        <line x1="100" y1="100" x2={100 + swingDebug.swingNormal[0] * 80} y2={100 - swingDebug.swingNormal[1] * 80} stroke="yellow" strokeWidth="3" />
        <text x="4" y="16" fill="cyan" fontSize="14">net</text>
        <text x="4" y="34" fill="yellow" fontSize="14">swing</text>
        <text x="4" y="52" fill="white" fontSize="14">{swingDebug.label}</text>
      </svg>}
    </main>
  );
}
