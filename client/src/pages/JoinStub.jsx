/**
 * Placeholder phone join. Functional only: the phone display owner restyles
 * and owns this page. It covers Use Case 4 (scan, name, join) and Use Case 6
 * (leave), with every failure said in plain words.
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CODE_LENGTH,
  EVENTS,
  NAME_MAX,
  PHASES,
  PROTOCOL_VERSION,
  cleanName,
  isRoomCode,
  normalizeCode,
} from '@wee/shared/protocol.js';
import { PhoneReady } from '../components/PhoneReady.jsx';
import { StubBanner } from '../components/StubBanner.jsx';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from '../components/PrototypeFrame.jsx';

const NAME_KEY = 'wee:name';

/** Remembering the last name is a convenience; storage can be blocked, so it may fail. */
function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage; the name just isn't remembered.
  }
}

export default function JoinStub() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(() => normalizeCode(params.get('code')));
  const [name, setName] = useState(loadName);
  const { snapshot: seat, reconnecting, ended, storageWarning, accept, leave: leaveSession } = useReconnect('player', code);
  const lobby = seat;
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const canJoin = isRoomCode(code) && cleanName(name) !== '' && !joining;

  async function join(event) {
    event.preventDefault();
    if (!canJoin) return;
    setJoining(true);
    setError(null);
    const result = await request(EVENTS.PLAYER_JOIN, { v: PROTOCOL_VERSION, code, name });
    setJoining(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    saveName(cleanName(name));
    accept(result);
    setParams({ code }, { replace: true });
  }

  async function leave() {
    if (!(await leaveSession())) setError('disconnected');
  }

  if (seat?.phase === PHASES.TUTORIAL) return (
    <main className="tennis-session">
      <h1>{seat.name} · P{seat.slot + 1}</h1>
      {error ? <p className="alert" role="alert">{errorText(error)}</p> : null}
      {seat.slot === 0 ? <PrototypeFrame code={seat.code} controller paused={reconnecting || seat.paused} /> : (
        <p role="status">{reconnecting || seat.paused ? 'Waiting for everyone to reconnect.' :
          'Watch the TV. P1 controls the racket in this version; your lobby seat is saved.'}</p>
      )}
      <button type="button" className="btn btn--ghost" onClick={leave}>Leave game</button>
    </main>
  );

  if (reconnecting || lobby?.paused) return <ReconnectNotice lobby={lobby} reconnecting={reconnecting} />;

  if (seat) {
    const players = lobby?.players ?? [];
    const phase = lobby?.phase ?? PHASES.LOBBY;
    return (
      <main className="stub">
        <StubBanner>Phone screen</StubBanner>
        {storageWarning ? <p className="alert">Browser storage is unavailable. Keep this tab open to preserve your seat.</p> : null}
        {error ? <p className="alert" role="alert">{errorText(error)}</p> : null}
        <div className="you">
          <span
            className="seat__badge seat__badge--big"
            data-slot={seat.slot}
            style={{ '--player': `var(--p${seat.slot + 1})` }}
          >
            P{seat.slot + 1}
          </span>
          <div>
            <h1>You&rsquo;re in, {seat.name}</h1>
            <p className="stub__muted">
              {sportName(seat.sport)} · lobby {seat.code}
            </p>
          </div>
        </div>
        {phase === PHASES.LOBBY ? (
          <p className="stub__status">Waiting for the host to start…</p>
        ) : (
          <PhoneReady lobby={lobby} slot={seat.slot} />
        )}

        <h2>In this lobby</h2>
        <ul className="seats" aria-live="polite">
          {players.map((player) => (
            <li key={player.slot} className="seat">
              <span
                className="seat__badge"
                data-slot={player.slot}
                style={{ '--player': `var(--p${player.slot + 1})` }}
              >
                P{player.slot + 1}
              </span>
              {player.name}
              {player.slot === seat.slot ? ' (you)' : ''}
            </li>
          ))}
        </ul>

        <div className="stub__actions">
          <button type="button" className="btn btn--ghost" onClick={leave}>
            Leave game
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="stub">
      <StubBanner>Phone screen</StubBanner>
      <h1>Join a game</h1>
      {ended ? <p className="alert" role="alert">{ended === 'replaced'
        ? 'This controller is active in another tab. Continue there or reload this page.'
        : ended === 'expired' ? 'Your reconnect window expired. Join again if the lobby is still open.'
        : 'This game has ended. Check the TV for a new lobby.'}</p> : null}
      <p className="stub__muted">The code is on the TV, under the QR code.</p>

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      <form onSubmit={join} noValidate>
        <div className="field">
          <label htmlFor="join-code">Lobby code</label>
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
          />
        </div>
        <div className="field">
          <label htmlFor="join-name">Your name</label>
          <input
            id="join-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            enterKeyHint="go"
            // Arriving from the QR means the code is done; go straight to the name.
            autoFocus={isRoomCode(code)}
          />
        </div>
        <div className="stub__actions">
          <button type="submit" className="btn btn--primary" disabled={!canJoin}>
            {joining ? 'Joining…' : 'Join game'}
          </button>
          <Link className="btn btn--ghost" to="/">
            Home
          </Link>
        </div>
      </form>
    </main>
  );
}
