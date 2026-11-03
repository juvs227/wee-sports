/** The lobby session and game stay mounted when changing view or reconnecting. */
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';

export function TvTutorial({ lobby, paused, onClose, error, immersive = true, fullscreen = false, onToggleView }) {
  const bowling = lobby.sport === 'bowling';
  return (
    <main className={`game-session${immersive ? ' game-session--immersive' : ''}`}>
      <header className="game-session__bar">
        <div className="game-session__identity"><span className="game-session__brand">wee.</span>
          <h1>{sportName(lobby.sport)}</h1><span className="game-session__room">{lobby.code}</span></div>
        <div className="game-session__actions">
          <span className="game-session__mode">{bowling ? `${lobby.players.length} ${lobby.players.length === 1 ? 'player' : 'players'} · 10 frames` : lobby.players.some(player => player.slot === 1) ? '2 players · head to head' : 'Solo · vs bot'}</span>
          <details className="game-session__menu">
            <summary>Game options</summary>
            <div className="game-session__menu-panel">
              <p>{bowling ? 'Hold your phone securely. When it’s your turn, make an underhand swing. Watch your release on the lane.' : 'P1 is blue. P2 is red. Swing to serve, then swing as the ball approaches your side.'}</p>
              <button type="button" onClick={onClose}>Close lobby</button>
            </div>
          </details>
          <button type="button" className="game-session__view" onClick={onToggleView}>
            {immersive ? fullscreen ? 'Exit full screen' : 'Windowed view' : 'Full screen'}
          </button>
        </div>
      </header>
      {error ? <p className="game-session__error" role="alert">{error}</p> : null}
      <PrototypeFrame code={lobby.code} players={lobby.players} paused={paused} sport={lobby.sport} gameId={lobby.gameId} gameState={lobby.gameState}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.` : undefined} />
    </main>
  );
}
