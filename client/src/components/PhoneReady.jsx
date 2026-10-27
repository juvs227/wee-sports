/**
 * The phone's side of the ready check: one big toggle and the count, then the
 * wait for Play, the countdown, and the tutorial. Kept out of JoinStub so the
 * phone display owner can restyle it on its own.
 */

import { useState } from 'react';
import { EVENTS, PHASES } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useCountdown } from '../lib/useCountdown.js';

/** lobby is the latest snapshot; slot is this phone's seat. */
export function PhoneReady({ lobby, slot, disabled = false }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const secondsLeft = useCountdown(lobby.countdown?.msLeft ?? null);

  if (lobby.phase === PHASES.ALL_READY) {
    return (
      <section className="phone-ready" aria-live="polite">
        <h2 className="phone-ready__title">Everyone&rsquo;s ready!</h2>
        <p className="stub__status">Waiting for the TV to press Play…</p>
      </section>
    );
  }

  if (lobby.phase === PHASES.COUNTDOWN) {
    return (
      <section className="phone-ready">
        <h2 className="phone-ready__title" role="timer">
          {secondsLeft > 0 ? `Starting in ${secondsLeft}…` : 'Go!'}
        </h2>
        <p className="stub__status">Look at the TV</p>
      </section>
    );
  }

  if (lobby.phase === PHASES.TUTORIAL) {
    return (
      <section className="phone-ready" aria-live="polite">
        <h2 className="phone-ready__title">Tennis is ready</h2>
        <p className="stub__status">Watch the TV</p>
      </section>
    );
  }

  // The snapshot is the source of truth, so the button always matches the TV.
  const ready = lobby.players.find((player) => player.slot === slot)?.ready ?? false;
  const readyCount = lobby.players.filter((player) => player.ready).length;

  async function toggle() {
    setSending(true);
    setError(null);
    const result = await request(EVENTS.PLAYER_READY, { ready: !ready });
    setSending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <section className="phone-ready">
      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      <button
        type="button"
        className={`btn ${ready ? 'btn--ghost' : 'btn--primary'} phone-ready__btn`}
        aria-pressed={ready}
        disabled={sending || disabled}
        onClick={toggle}
      >
        {ready ? 'Ready ✓ (tap to undo)' : 'Ready'}
      </button>
      <p className="phone-ready__count" aria-live="polite">
        {readyCount}/{lobby.players.length} ready
      </p>
    </section>
  );
}
