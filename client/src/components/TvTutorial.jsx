/**
 * The existing post-countdown screen now hosts main's tennis prototype.
 * The lobby protocol keeps its tutorial phase until tutorial voting is integrated.
 */

import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from './PrototypeFrame.jsx';

export function TvTutorial({ lobby, paused, onClose, error }) {
  return (
    <main className="tennis-session">
      <h1>{sportName(lobby.sport)} · lobby {lobby.code}</h1>
      <p>P1 controls the racket. The other seats can watch; this version plays against the bot.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <PrototypeFrame code={lobby.code} paused={paused} />
      <button type="button" className="btn btn--ghost" onClick={onClose}>Close lobby</button>
    </main>
  );
}
