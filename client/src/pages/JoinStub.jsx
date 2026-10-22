/**
 * Placeholder phone join. Functional only: the phone display owner restyles
 * and owns this page. It covers Use Case 4 (scan, name, join) and Use Case 6
 * (leave), with every failure said in plain words.
 */

import { useEffect, useRef, useState } from 'react';
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
import { PhoneVote } from '../components/PhoneVote.jsx';
import { StubBanner } from '../components/StubBanner.jsx';
import { errorText } from '../lib/errors.js';
import { cancelLeave, leaveSoon, request, socket } from '../lib/socket.js';
import { sportName } from '../lib/sports.js';

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
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => normalizeCode(params.get('code')));
  const [name, setName] = useState(loadName);
  const [seat, setSeat] = useState(null);
  // The latest lobby snapshot: players, phase, and the tutorial vote.
  const [lobby, setLobby] = useState(null);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const seated = useRef(false);

  useEffect(() => {
    cancelLeave(EVENTS.PLAYER_LEAVE);

    const onUpdate = (next) => setLobby(next ?? null);
    const lose = (reason) => () => {
      if (!seated.current) return;
      seated.current = false;
      setSeat(null);
      setLobby(null);
      setError(reason);
    };
    const onClosed = lose('closed');
    const onDisconnect = lose('disconnected');

    socket.on(EVENTS.LOBBY_UPDATE, onUpdate);
    socket.on(EVENTS.ROOM_CLOSED, onClosed);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(EVENTS.LOBBY_UPDATE, onUpdate);
      socket.off(EVENTS.ROOM_CLOSED, onClosed);
      socket.off('disconnect', onDisconnect);
      leaveSoon(EVENTS.PLAYER_LEAVE);
    };
  }, []);

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
    seated.current = true;
    saveName(cleanName(name));
    setSeat(result);
    // Taking the last seat can open the vote, so keep the whole snapshot.
    setLobby(result);
  }

  function leave() {
    socket.emit(EVENTS.PLAYER_LEAVE);
    seated.current = false;
    setSeat(null);
    setLobby(null);
  }

  if (seat) {
    const players = lobby?.players ?? [];
    const phase = lobby?.phase ?? PHASES.LOBBY;
    return (
      <main className="stub">
        <StubBanner>Phone screen</StubBanner>
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
          <PhoneVote lobby={lobby} slot={seat.slot} />
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
