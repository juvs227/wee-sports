/**
 * Only people who have joined appear on the TV. Read from across a room.
 *
 * Seat colors (--p1..--p8) are identity only. P2 is red, P3 green and P4
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
  const leader = players.find(player => player.slot === lobby.leaderSlot);
  if (!players.length) return <p className="host-lobby__waiting" role="status">Waiting for players…</p>;
  const cue = lobby.resumeGame ? 'Everyone keeps their place.' : counting ? 'Starting…' : lobby.canStart && leader ? `Start from ${leader.name}’s phone` : 'Get ready on your phone';

  return (
    <section className="ready" data-counting={counting} aria-label="Lobby players">
      <ul className="ready__cards" aria-label="Joined players" aria-live="polite">
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
              {ready ? 'Ready' : !isController(lobby.sport, slot) ? 'Watching' : setup ? 'Connected' : 'Connecting controller…'}
            </span>
          </li>
        ))}
      </ul>

      <p className="host-lobby__start-cue" role="status">{cue}</p>
    </section>
  );
}
