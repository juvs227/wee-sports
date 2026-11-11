import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';
import { BallMark } from '../components/icons.jsx';
import { HowItWorks } from '../components/HowItWorks.jsx';
import { JoinBox } from '../components/JoinBox.jsx';
import { CreateTile, SportTile } from '../components/SportTile.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { errorText } from '../lib/errors.js';
import { request, useConnection } from '../lib/socket.js';
import { saveToken, lastHostRoom } from '../lib/reconnect.js';
import { SPORTS } from '../lib/sports.js';
import {createControllerCapabilities} from '../../../shared/controllerCapabilities.js';
import './Home.css';

/**
 * The desktop sport-card homepage.
 *
 * Picking a sport opens a room. Phones use the separate controller homepage.
 */
export default function Home() {
  const navigate = useNavigate();
  const connection = useConnection();
  const [opening, setOpening] = useState(null);
  const openingRef = useRef(false);
  const mounted = useRef(false);
  const lastRoom = lastHostRoom();
  useEffect(() => {
    mounted.current = true; document.title = 'Choose a sport · Wee Sports';
    return () => {mounted.current = false;};
  }, []);
  /** { sport, message } for the last failed attempt to open a lobby. */
  const [failure, setFailure] = useState(null);

  async function host(sport) {
    if (!sport.open || openingRef.current || connection !== 'online') return;
    openingRef.current = true;
    setOpening(sport.id);
    setFailure(null);
    const result = await request(EVENTS.HOST_CREATE, {v: PROTOCOL_VERSION, sport: sport.id, capabilities: createControllerCapabilities({buttons: true})});
    openingRef.current = false;
    if (mounted.current) setOpening(null);
    if (result?.ok) {
      saveToken('host', result.code, result.token);
      if (mounted.current) navigate(`/host/${result.code}`);
      return;
    }
    if (mounted.current) setFailure({ sport: sport.id, message: errorText(result?.error) });
  }

  function tileState(sport) {
    if (opening) return 'opening';
    if (connection !== 'online') return connection;
    return failure?.sport === sport.id ? 'retry' : 'idle';
  }

  return (
    <div className="home home--polished">
      <header className="topbar page">
        <a className="wordmark" href="/">
          <BallMark className="wordmark__mark" />
          <span>
            <span className="wordmark__wee">Wee</span> Sports
          </span>
        </a>
        <div className="topbar__actions">
          <a className="topbar__link" href="#how">How it works</a>
          <ThemeToggle />
        </div>
      </header>

      <main className="page">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow">Sports for your whole crew</p>
            <h1 id="hero-title" className="hero__title">
              Your phone is the remote.
            </h1>
            <p className="hero__lede">
              Pick a sport on the TV and join from your phone.
              Connect your controller, start the game, and swing together.
            </p>
          </div>
          <JoinBox />
        </section>

        <section className="sports" aria-labelledby="sports-title">
          <div className="section-head">
            <h2 id="sports-title">Pick a sport</h2>
            <p className="section-head__sub">Picking one opens a lobby with a QR code for everyone&rsquo;s phones.</p>
          </div>
          <p className="host-note">Hosting? Open this page on the laptop connected to your TV.</p>
          {lastRoom ? <p><a className="btn btn--ghost" href={`/host/${lastRoom}`}>Return to room {lastRoom}</a></p> : null}
          <div className="sport-grid">
            {SPORTS.map((sport) => (
              <SportTile
                key={sport.id}
                sport={sport}
                state={tileState(sport)}
                error={failure?.sport === sport.id ? failure.message : null}
                onPlay={() => host(sport)}
              />
            ))}
            <CreateTile />
          </div>
        </section>

        <HowItWorks />
      </main>

      <footer className="footer page">
        <span>Wee Sports · a team project</span>
        <a href="https://github.com/juvs227/wee-sports">Source on GitHub</a>
      </footer>
    </div>
  );
}
