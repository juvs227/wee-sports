/**
 * Placeholder TV lobby. Functional only: the TV display owner restyles and
 * owns this page. It exists to prove the join works end to end — code, QR,
 * link, and seats that fill in live.
 *
 * Nobody touches the TV once the lobby is open. Phones press Ready; when all
 * four are ready the Play slot counts down by itself, then the tutorial vote
 * takes over, then the tutorial (if anyone voted Yes), then the game.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, PHASES } from '@wee/shared/protocol.js';
import { QrCode } from '../components/QrCode.jsx';
import { StubBanner } from '../components/StubBanner.jsx';
import { TvCountdown } from '../components/TvCountdown.jsx';
import { TvGame } from '../components/TvGame.jsx';
import { TvReady } from '../components/TvReady.jsx';
import { TvTutorial } from '../components/TvTutorial.jsx';
import { TvVote } from '../components/TvVote.jsx';
import { canReachFromPhones, joinUrl } from '../lib/joinUrl.js';
import { cancelLeave, leaveSoon, request, socket } from '../lib/socket.js';
import { sportName } from '../lib/sports.js';
import { useRevealHold } from '../lib/useRevealHold.js';

export default function HostStub() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState(null);
  const [closed, setClosed] = useState(false);
  const revealing = useRevealHold(lobby?.phase);

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

  // The vote, then its reveal for a few seconds, then the tutorial or game.
  if (lobby.phase === PHASES.VOTE || (revealing && lobby.vote)) {
    return <TvVote lobby={lobby} />;
  }
  if (lobby.phase === PHASES.TUTORIAL) return <TvTutorial lobby={lobby} />;
  if (lobby.phase === PHASES.GAME) return <TvGame lobby={lobby} />;

  const url = joinUrl(code);

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

      <TvReady lobby={lobby} />

      <div className="stub__actions">
        <TvCountdown lobby={lobby} />
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
          Close lobby
        </button>
      </div>
    </main>
  );
}
