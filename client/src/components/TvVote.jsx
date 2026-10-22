/**
 * The TV during the tutorial vote, then the reveal. Read from across a room,
 * so everything is big.
 *
 * Seat colors (--p1..--p4) are identity only. P2 is red, P3 green and P4
 * yellow, so vote state never uses color: it is the border style (dashed while
 * waiting, solid once in), an icon, and a word.
 */

import { PHASES, PICKS } from '@wee/shared/protocol.js';
import { useCountdown } from '../lib/useCountdown.js';
import { CheckIcon, DashIcon, PlayIcon, SkipIcon } from './icons.jsx';

const STATES = {
  waiting: { Icon: null, label: 'Voting…' },
  voted: { Icon: CheckIcon, label: 'Voted' },
  [PICKS.YES]: { Icon: PlayIcon, label: 'Yes' },
  [PICKS.NO]: { Icon: SkipIcon, label: 'Skip' },
  [PICKS.NONE]: { Icon: DashIcon, label: 'No vote' },
};

export function TvVote({ lobby }) {
  const open = lobby.phase === PHASES.VOTE;
  const secondsLeft = useCountdown(open ? lobby.vote.msLeft : null);
  const names = new Map(lobby.players.map((player) => [player.slot, player.name]));

  // While open, the server only says who has voted. Once resolved, it gives
  // every pick, including players who have since left.
  const cards = open
    ? lobby.players.map(({ slot, name }) => ({
        slot,
        name,
        state: lobby.vote.voted.includes(slot) ? 'voted' : 'waiting',
      }))
    : lobby.vote.picks.map(({ slot, pick }) => ({
        slot,
        name: names.get(slot) ?? `Player ${slot + 1}`,
        state: pick,
      }));

  const tutorial = lobby.phase === PHASES.TUTORIAL;
  const status = open
    ? `${lobby.vote.voted.length} of ${lobby.players.length} players have voted.`
    : `${tutorial ? 'Tutorial time!' : 'Skipping the tutorial.'} ${cards
        .map(({ name, state }) => `${name}: ${STATES[state].label}`)
        .join(', ')}.`;

  return (
    <main className="vote" data-open={open}>
      {open ? (
        <header className="vote__head">
          <div>
            <h1 className="vote__title">Check your phone</h1>
            <p className="vote__sub">Watch the tutorial?</p>
          </div>
          <p className="vote__timer" role="timer" aria-label={`${secondsLeft ?? ''} seconds left`}>
            <span className="vote__seconds">{secondsLeft ?? ''}</span>
            <span className="vote__unit">sec</span>
          </p>
        </header>
      ) : (
        <header className="vote__head">
          <div>
            <h1 className="vote__title">{tutorial ? 'Tutorial time!' : 'Skipping the tutorial'}</h1>
            <p className="vote__sub">
              {tutorial ? 'Someone wants to learn the moves first.' : 'Nobody asked for it. Straight to the game.'}
            </p>
          </div>
        </header>
      )}

      <ul className="vote__cards">
        {cards.map(({ slot, name, state }) => {
          const { Icon, label } = STATES[state];
          return (
            <li
              key={slot}
              className="vote-card"
              data-state={state}
              style={{ '--player': `var(--p${slot + 1})` }}
            >
              <span className="seat__badge seat__badge--big" data-slot={slot}>
                P{slot + 1}
              </span>
              <span className="vote-card__name">{name}</span>
              <span className="vote-card__status">
                {Icon ? <Icon className="vote-card__icon" /> : null}
                {label}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="visually-hidden" role="status" aria-live="polite">
        {status}
      </p>
    </main>
  );
}
