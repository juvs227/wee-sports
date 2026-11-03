/**
 * The phone's side of the ready check: one big toggle and the count. Once
 * everyone is ready the countdown shows here too, and the toggle stays so a
 * player can still back out. Kept out of JoinStub so the phone display owner
 * can restyle it on its own.
 */

import { useState } from 'react';
import { EVENTS, PHASES, isController } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useCountdown } from '../lib/useCountdown.js';

/** lobby is the latest snapshot; slot is this phone's seat. */
export function PhoneReady({ lobby, slot, disabled = false }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown.msLeft : null);

  // The snapshot is the source of truth, so the button always matches the TV.
  const ready = lobby.players.find((player) => player.slot === slot)?.ready ?? false;
  const needsSetup = isController(lobby.sport, slot) && !lobby.players.find(player => player.slot === slot)?.setup;
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
      {counting ? (
        <h2 className="phone-ready__title" role="timer">
          {secondsLeft > 0 ? `Starting in ${secondsLeft}…` : 'Go!'}
        </h2>
      ) : null}

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      <button
        type="button"
        className={`btn ${ready ? 'btn--ghost' : 'btn--primary'} phone-ready__btn`}
        aria-pressed={ready}
        disabled={sending || disabled || needsSetup}
        onClick={toggle}
      >
        {ready ? 'Ready ✓ (tap to undo)' : 'Ready'}
      </button>
      {needsSetup ? <p className="stub__muted">Finish controller setup below to unlock Ready.</p> : null}
      <p className="phone-ready__count" aria-live="polite">
        {readyCount}/{lobby.players.length} ready
      </p>
    </section>
  );
}
