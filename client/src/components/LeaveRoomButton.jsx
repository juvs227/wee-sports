import {useEffect, useId, useRef, useState} from 'react';

/** Explicit exit is different from closing/reloading the controller tab. */
export function LeaveRoomButton({onLeave, label = 'Go home'}) {
  const titleId = useId();
  const dialog = useRef(null);
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (confirming) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [confirming]);
  const cancel = () => {
    if (!pending.current) {
      setConfirming(false);
    }
  };

  async function confirm() {
    if (pending.current) {
      return;
    }

    pending.current = true;
    setLeaving(true);
    setError(null);

    try {
      if ((await onLeave()) === false) {
        setError('Could not leave the room. Please try again.');
        return;
      }
      setConfirming(false);
    } catch {
      setError('Could not leave the room. Please try again.');
    } finally {
      pending.current = false;
      setLeaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="phone-start-confirm"
        aria-labelledby={titleId}
        onCancel={event => {
          event.preventDefault();
          cancel();
        }}
      >
        <h2 id={titleId}>Are you sure you want to go home?</h2>
        <p>
          You will leave this room. If a game is running, it will end and the TV
          will return to the lobby.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="stub__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={leaving}
            onClick={cancel}
            autoFocus
          >
            Keep playing
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={leaving}
            onClick={() => void confirm()}
          >
            {leaving ? 'Leaving…' : 'Go home'}
          </button>
        </div>
      </dialog>
    </>
  );
}
