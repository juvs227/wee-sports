/**
 * Placeholder game screen. The tutorial and a skipped tutorial both land
 * here; the tennis court arrives with the base-game merge.
 */

import { StubBanner } from './StubBanner.jsx';
import { sportName } from '../lib/sports.js';

export function TvGame({ lobby }) {
  return (
    <main className="stub">
      <StubBanner>Game</StubBanner>
      <h1>{sportName(lobby.sport)}: game on!</h1>
      <p className="stub__muted">The court goes here once the game scene is merged.</p>
      <ul className="seats">
        {lobby.players.map((player) => (
          <li key={player.slot} className="seat">
            <span
              className="seat__badge"
              data-slot={player.slot}
              style={{ '--player': `var(--p${player.slot + 1})` }}
            >
              P{player.slot + 1}
            </span>
            {player.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
