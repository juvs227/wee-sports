import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';
import { BallMark } from '../components/icons.jsx';
import { HowItWorks } from '../components/HowItWorks.jsx';
import { JoinBox } from '../components/JoinBox.jsx';
import { CreateTile, SportTile } from '../components/SportTile.jsx';
import { errorText } from '../lib/errors.js';
import { request, useConnection } from '../lib/socket.js';
import { saveToken } from '../lib/reconnect.js';
import { SPORTS } from '../lib/sports.js';
import './Home.css';

/**
 * The homepage, for the TV and for phones.
 *
 * On the TV, picking a sport opens a lobby (Use Case 1). On a phone, the same
 * page leads with the join box and notes that hosting happens on the laptop;
 * that difference is CSS, so the focus order matches the visual order on both.
 */
export default function Home() {
  const navigate = useNavigate();
  const connection = useConnection();
  const [opening, setOpening] = useState(null);
  /** { sport, message } for the last failed attempt to open a lobby. */
  const [failure, setFailure] = useState(null);

  async function host(sport) {
    if (opening) return;
    setOpening(sport.id);
    setFailure(null);
    const result = await request(EVENTS.HOST_CREATE, { v: PROTOCOL_VERSION, sport: sport.id });
    setOpening(null);
    if (result?.ok) {
      saveToken('host', result.code, result.token);
      navigate(`/host/${result.code}`);
      return;
    }
    setFailure({ sport: sport.id, message: errorText(result?.error) });
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
        <a className="topbar__link" href="#how">
          How it works
        </a>
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
              Calibrate, get ready, and swing together.
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
