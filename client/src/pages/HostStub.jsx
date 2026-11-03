/**
 * Placeholder TV lobby. Functional only: the TV display owner restyles and
 * owns this page. It exists to prove the join works end to end — code, QR,
 * link, and seats that fill in live.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, PHASES, playerCapacity } from '@wee/shared/protocol.js';
import { QrCode } from '../components/QrCode.jsx';
import { TvCountdown } from '../components/TvCountdown.jsx';
import { TvReady } from '../components/TvReady.jsx';
import { TvTutorial } from '../components/TvTutorial.jsx';
import { errorText } from '../lib/errors.js';
import { usePhoneLink } from '../lib/usePhoneLink.js';
import { request } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';
import { enterFullscreen, exitFullscreen, fullscreenElement } from '../lib/fullscreen.js';
import '../styles/game-shell.css';

export default function HostStub() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { url, loading: phoneLinkLoading, status: phoneLinkStatus } = usePhoneLink(code);
  const { snapshot: lobby, reconnecting, ended, storageWarning, leave } = useReconnect('host', code);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  const [immersive, setImmersive] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const requestedFullscreen = useRef(false);

  function leaveGameView() {
    setImmersive(false);
    requestedFullscreen.current = false;
    void exitFullscreen(document);
  }

  function enterGameView() {
    setImmersive(true);
    requestedFullscreen.current = true;
    // Called directly by Play / Full screen, before a network await consumes the gesture.
    void enterFullscreen(document).then(entered => {
      if (entered && !requestedFullscreen.current) void exitFullscreen(document);
    });
  }

  const active = lobby?.phase === PHASES.COUNTDOWN || lobby?.phase === PHASES.TUTORIAL;
  useEffect(() => {
    const changed = () => {
      const entered = Boolean(fullscreenElement(document));
      setFullscreen(entered);
      // Escape should return to the windowed view without remounting the game.
      if (!entered && requestedFullscreen.current) {
        requestedFullscreen.current = false;
        setImmersive(false);
      }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
      if (requestedFullscreen.current) { requestedFullscreen.current = false; void exitFullscreen(document); }
    };
  }, []);
  useEffect(() => {
    if (active) setImmersive(true);
    else if (requestedFullscreen.current) {
      requestedFullscreen.current = false;
      void exitFullscreen(document);
    }
  }, [active]);

  // A failed Play (say, someone left first) is old news once the phase moves.
  const phase = lobby?.phase;
  useEffect(() => setStartError(null), [phase]);

  async function play() {
    setStarting(true);
    setStartError(null);
    enterGameView();
    const result = await request(EVENTS.HOST_START, {});
    setStarting(false);
    // On success the lobby update switches the screen to the countdown.
    if (!result.ok) { setStartError(result.error); leaveGameView(); }
  }

  if (ended || (!lobby && !reconnecting)) {
    return (
      <main className="stub host-lobby">
        <p className="eyebrow">TV lobby</p>
        <h1>Lobby closed</h1>
        <p className="stub__muted">
          {ended === 'replaced' ? 'This lobby was opened in another tab. Continue there or reload to take control.' : 'This game has ended or the reconnect window expired. Start a new lobby from the homepage.'}
        </p>
        <div className="stub__actions">
          <Link className="btn btn--primary" to="/">
            Back to sports
          </Link>
        </div>
      </main>
    );
  }

  // Keep the game mounted through a temporary drop, so its local state survives.
  if (lobby?.phase === PHASES.TUTORIAL) return <TvTutorial lobby={lobby}
    immersive={immersive} fullscreen={fullscreen} onToggleView={immersive ? leaveGameView : enterGameView}
    paused={reconnecting || lobby.paused} error={startError ? errorText(startError) : null} onClose={async () => {
      if (await leave()) navigate('/');
      else setStartError('disconnected');
    }} />;

  if (reconnecting || lobby?.paused) return <ReconnectNotice lobby={lobby} reconnecting={reconnecting} code={code} />;

  if (!lobby) {
    return (
      <main className="stub host-lobby">
        <p className="stub__muted">Opening lobby…</p>
      </main>
    );
  }

  if (lobby.phase === PHASES.COUNTDOWN) return <div className={`game-countdown${immersive ? ' game-countdown--immersive' : ''}`}>
    <button type="button" className="game-countdown__view" onClick={immersive ? leaveGameView : enterGameView}>
      {immersive ? fullscreen ? 'Exit full screen' : 'Windowed view' : 'Full screen'}
    </button>
    <TvCountdown lobby={lobby} />
  </div>;

  const capacity = playerCapacity(lobby.sport);
  const seats = Array.from(
    { length: capacity },
    (_, slot) => lobby.players.find((player) => player.slot === slot) ?? null,
  );
  const canPlay = lobby.phase === PHASES.ALL_READY && !starting;

  return (
    <main className="stub host-lobby">
      <p className="eyebrow">TV lobby</p>
      <h1>{sportName(lobby.sport)} lobby</h1>
      <p className="stub__muted">{lobby.sport === 'bowling' ? 'One to four players. Take turns rolling through ten frames, with your phone as the controller.' : 'One or two players. Bring a friend for head-to-head tennis, or play solo against the bot.'}</p>
      {storageWarning ? <p className="alert">Browser storage is unavailable. Keep this tab open to preserve your session.</p> : null}
      {url ? <>
        <p className="stub__muted">Scan with your phone camera to join and calibrate.</p>
        <div className="stub__row">
          <QrCode value={url} className="stub__qr" label={`Scan to join lobby ${code}`} />
          <div>
            <p className="stub__code" data-testid="lobby-code">{code}</p>
            <p className="stub__link">{url}</p>
          </div>
        </div>
      </> : <div className="stub__row">
        <div>
          <p className="stub__code" data-testid="lobby-code">{code}</p>
          <p className="stub__muted" role="status">{phoneLinkLoading || phoneLinkStatus === 'connecting' ? 'Preparing phone connection…' : phoneLinkStatus === 'reconnecting' ? 'Phone connection is reconnecting. Your QR code will return here automatically.' : 'Secure phone link is not running. Start a phone session on the laptop, then reload.'}</p>
          {!phoneLinkLoading && ['local', 'unavailable'].includes(phoneLinkStatus) ? <details><summary>Start a phone session</summary><p>On the laptop, run <code>npm run dev:phone</code> in the project, then reload this page.</p></details> : null}
        </div>
      </div>}

      {/* The ready check happens right here in the lobby, in place of the seat list. */}
      {lobby.phase === PHASES.LOBBY ? (
        <>
          <h2>
            Players {lobby.players.length}/{capacity}
          </h2>
          <ul className="seats" aria-live="polite">
            {seats.map((player, slot) => (
              <li key={slot} className="seat" data-empty={player === null}>
                <span
                  className="seat__badge"
                  data-slot={slot}
                  style={player ? { '--player': `var(--p${slot + 1})` } : undefined}
                >
                  P{slot + 1}
                </span>
                {player ? player.name : 'Join to play'}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <TvReady lobby={lobby} />
      )}

      {startError ? (
        <p className="alert" role="alert">
          {errorText(startError)}
        </p>
      ) : null}

      <div className="stub__actions">
        <button
          type="button"
          className="btn btn--primary btn--play"
          disabled={!canPlay}
          onClick={play}
        >
          {starting ? 'Starting…' : 'Play'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={async () => { if (await leave()) navigate('/'); else setStartError('disconnected'); }}>
          Close lobby
        </button>
      </div>
    </main>
  );
}
