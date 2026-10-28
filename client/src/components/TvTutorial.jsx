/**
 * The existing post-countdown screen now hosts main's tennis prototype.
 * The lobby protocol keeps its tutorial phase until tutorial voting is integrated.
 */

import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';

export function TvTutorial({ lobby, paused, onClose, error }) {
  return (
    <main className="tennis-session">
      <div className="match-heading"><div><p className="eyebrow">Wee Sports · {lobby.code}</p>
      <h1>{sportName(lobby.sport)} {lobby.sport === 'bowling' ? 'lanes' : 'court'}</h1></div>
      <span className="match-pill">{lobby.sport === 'bowling' ? `${lobby.players.length} players · 10 frames` : lobby.players.some(player => player.slot === 1) ? '2 players · head to head' : 'Solo · vs bot'}</span></div>
      <p className="stub__muted">{lobby.sport === 'bowling' ? 'Aim on your phone, arm a motion roll, then make an underhand swing. Keep a firm grip. You can also use the Roll button.' : 'P1 is blue. P2 is red. Swing to serve, then swing as the ball approaches your side.'}</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <PrototypeFrame code={lobby.code} players={lobby.players} paused={paused} sport={lobby.sport} gameId={lobby.gameId} gameState={lobby.gameState}
        pauseMessage={lobby.reconnecting?.length ? `Waiting for ${lobby.reconnecting.map(member => member.name).join(', ')} to reconnect.`
          : lobby.setupPending?.length ? `Waiting for ${lobby.setupPending.join(', ')} to finish controller setup.` : undefined} />
      <button type="button" className="btn btn--ghost" onClick={onClose}>Close lobby</button>
    </main>
  );
}
