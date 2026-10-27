import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CODE_LENGTH, isRoomCode, normalizeCode } from '@wee/shared/protocol.js';

/**
 * The fallback to scanning: type the code from the TV (Use Case 4, 1.1).
 * Input is normalized as you type, so lowercase works and characters a code
 * can never contain simply don't appear.
 */
export function JoinBox() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const ready = isRoomCode(code);

  return (
    <section className="join-card" aria-labelledby="join-title">
      <h2 id="join-title" className="join-card__title">
        Joining from your phone?
      </h2>
      <p className="join-card__sub">Scan the QR code on the TV, or type the code here.</p>
      <form
        className="join-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) navigate(`/join?code=${code}`);
        }}
      >
        <label className="visually-hidden" htmlFor="join-code">
          Lobby code
        </label>
        <input
          id="join-code"
          className="code-input"
          value={code}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          placeholder="K7PM"
          maxLength={CODE_LENGTH}
          size={CODE_LENGTH}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        <button type="submit" className="btn btn--primary" disabled={!ready}>
          Join
        </button>
      </form>
      <p className="join-card__hint">{CODE_LENGTH} characters, shown under the QR code.</p>
    </section>
  );
}
