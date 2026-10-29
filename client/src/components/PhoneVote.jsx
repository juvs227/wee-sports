/**
 * The phone's side of the tutorial vote: Yes or No, then wait, then the
 * result. Kept out of JoinStub so the phone display owner can restyle it on
 * its own.
 */

import { useState } from 'react';
import { EVENTS, PHASES, PICKS } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useCountdown } from '../lib/useCountdown.js';

const PICK_TEXT = {
  [PICKS.YES]: 'You picked Yes.',
  [PICKS.NO]: 'You picked No.',
  [PICKS.NONE]: "You didn't vote in time.",
};

/** lobby is the latest snapshot; slot is this phone's seat. */
export function PhoneVote({ lobby, slot }) {
  // The server keeps picks secret until the vote ends, so this phone
  // remembers its own. A fresh vote remounts this component and clears it.
  const [watch, setWatch] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const open = lobby.phase === PHASES.VOTE;
  const secondsLeft = useCountdown(open ? lobby.vote.msLeft : null);

  async function vote(choice) {
    setSending(true);
    setError(null);
    const result = await request(EVENTS.TUTORIAL_VOTE, { watch: choice });
    setSending(false);
    if (result.ok) setWatch(choice);
    else setError(result.error);
  }

  if (!open) {
    const mine = lobby.vote.picks.find((entry) => entry.slot === slot)?.pick;
    return (
      <section className="phone-vote" aria-live="polite">
        <h2 className="phone-vote__title">
          {lobby.phase === PHASES.TUTORIAL ? 'Tutorial time!' : 'Skipping the tutorial'}
        </h2>
        {mine ? <p className="stub__muted">{PICK_TEXT[mine]}</p> : null}
        <p className="stub__status">Look at the TV</p>
      </section>
    );
  }

  const voted = watch !== null || lobby.vote.voted.includes(slot);

  return (
    <section className="phone-vote" aria-live="polite">
      <div className="phone-vote__head">
        <h2 className="phone-vote__title">Watch the tutorial?</h2>
        <p className="phone-vote__timer" role="timer">
          {secondsLeft ?? ''} sec
        </p>
      </div>

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      {voted ? (
        <p className="stub__status">
          {watch === null ? 'Your vote is in.' : PICK_TEXT[watch ? PICKS.YES : PICKS.NO]} Waiting for
          others…
        </p>
      ) : (
        <div className="phone-vote__buttons">
          <button type="button" className="btn btn--primary phone-vote__btn" disabled={sending} onClick={() => vote(true)}>
            Yes
          </button>
          <button type="button" className="btn btn--ghost phone-vote__btn" disabled={sending} onClick={() => vote(false)}>
            No
          </button>
        </div>
      )}
    </section>
  );
}
