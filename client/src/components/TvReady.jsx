/**
 * The ready check, shown inside the TV lobby in place of the seat list. Read
 * from across a room, so the type is big.
 *
 * Seat colors (--p1..--p4) are identity only. P2 is red, P3 green and P4
 * yellow, so ready state never uses color: it is the border style (dashed or
 * solid), a check mark, and a word.
 */

import { PHASES, isController } from '@wee/shared/protocol.js';
import { CheckIcon } from './icons.jsx';

/**
 * Shown through the ready check and the countdown that follows it. Players
 * stay ready during the countdown, and anyone who backs out cancels it, so
 * the cards keep showing who is ready.
 */
export function TvReady({ lobby }) {
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const { players } = lobby;
  const readyCount = players.filter((player) => player.ready).length;
  const title = counting ? 'Everyone’s ready!' : 'Press Ready on your phone';

  return (
    <section className="ready" data-counting={counting}>
      <div className="ready__head">
        <h2 className="ready__title">{title}</h2>
        <p className="ready__count" aria-hidden="true">
          <span className="ready__number">
            {readyCount}/{lobby.players.length}
          </span>{' '}
          ready
        </p>
      </div>

      <ul className="ready__cards">
        {players.map(({ slot, name, ready, setup }) => (
          <li
            key={slot}
            className="ready-card"
            data-ready={ready}
            style={{ '--player': `var(--p${slot + 1})` }}
          >
            <span className="seat__badge" data-slot={slot}>
              P{slot + 1}
            </span>
            <span className="ready-card__name">{name}</span>
            <span className="ready-card__status">
              {ready ? <CheckIcon className="ready-card__icon" /> : null}
              {ready ? 'Ready' : !isController(lobby.sport, slot) ? 'Watching' : setup === 'motion' ? 'Calibrated · press Ready' : setup === 'buttons' ? 'Buttons · press Ready' : 'Set up your controller'}
            </span>
          </li>
        ))}
      </ul>

      <p className="visually-hidden" role="status" aria-live="polite">
        {counting ? title : `${readyCount} of ${lobby.players.length} players ready.`}
      </p>
    </section>
  );
}
