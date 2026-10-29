/**
 * The TV lobby's seat list, with each player's ready state. Read from across
 * a room, so the type is big.
 *
 * Seat colors (--p1..--p4) are identity only. P2 is red, P3 green and P4
 * yellow, so ready state never uses color: it is the border style (dashed or
 * solid), a check mark, and a word.
 */

import { MAX_PLAYERS, PHASES, PLAYERS_TO_START } from '@wee/shared/protocol.js';
import { CheckIcon } from './icons.jsx';

export function TvReady({ lobby }) {
  const seats = Array.from(
    { length: MAX_PLAYERS },
    (_, slot) => lobby.players.find((player) => player.slot === slot) ?? null,
  );
  const readyCount = lobby.players.filter((player) => player.ready).length;
  const missing = PLAYERS_TO_START - lobby.players.length;

  let title = 'Press Ready on your phone';
  if (lobby.phase === PHASES.COUNTDOWN) title = 'Everyone’s ready!';
  else if (missing > 0) title = `Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}`;

  return (
    <section className="ready" data-counting={lobby.phase === PHASES.COUNTDOWN}>
      <div className="ready__head">
        <h2 className="ready__title">{title}</h2>
        <p className="ready__count" aria-hidden="true">
          <span className="ready__number">
            {readyCount}/{PLAYERS_TO_START}
          </span>{' '}
          ready
        </p>
      </div>

      <ul className="ready__cards">
        {seats.map((player, slot) => {
          if (!player) {
            return (
              <li key={slot} className="ready-card" data-empty="true">
                <span className="seat__badge" data-slot={slot}>
                  P{slot + 1}
                </span>
                <span className="ready-card__name">Open seat</span>
              </li>
            );
          }
          return (
            <li
              key={slot}
              className="ready-card"
              data-ready={player.ready}
              style={{ '--player': `var(--p${slot + 1})` }}
            >
              <span className="seat__badge" data-slot={slot}>
                P{slot + 1}
              </span>
              <span className="ready-card__name">{player.name}</span>
              <span className="ready-card__status">
                {player.ready ? <CheckIcon className="ready-card__icon" /> : null}
                {player.ready ? 'Ready' : 'Not ready'}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="visually-hidden" role="status" aria-live="polite">
        {`${lobby.players.length} of ${MAX_PLAYERS} seats filled. ${readyCount} of ${PLAYERS_TO_START} players ready.`}
      </p>
    </section>
  );
}
