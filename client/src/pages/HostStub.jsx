/**
 * Placeholder TV lobby. Functional only: the TV display owner restyles and
 * owns this page. It exists to prove the join works end to end — code, QR,
 * link, and seats that fill in live.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, MAX_PLAYERS, PHASES, isController } from '@wee/shared/protocol.js';
import { QrCode } from '../components/QrCode.jsx';
import { TvCountdown } from '../components/TvCountdown.jsx';
import { TvReady } from '../components/TvReady.jsx';
import { TvTutorial } from '../components/TvTutorial.jsx';
import { errorText } from '../lib/errors.js';
import { canReachFromPhones, joinUrl } from '../lib/joinUrl.js';
import { request } from '../lib/socket.js';
import { useReconnect } from '../lib/useReconnect.js';
import { ReconnectNotice } from '../components/ReconnectNotice.jsx';
import { sportName } from '../lib/sports.js';

export default function HostStub() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { snapshot: lobby, reconnecting, ended, storageWarning, leave } = useReconnect('host', code);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  // A failed Play (say, someone left first) is old news once the phase moves.
  const phase = lobby?.phase;
  useEffect(() => setStartError(null), [phase]);

  async function play() {
    setStarting(true);
    setStartError(null);
    const result = await request(EVENTS.HOST_START, {});
    setStarting(false);
    // On success the lobby update switches the screen to the countdown.
    if (!result.ok) setStartError(result.error);
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

  if (lobby.phase === PHASES.COUNTDOWN) return <TvCountdown lobby={lobby} />;

  const url = joinUrl(code);
  const seats = Array.from(
    { length: MAX_PLAYERS },
    (_, slot) => lobby.players.find((player) => player.slot === slot) ?? null,
  );
  const canPlay = lobby.phase === PHASES.ALL_READY && !starting;

  return (
    <main className="stub host-lobby">
      <p className="eyebrow">TV lobby</p>
      <h1>{sportName(lobby.sport)} lobby</h1>
      <p className="stub__muted">{lobby.sport === 'bowling' ? 'One to four players. Take turns rolling through ten frames, with your phone as the controller.' : 'Bring a friend: the first two phones control P1 and P2. One phone plays against the bot. Two extra seats are available for spectators.'}</p>
      {storageWarning ? <p className="alert">Browser storage is unavailable. Keep this tab open to preserve your session.</p> : null}
      <p className="stub__muted">Scan with your phone camera, or open the link and type the code.</p>

      <div className="stub__row">
        <QrCode value={url} className="stub__qr" label={`Scan to join lobby ${code}`} />
        <div>
          <p className="stub__code" data-testid="lobby-code">
            {code}
          </p>
          <p className="stub__link">{url}</p>
        </div>
      </div>

      {canReachFromPhones() ? null : (
        <p className="stub__warn" role="alert">
          This page is on localhost and no Wi-Fi address was found, so phones can&rsquo;t open the
          QR link. Connect to Wi-Fi and reload.
        </p>
      )}

      {!url.startsWith('https:') ? <p className="stub__warn">This Wi-Fi link supports button controls. Phone motion and calibration need HTTPS. Open the app through your HTTPS tunnel, then scan its QR code.</p> : null}

      {/* The ready check happens right here in the lobby, in place of the seat list. */}
      {lobby.phase === PHASES.LOBBY ? (
        <>
          <h2>
            Players {lobby.players.length}/{MAX_PLAYERS}
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
                {player ? player.name : isController(lobby.sport, slot) ? 'Join to play' : 'Join to watch'}
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
