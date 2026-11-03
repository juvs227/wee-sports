/**
 * The phone's side of the tutorial. Players who voted Yes do each move;
 * everyone else follows along on the TV. Kept out of JoinStub so the phone
 * display owner can restyle it on its own.
 *
 * Until the motion controls land, a Done button stands in for the swing
 * detector. When they do, the detector calls reportMove() once it recognizes
 * lobby.tutorial.moves[step], and the button goes away. The server ignores
 * repeats, so the detector can fire more than once.
 */

import { useState } from 'react';
import { EVENTS } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { tutorialMove } from '../lib/tutorials.js';

/** lobby is the latest snapshot; slot is this phone's seat. Remount per step. */
export function PhoneTutorial({ lobby, slot }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const { step, moves, learners, done } = lobby.tutorial;
  const move = tutorialMove(lobby.sport, moves[step]);
  const learning = learners.includes(slot);
  const finished = done.includes(slot);
  const waitingFor = learners.filter((learner) => !done.includes(learner)).length;

  async function reportMove() {
    setSending(true);
    setError(null);
    const result = await request(EVENTS.TUTORIAL_MOVE, { step });
    setSending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <section className="phone-tutorial" aria-live="polite">
      <p className="phone-tutorial__step">
        Step {step + 1} of {moves.length}
      </p>
      <h2 className="phone-tutorial__title">{move.name}</h2>

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      {!learning ? (
        <p className="stub__status">You&rsquo;re watching this one. Follow along on the TV.</p>
      ) : null}

      {learning && !finished ? (
        <>
          <p className="phone-tutorial__cue">{move.cue}</p>
          <button
            type="button"
            className="btn btn--primary phone-tutorial__btn"
            disabled={sending}
            onClick={reportMove}
          >
            Done
          </button>
        </>
      ) : null}

      {learning && finished ? (
        <p className="stub__status">
          Nice {move.name.toLowerCase()}!{' '}
          {waitingFor > 0
            ? `Waiting for ${waitingFor} more ${waitingFor === 1 ? 'player' : 'players'}…`
            : 'Next move coming up…'}
        </p>
      ) : null}
    </section>
  );
}
