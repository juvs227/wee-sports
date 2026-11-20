/**
 * The phone's side of the tutorial. Players who voted Yes do each move;
 * everyone else follows along on the TV. Kept out of JoinStub so the phone
 * display owner can restyle it on its own.
 *
 * Motion players really do the move: the controller watches for it and
 * reports each attempt here. A matching attempt counts the step; a wrong one
 * says what the phone saw so the player can try again. After a few misses, or
 * if nothing is recognized for a while, a Skip button appears so nobody holds
 * up the room. Button players keep a Done button. The server ignores repeats,
 * so a late or duplicate report is harmless.
 */

import { useEffect, useRef, useState } from 'react';
import { EVENTS } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { attemptFeedback, tutorialMove } from '../lib/tutorials.js';

/** Wrong attempts before Skip appears. */
export const SKIP_AFTER_MISSES = 3;
/** Time without a recognized move before a hint and Skip appear. */
export const SKIP_AFTER_MS = 20000;

/**
 * lobby is the latest snapshot; slot is this phone's seat; attempt is the
 * latest move the controller saw ({ step, detected, matched }), a new object
 * per attempt. Remount per step.
 */
export function PhoneTutorial({ lobby, slot, attempt = null }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [misses, setMisses] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [stalled, setStalled] = useState(false);
  const seenAttempt = useRef(attempt);

  const { step, moves, learners, done } = lobby.tutorial;
  const move = tutorialMove(lobby.sport, moves[step]);
  const learning = learners.includes(slot);
  const finished = done.includes(slot);
  const waitingFor = learners.filter((learner) => !done.includes(learner)).length;
  const usesMotion = lobby.players.find((player) => player.slot === slot)?.setup === 'motion';

  async function reportMove() {
    setSending(true);
    setError(null);
    const result = await request(EVENTS.TUTORIAL_MOVE, { step });
    setSending(false);
    if (!result.ok) setError(result.error);
  }

  // Each new attempt for this step either counts or explains the miss. The
  // attempt that was already there when this step mounted belongs to an
  // earlier step, so it is ignored.
  useEffect(() => {
    if (!attempt || attempt === seenAttempt.current) return;
    seenAttempt.current = attempt;
    if (attempt.step !== step || !learning || finished || sending) return;
    if (attempt.matched) {
      setFeedback('');
      void reportMove();
    } else {
      setMisses((count) => count + 1);
      setFeedback(attemptFeedback(lobby.sport, moves[step], attempt.detected));
    }
  }, [attempt, step, learning, finished, sending, lobby.sport, moves]);

  // Nothing recognized for a while: suggest a faster move and offer Skip.
  useEffect(() => {
    if (!usesMotion || !learning || finished) return undefined;
    const timer = setTimeout(() => setStalled(true), SKIP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [usesMotion, learning, finished]);

  const canSkip = misses >= SKIP_AFTER_MISSES || stalled;

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
          {usesMotion ? (
            <>
              <p className="stub__status">
                {feedback ||
                  (stalled
                    ? 'Nothing yet? Make the move bigger and faster.'
                    : 'Do it now. Your phone is watching.')}
              </p>
              {canSkip ? (
                <button
                  type="button"
                  className="btn btn--ghost phone-tutorial__btn"
                  disabled={sending}
                  onClick={reportMove}
                >
                  Skip this move
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary phone-tutorial__btn"
              disabled={sending}
              onClick={reportMove}
            >
              Done
            </button>
          )}
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
