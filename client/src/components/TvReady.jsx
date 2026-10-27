/**
 * The ready check, shown inside the TV lobby in place of the seat list. Read
 * from across a room, so the type is big.
 *
 * Seat colors (--p1..--p4) are identity only. P2 is red, P3 green and P4
 * yellow, so ready state never uses color: it is the border style (dashed or
 * solid), a check mark, and a word.
 */

import { PHASES } from '@wee/shared/protocol.js';
import { CheckIcon } from './icons.jsx';

/**
 * In 'all-ready' the server has cleared the flags, but everyone was ready to
 * get there, so every card is drawn as ready. The lobby's Play button takes it
 * from here.
 */
export function TvReady({ lobby }) {
  const checking = lobby.phase === PHASES.READY;
  const players = lobby.players.map((player) => ({ ...player, ready: !checking || player.ready }));
  const readyCount = players.filter((player) => player.ready).length;
  const title = checking ? 'Press Ready on your phone' : 'Everyone’s ready! Press Play';

  return (
    <section className="ready" data-all-ready={!checking}>
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
        {players.map(({ slot, name, ready }) => (
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
              {ready ? 'Ready' : 'Not ready'}
            </span>
          </li>
        ))}
      </ul>

      <p className="visually-hidden" role="status" aria-live="polite">
        {checking ? `${readyCount} of ${lobby.players.length} players ready.` : title}
      </p>
    </section>
  );
}
