import {RoomScanner} from '../components/RoomScanner.jsx';
import {SelectedSportIcon} from '../components/SelectedSportIcon.jsx';
import {GuestResultClaim} from '../components/GuestResultClaim.jsx';
import {createControllerCapabilities} from '../../../shared/controllerCapabilities.js';
import {SportSwitcher} from '../components/SportSwitcher.jsx';
/** Browser phone entry, reconnecting seat and active controller shell. */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { request } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';
import { GameFrame } from '../components/GameFrame.jsx';
import { usePhoneLink } from '../lib/usePhoneLink.js';
import { PhoneSoundToggle } from '../components/PhoneSoundToggle.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { PhoneGameOptions } from '../components/PhoneGameOptions.jsx';
import {requestControllerIntent, rememberControllerIntent, rememberedControllerIntent} from '../lib/controllerStart.js';

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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const linkedCode = normalizeCode(params.get('code'));
  const [code, setCode] = useState(linkedCode);
  useEffect(() => {setCode(linkedCode);}, [linkedCode]);
  const [name, setName] = useState(loadName);
  const [controllerIntent, setControllerIntent] = useState(rememberedControllerIntent);
  const [prefersTouch, setPrefersTouch] = useState(false);
  const controllerMode = useCallback(mode => {
    const intent = {mode, permission: mode === 'motion' ? 'granted' : 'unavailable'};
    rememberControllerIntent(intent);
    setControllerIntent(previous => previous?.mode === mode ? previous : intent);
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/profile').then(response => response.ok ? response.json() : null).then(data => {
      if (active) setPrefersTouch(data?.profile?.preferences?.touchControls === true);
    }).catch(() => {});
    return () => {active = false;};
  }, []);
  const { url: secureUrl, loading: phoneLinkLoading, status: phoneLinkStatus } = usePhoneLink(code);
  const needsSecurePage = window.location.protocol === 'http:';
  const openingSecurePage = needsSecurePage && (phoneLinkLoading || Boolean(secureUrl) || ['connecting', 'reconnecting'].includes(phoneLinkStatus));
  useEffect(() => {
    // React Router can arrive here without an HTTP request, so server redirects
    // alone cannot recover a phone that joined from an old LAN homepage.
    if (needsSecurePage && !phoneLinkLoading && secureUrl) window.location.replace(secureUrl);
  }, [needsSecurePage, phoneLinkLoading, secureUrl]);
  const { snapshot: seat, reconnecting, ended, storageWarning, accept, beginJoin, leave: leaveSession } = useReconnect('player', code);
  useEffect(() => {
    if (ended === 'ended') navigate('/home', {replace: true, state: {controllerNotice: 'Room closed. Scan the TV to play again.'}});
  }, [ended, navigate]);
  const lobby = seat;
  // Holds the vote's reveal on screen for a moment; a cancelled vote has none.
  const revealing = useRevealHold(lobby?.phase) && Boolean(lobby?.vote?.picks);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);
  const canJoin = !openingSecurePage && isRoomCode(code) && Boolean(cleanName(name)) && !joining;

  async function join(event) {
    event.preventDefault();
    if (!canJoin) return;
    setJoining(true);
    setError(null);
    const joinOperation = beginJoin();
    // Start the browser permission prompt directly on this tap, before joining.
    const permission = controllerIntent?.mode === 'touch' || prefersTouch
      ? Promise.resolve({mode: 'touch', permission: 'unavailable'}) : requestControllerIntent();
    const playerName = cleanName(name);
    const [result, intent] = await Promise.all([
      request(EVENTS.PLAYER_JOIN, { v: PROTOCOL_VERSION, code, name: playerName, capabilities: createControllerCapabilities({motion: typeof DeviceMotionEvent !== "undefined", orientation: typeof DeviceOrientationEvent !== "undefined", haptics: typeof navigator.vibrate === "function"}) }),
      permission,
    ]);
    setJoining(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    saveName(playerName);
    rememberControllerIntent(intent); setControllerIntent(intent);
    if (!accept(result, joinOperation)) return;
    setParams({ code, ...(params.get('diagnostics') === '1' ? {diagnostics: '1'} : {}) }, { replace: true });
  }

  async function leave() {
    if (await leaveSession()) navigate('/home', {state: {controllerNotice: 'You left the room.'}});
  }

  if (openingSecurePage) return <main className="stub"><p className="eyebrow">Wee Sports · phone controller</p><h1>Opening your controller…</h1><p className="stub__muted" role="status">Connecting your phone for motion play.</p><Link className="btn btn--ghost" to="/home">Go home</Link></main>;

  if (seat) {
    const players = lobby?.players ?? [];
    const phase = lobby?.phase ?? PHASES.LOBBY;
    const playing = phase === PHASES.GAME && !revealing;
    const tvAway = lobby.reconnecting?.some(member => member.role === 'host' || (!member.role && member.name === 'TV'));
    const lobbyOptions = (
      <>
        <GuestResultClaim lobby={lobby} />
        <PhoneSoundToggle lobby={lobby} disabled={reconnecting} />
        {seat.slot === (lobby.leaderSlot ?? 0) && !lobby.resumeGame ? <details><summary>Change sport</summary><SportSwitcher lobby={lobby} role="player" disabled={reconnecting} /></details> : null}
        <a className="btn btn--ghost" href="/profile">Profile & history</a>
        <RoomScanner label="Scan another TV" activeRoom={seat} onLeave={leaveSession} disabled={reconnecting} />
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
            Leave lobby
          </button>
        </div>
      </>
    );
    return (
      <main className={`stub phone-session phone-session--simple${playing ? ' phone-session--playing' : ''}`}>
        <nav className="phone-session__navigation" aria-label="Controller navigation"><Link className="btn btn--ghost" to="/home">Go home</Link><span>Room {seat.code}</span></nav>
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
            <h1><SelectedSportIcon sport={seat.sport} />{sportName(seat.sport)}</h1>
            <p className="stub__muted">
              {seat.name} · {reconnecting ? 'Reconnecting' : tvAway ? 'Waiting for TV' : 'Connected'}
            </p>
          </div>
          <PhoneGameOptions lobby={lobby} slot={seat.slot} disabled={reconnecting} />
        </div>
        {playing || tvAway || reconnecting ? null : phase === PHASES.LOBBY ? (
          <p className="stub__status">Getting your lobby ready…</p>
        ) : phase === PHASES.VOTE || revealing ? (
          // Keyed by game, so a fresh vote forgets this phone's last pick.
          <PhoneVote key={lobby.gameId} lobby={lobby} slot={seat.slot} automatic />
        ) : phase === PHASES.TUTORIAL ? (
          <PhoneTutorial key={lobby.tutorial.step} lobby={lobby} slot={seat.slot} />
        ) : (
          <PhoneReady lobby={lobby} slot={seat.slot} disabled={reconnecting || lobby.paused} />
        )}

        {reconnecting || lobby.reconnecting?.length ? <ReconnectNotice lobby={lobby} reconnecting={reconnecting} compact /> : null}
        {isController(seat.sport, seat.slot) ? (
          <>
            <GameFrame code={seat.code} controller controllerIntent={controllerIntent} onControllerMode={controllerMode} player={seat.slot + 1} players={players} sport={seat.sport} gameId={seat.gameId} gameState={seat.gameState} generation={seat.inputGeneration} hostEpoch={seat.hostEpoch} matchRound={seat.matchRound}
              playing={phase === PHASES.GAME}
              paused={phase !== PHASES.GAME || reconnecting || seat.paused}
              manuallyPaused={Boolean(lobby.manuallyPaused && !reconnecting && !lobby.reconnecting?.length && !lobby.setupPending?.length)}
              showPause={reconnecting} />
          </>
        ) : null}
          <details className="phone-session__options">
            <summary>Tools <span>{seat.code}</span></summary>
            {lobbyOptions}
          </details>
      </main>
    );
  }

  if (reconnecting) return <ReconnectNotice reconnecting homeHref="/home" />;

  return (
    <main className="stub phone-join">
      <div className="session-heading"><p className="eyebrow">Wee Sports · phone controller</p><ThemeToggle /></div>
      <h1>Pick up.<br />Play.</h1>
      {ended ? <p className="alert" role="alert">{ended === 'replaced'
        ? 'This controller is active in another tab. Continue there or reload this page.'
        : ended === 'expired' ? 'Your reconnect window expired. Join again if the lobby is still open.'
        : ended === 'recovery-owner-required' ? 'Sign in to the profile that saved this game, then return here to reconnect.'
        : 'This game has ended. Check the TV for a new lobby.'}</p> : null}
      {ended === 'recovery-owner-required' ? <Link className="btn btn--primary" to="/profile" state={{returnTo: `/join?code=${code}`}}>Sign in</Link> : null}
      <p className="stub__muted">Your phone is the controller. Watch the TV and swing.</p>

      {error ? (
        <p className="alert" role="alert">
          {errorText(error)}
        </p>
      ) : null}

      {!isRoomCode(code) ? <RoomScanner /> : null}
      <form onSubmit={join} noValidate>
        {!isRoomCode(normalizeCode(params.get('code'))) ? <div className="field">
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
        </div> : <p className="phone-join__code">Game {code}</p>}
        <div className="field phone-join__name">
          <label htmlFor="join-name">Your playing name</label>
          <input
            id="join-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            enterKeyHint="go"
            placeholder="Your name"
            required
          />
        </div>
        <div className="stub__actions">
          <button type="submit" className="btn btn--primary" disabled={!canJoin}>
            {joining ? 'Connecting…' : 'Play'}
          </button>
          <Link className="btn btn--ghost" to="/home" onClick={() => {if (joining) void leaveSession();}}>
            Go home
          </Link>
        </div>
      </form>
      <p className="phone-join__hint">Allow motion if asked. Touch controls work too.</p>
    </main>
  );
}
