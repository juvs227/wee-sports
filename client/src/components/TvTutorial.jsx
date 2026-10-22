/**
 * Placeholder tutorial screen. The countdown lands here; the tutorial content
 * itself comes later.
 */

import { StubBanner } from './StubBanner.jsx';
import { sportName } from '../lib/sports.js';

export function TvTutorial({ lobby }) {
  return (
    <main className="stub">
      <StubBanner>Tutorial</StubBanner>
      <h1>How to play {sportName(lobby.sport)}</h1>
      <p className="stub__muted">The tutorial goes here. Its content arrives in a later week.</p>
      <p className="stub__status" role="status">
        {lobby.players.length} players are watching.
      </p>
    </main>
  );
}
