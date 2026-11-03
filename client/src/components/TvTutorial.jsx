/** The lobby session and game stay mounted when changing view or reconnecting. */
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';

export function TvTutorial({ lobby, paused, onClose, error, immersive = true, fullscreen = false, onToggleView, onAudio }) {
  return (
    <main className={`game-session${immersive ? ' game-session--immersive' : ''}`}>
      <header className="game-session__bar">
        <div className="game-session__identity"><span className="game-session__brand">wee.</span>
          <h1>{sportName(lobby.sport)}</h1></div>
        <div className="game-session__actions">
          <span className="game-session__room" aria-label={`Room ${lobby.code}`}>{lobby.code}</span>
          <details className="game-session__menu game-session__display">
            <summary aria-label="TV display controls" title="TV display controls">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" /></svg>
            </summary>
            <div className="game-session__menu-panel">
              <p>Sound and match settings are on your phone.</p>
              <button type="button" className="game-session__view" onClick={onToggleView}>
                {immersive ? fullscreen ? 'Exit full screen' : 'Windowed view' : 'Full screen'}
              </button>
              <button type="button" onClick={onClose}>Close lobby</button>
            </div>
          </details>
        </div>
      </header>
      {error ? <p className="game-session__error" role="alert">{error}</p> : null}
      <PrototypeFrame code={lobby.code} players={lobby.players} paused={paused} sport={lobby.sport} gameId={lobby.gameId} gameState={lobby.gameState}
        onAudio={onAudio}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.` : undefined} />
    </main>
  );
}
