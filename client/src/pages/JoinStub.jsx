/**
 * Placeholder phone join. Functional only: the phone display owner restyles
 * and owns this page. It covers Use Case 4 (scan, name, join) and Use Case 6
 * (leave), with every failure said in plain words.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CODE_LENGTH,
  EVENTS,
  NAME_MAX,
  PHASES,
  PROTOCOL_VERSION,
  cleanName,
  isController,
  isRoomCode,
  normalizeCode,
} from '@wee/shared/protocol.js';
import { PhoneReady } from '../components/PhoneReady.jsx';
import { PhoneTutorial } from '../components/PhoneTutorial.jsx';
import { PhoneVote } from '../components/PhoneVote.jsx';
import { useRevealHold } from '../lib/useRevealHold.js';
import { errorText } from '../lib/errors.js';
import { request, socket } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';
import { PrototypeFrame } from '../components/PrototypeFrame.jsx';
import { usePhoneLink } from '../lib/usePhoneLink.js';
import { PhoneSoundToggle } from '../components/PhoneSoundToggle.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { PhoneGameOptions } from '../components/PhoneGameOptions.jsx';
import { PhoneCalibration } from '../components/PhoneCalibration.jsx';

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
  const { url: secureUrl, loading: phoneLinkLoading, status: phoneLinkStatus } = usePhoneLink(code);
  const needsSecurePage = window.location.protocol === 'http:';
  const openingSecurePage = needsSecurePage && (phoneLinkLoading || Boolean(secureUrl) || ['connecting', 'reconnecting'].includes(phoneLinkStatus));
  useEffect(() => {
    // React Router can arrive here without an HTTP request, so server redirects
    // alone cannot recover a phone that joined from an old LAN homepage.
    if (needsSecurePage && !phoneLinkLoading && secureUrl) window.location.replace(secureUrl);
  }, [needsSecurePage, phoneLinkLoading, secureUrl]);
  const { snapshot: seat, reconnecting, ended, storageWarning, accept, leave: leaveSession } = useReconnect('player', code);
  const lobby = seat;
  // Holds the vote's reveal on screen for a moment; a cancelled vote has none.
  const revealing = useRevealHold(lobby?.phase) && Boolean(lobby?.vote?.picks);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationState, setCalibrationState] = useState('settling');
  const [calibrationStarted, setCalibrationStarted] = useState(false);
  const lastProgressEmit = useRef(0);
  // Reset if calibration phase is re-entered (e.g. someone un-readied).
  useEffect(() => {
    if (lobby?.phase !== PHASES.CALIBRATION) {
      setCalibrationStarted(false);
      setCalibrationProgress(0);
      setCalibrationState('settling');
    }
  }, [lobby?.phase]);
  const canJoin = !openingSecurePage && isRoomCode(code) && cleanName(name) !== '' && !joining;

  const handleCalibrationProgress = useCallback((progress, state) => {
    setCalibrationProgress(progress);
    if (state) setCalibrationState(state);
    const now = Date.now();
    if (now - lastProgressEmit.current >= 100) {
      lastProgressEmit.current = now;
      socket.volatile.emit(EVENTS.PLAYER_CALIBRATION_PROGRESS, { progress, state });
    }
  }, []);
  const handleCalibrationDone = useCallback(() => {
    setCalibrationProgress(1);
  }, []);

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

  if (openingSecurePage) return <main className="stub"><p className="eyebrow">Wee Sports · phone controller</p><h1>Opening your controller…</h1><p className="stub__muted" role="status">Connecting your phone for motion play.</p></main>;

  if (seat) {
    const players = lobby?.players ?? [];
    const phase = lobby?.phase ?? PHASES.LOBBY;
    const playing = phase === PHASES.GAME && !revealing;
    const lobbyOptions = (
      <>
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
      </>
    );
    return (
      <main className={`stub phone-session${playing ? ' phone-session--playing' : ''}`}>
        {!playing ? <p className="eyebrow">Homepage lobby · {seat.code}</p> : null}
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
          <div className="phone-session__name">
            <h1>{playing ? seat.name : <>You&rsquo;re in, {seat.name}</>}</h1>
            <p className="stub__muted">
              {sportName(seat.sport)}{playing ? '' : ` · lobby ${seat.code}`}
            </p>
          </div>
          <PhoneSoundToggle lobby={lobby} disabled={reconnecting} />
          <PhoneGameOptions lobby={lobby} slot={seat.slot} disabled={reconnecting} />
        </div>
        {playing ? null : phase === PHASES.LOBBY ? (
          <p className="stub__status">Waiting for a player to join the P1 controller seat…</p>
        ) : phase === PHASES.CALIBRATION ? (
          isController(seat.sport, seat.slot) ? (
            calibrationStarted ? (
              <PhoneCalibration progress={calibrationProgress} calState={calibrationState} />
            ) : (
              <div className="phone-cal-prompt">
                <p className="phone-cal-prompt__title">Face the net</p>
                <p className="phone-cal-prompt__help">When ready, hold your phone with the screen pointing toward the net, then tap Calibrate.</p>
                <button type="button" className="btn btn--primary phone-cal-prompt__btn" onClick={() => setCalibrationStarted(true)}>
                  Calibrate
                </button>
              </div>
            )
          ) : (
            <p className="stub__status">Waiting for players to calibrate…</p>
          )
        ) : phase === PHASES.VOTE || revealing ? (
          // Keyed by game, so a fresh vote forgets this phone's last pick.
          <PhoneVote key={lobby.gameId} lobby={lobby} slot={seat.slot} />
        ) : phase === PHASES.TUTORIAL ? (
          <PhoneTutorial key={lobby.tutorial.step} lobby={lobby} slot={seat.slot} />
        ) : (
          <PhoneReady lobby={lobby} slot={seat.slot} disabled={reconnecting || lobby.paused} />
        )}

        {reconnecting || lobby.reconnecting?.length ? <ReconnectNotice lobby={lobby} reconnecting={reconnecting} /> : null}
        {isController(seat.sport, seat.slot) ? (
          <>
            <PrototypeFrame code={seat.code} controller player={seat.slot + 1} sport={seat.sport} gameId={seat.gameId} gameState={seat.gameState}
              playing={phase === PHASES.GAME}
              paused={(phase !== PHASES.GAME && !(phase === PHASES.CALIBRATION && calibrationStarted)) || reconnecting || seat.paused}
              manuallyPaused={Boolean(lobby.manuallyPaused && !reconnecting && !lobby.reconnecting?.length && !lobby.setupPending?.length)}
              showPause={reconnecting}
              phase={phase === PHASES.CALIBRATION && !calibrationStarted ? PHASES.READY : phase}
              onCalibrationProgress={handleCalibrationProgress}
              onCalibrationDone={handleCalibrationDone} />
          </>
        ) : null}
        {playing ? (
          <details className="phone-session__options">
            <summary>Lobby options <span>{seat.code}</span></summary>
            {lobbyOptions}
          </details>
        ) : lobbyOptions}
      </main>
    );
  }

  if (reconnecting) return <ReconnectNotice reconnecting />;

  return (
    <main className="stub">
      <div className="session-heading"><p className="eyebrow">Wee Sports · phone controller</p><ThemeToggle /></div>
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
