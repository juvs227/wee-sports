/**
 * The TV during the tutorial, one move at a time. Read from across a room, so
 * everything is big.
 *
 * The server owns the steps. A step ends when every player who voted Yes has
 * done its move on their phone; the others watch along. Nobody touches the TV.
 *
 * Seat colors (--p1..--p4) are identity only. Progress never uses color: it
 * is the border style (dashed while waiting, solid once done), an icon, and a
 * word.
 */

import { sportName } from '../lib/sports.js';
import { GRIP_TIP, tutorialMove } from '../lib/tutorials.js';
import { CheckIcon } from './icons.jsx';
import { MoveDemo } from './MoveDemo.jsx';

const CARD = {
  doing: { label: 'Your turn', Icon: null },
  done: { label: 'Done', Icon: CheckIcon },
  watching: { label: 'Watching', Icon: null },
};

export function TvTutorial({ lobby }) {
  const { step, moves, learners, done } = lobby.tutorial;
  const move = tutorialMove(lobby.sport, moves[step]);

  const cards = lobby.players.map(({ slot, name }) => {
    let state = 'watching';
    if (learners.includes(slot)) state = done.includes(slot) ? 'done' : 'doing';
    return { slot, name, state };
  });
  const waitingOn = cards.filter((card) => card.state === 'doing');

  const status =
    waitingOn.length > 0
      ? `Step ${step + 1} of ${moves.length}: ${move.name}. Waiting for ${waitingOn
          .map((card) => card.name)
          .join(', ')}.`
      : `Step ${step + 1} of ${moves.length}: ${move.name}. Everyone did it!`;

  return (
    <main className="tutorial">
      <header className="tutorial__head">
        <div className="tutorial__intro">
          <p className="tutorial__eyebrow">
            {sportName(lobby.sport)} tutorial · Step {step + 1} of {moves.length}
          </p>
          {/* Keyed by step, so each new move gets its own entrance. */}
          <h1 key={step} className="tutorial__title">
            {move.name}
          </h1>
          <p className="tutorial__cue">{move.cue}</p>
        </div>

        <ol className="tutorial__steps" aria-label="Tutorial steps">
          {moves.map((id, index) => {
            let state = 'next';
            if (index < step) state = 'done';
            else if (index === step) state = 'current';
            return (
              <li
                key={id}
                className="tutorial-step"
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'done' ? <CheckIcon className="tutorial-step__icon" /> : null}
                {tutorialMove(lobby.sport, id).name}
              </li>
            );
          })}
        </ol>
      </header>

      <section key={step} className="tutorial__body">
        <div className="tutorial__demo">
          <MoveDemo move={moves[step]} label={`How to do a ${move.name.toLowerCase()}: ${move.cue}`} />
        </div>
        <div className="tutorial__text">
          <ol className="tutorial__how">
            {move.how.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="tutorial__tip">{GRIP_TIP}</p>
        </div>
      </section>

      <ul className="tutorial__players">
        {cards.map(({ slot, name, state }) => {
          const { label, Icon } = CARD[state];
          return (
            <li
              key={slot}
              className="tutorial-card"
              data-state={state}
              style={{ '--player': `var(--p${slot + 1})` }}
            >
              <span className="seat__badge" data-slot={slot}>
                P{slot + 1}
              </span>
              <span className="tutorial-card__name">{name}</span>
              <span className="tutorial-card__status">
                {Icon ? <Icon className="tutorial-card__icon" /> : null}
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
