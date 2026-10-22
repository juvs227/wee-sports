/**
 * Placeholder TV lobby. Functional only: the TV display owner restyles and
 * owns this page. It exists to prove the join works end to end — code, QR,
 * link, and seats that fill in live.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, MAX_PLAYERS, PHASES } from '@wee/shared/protocol.js';
import { QrCode } from '../components/QrCode.jsx';
import { StubBanner } from '../components/StubBanner.jsx';
import { TvCountdown } from '../components/TvCountdown.jsx';
import { TvReady } from '../components/TvReady.jsx';
import { TvTutorial } from '../components/TvTutorial.jsx';
import { errorText } from '../lib/errors.js';
import { canReachFromPhones, joinUrl } from '../lib/joinUrl.js';
import { cancelLeave, leaveSoon, request, socket } from '../lib/socket.js';
import { sportName } from '../lib/sports.js';

export default function HostStub() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState(null);
  const [closed, setClosed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    cancelLeave(EVENTS.HOST_CLOSE);
    let live = true;

    request(EVENTS.LOBBY_GET, { code }).then((result) => {
      if (!live) return;
      if (result.ok) setLobby(result);
      else setClosed(true);
    });

    const onUpdate = (next) => {
      if (next?.code === code) setLobby(next);
    };
    // The lobby belongs to this socket. If the socket drops, the server has
    // already closed the lobby and told the phones.
    const onDisconnect = () => setClosed(true);
    socket.on(EVENTS.LOBBY_UPDATE, onUpdate);
    socket.on('disconnect', onDisconnect);

    return () => {
      live = false;
      socket.off(EVENTS.LOBBY_UPDATE, onUpdate);
      socket.off('disconnect', onDisconnect);
      // Leaving the page takes the lobby with it, so phones aren't left
      // waiting on a screen that is gone.
      leaveSoon(EVENTS.HOST_CLOSE);
    };
  }, [code]);

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

  if (closed) {
    return (
      <main className="stub">
        <StubBanner>TV lobby</StubBanner>
        <h1>Lobby closed</h1>
        <p className="stub__muted">
          A lobby closes when its TV page reloads or leaves. Start a new one from the homepage.
        </p>
        <div className="stub__actions">
          <Link className="btn btn--primary" to="/">
            Back to sports
          </Link>
        </div>
      </main>
    );
  }

  if (!lobby) {
    return (
      <main className="stub">
        <p className="stub__muted">Opening lobby…</p>
      </main>
    );
  }

  if (lobby.phase === PHASES.COUNTDOWN) return <TvCountdown lobby={lobby} />;
  if (lobby.phase === PHASES.TUTORIAL) return <TvTutorial lobby={lobby} />;

  const url = joinUrl(code);
  const seats = Array.from(
    { length: MAX_PLAYERS },
    (_, slot) => lobby.players.find((player) => player.slot === slot) ?? null,
  );
  const canPlay = lobby.phase === PHASES.ALL_READY && !starting;

  return (
    <main className="stub">
      <StubBanner>TV lobby</StubBanner>
      <h1>{sportName(lobby.sport)} lobby</h1>
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
                {player ? player.name : 'Open seat'}
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
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
          Close lobby
        </button>
      </div>
    </main>
  );
}
