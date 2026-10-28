import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EVENTS, PROTOCOL_VERSION } from '@wee/shared/protocol.js';
import { BallMark, ScanIcon, SwingIcon, TvIcon } from '../components/icons.jsx';
import { JoinBox } from '../components/JoinBox.jsx';
import { errorText } from '../lib/errors.js';
import { request, useConnection } from '../lib/socket.js';
import { saveToken } from '../lib/reconnect.js';
import { playerRange, SPORTS } from '../lib/sports.js';
import './Home.css';

const ACTION_LABEL = {
  retry: 'Try again',
  opening: 'Opening lobby…',
  connecting: 'Connecting…',
  offline: 'Server offline',
};

const STEPS = [
  { Icon: TvIcon, title: 'One big screen.', text: 'Open a sport on your laptop or TV. This is where the game lives.' },
  { Icon: ScanIcon, title: 'Everyone joins in.', text: 'Scan the lobby QR code with your phone. No controller or app to install.' },
  { Icon: SwingIcon, title: 'Put your swing into it.', text: 'Calibrate your phone, get ready, and play with your own motion.' },
];

/** Decorative court and lane art; the sport's name and player count are text. */
function SportArt({ sport }) {
  return (
    <svg className="club-sport__drawing" viewBox="0 0 320 250" fill="none" aria-hidden="true">
      {sport === 'tennis' ? (
        <>
          <path d="M-16 57h352M-16 193h352M55 0v250M265 0v250M55 125h210M160 57v136" stroke="currentColor" strokeWidth="2" opacity=".3" />
          <g transform="rotate(28 178 114)">
            <ellipse cx="178" cy="87" rx="48" ry="60" fill="#e4eacb" stroke="#faf8ef" strokeWidth="9" />
            <path d="M139 62h78M133 78h90M131 94h94M138 110h80M147 126h62M154 37v100M170 30v114M186 30v114M202 37v100" stroke="#245344" strokeWidth="1.5" opacity=".5" />
            <path d="m161 145 17 26 17-26" stroke="#faf8ef" strokeWidth="8" strokeLinejoin="round" />
            <path d="M178 172v52" stroke="#f5a568" strokeWidth="16" strokeLinecap="round" />
            <path d="m170 183 16 7m-16 5 16 7m-16 5 16 7" stroke="#153b30" strokeWidth="2" />
          </g>
          <circle cx="86" cy="174" r="28" fill="#d7f36b" />
          <path d="M66 155c22 12 22 26 1 38M106 155c-22 12-22 26-1 38" stroke="#fbfce9" strokeWidth="3" />
          <path d="m29 210 19-9m-9 27 20-14" stroke="#d7f36b" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M20 250 130 0m40 250L190 0m130 250L250 0" stroke="currentColor" strokeWidth="2" opacity=".22" />
          <g transform="translate(4 -2) rotate(12 210 100)">
            <path d="M210 27c-10 0-13 9-13 17 0 10 5 14 4 24-1 14-21 30-21 61 0 23 8 38 11 48h38c3-10 11-25 11-48 0-31-20-47-21-61-1-10 4-14 4-24 0-8-3-17-13-17Z" fill="#fbf8ec" />
            <path d="M201 70h18m-21 9h24" stroke="#b34927" strokeWidth="7" />
          </g>
          <path d="M70 238c-16-41 8-61 48-79" stroke="#fbf8ec" strokeWidth="3" strokeDasharray="5 8" strokeLinecap="round" />
          <circle cx="124" cy="159" r="49" fill="#244d40" />
          <path d="M89 143a38 38 0 0 1 35-22" stroke="#84a78a" strokeWidth="4" strokeLinecap="round" />
          <circle cx="133" cy="138" r="6" fill="#102b24" /><circle cx="148" cy="149" r="6" fill="#102b24" /><circle cx="128" cy="159" r="7" fill="#102b24" />
          <path d="m263 73 14-12m-7 29 19-3" stroke="#fbf8ec" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function HomeSport({ sport, index, state, error, onPlay }) {
  const label = ACTION_LABEL[state] ?? `Host ${sport.name.toLowerCase()}`;
  const errorId = `home-${sport.id}-error`;
  return (
    <article className={`club-sport club-sport--${sport.id}`}>
      <div className="club-sport__art">
        <span className="club-sport__number" aria-hidden="true">0{index + 1}</span>
        <SportArt sport={sport.id} />
      </div>
      <div className="club-sport__body">
        <p className="club-sport__players">{playerRange(sport.players)} <span aria-hidden="true">/</span> Phone motion</p>
        <h3>{sport.name}</h3>
        <p className="club-sport__description">{sport.blurb}</p>
        <button className="club-button club-sport__action" type="button" onClick={onPlay}
          disabled={state !== 'idle' && state !== 'retry'}
          aria-label={state === 'idle' ? label : `${label}: ${sport.name}`}
          aria-describedby={error ? errorId : undefined}>
          {label}<span aria-hidden="true">↗</span>
        </button>
        {error ? <p className="club-sport__error" id={errorId} role="alert">{error}</p> : null}
      </div>
    </article>
  );
}

/** Homepage presentation stays separate from the shared lobby and controller UI. */
export default function Home() {
  const navigate = useNavigate();
  const connection = useConnection();
  const [opening, setOpening] = useState(null);
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
    <div className="home wee-home">
      <header className="club-header club-page">
        <a className="club-wordmark" href="/" aria-label="Wee Sports home">
          <BallMark /><span>wee<span className="club-wordmark__sports">sports</span><span className="club-wordmark__period">.</span></span>
        </a>
        <nav className="club-nav" aria-label="Homepage"><a href="#games">The games</a><a href="#how">How we play</a></nav>
      </header>

      <main className="club-page">
        <section className="club-hero" aria-labelledby="hero-title">
          <div className="club-hero__copy">
            <p className="club-eyebrow"><span aria-hidden="true" />The living room sports club</p>
            <h1 id="hero-title">Make room<br />for <em>play.</em></h1>
            <p className="club-hero__lede">Your people. One screen. A little friendly competition. Turn your phone into a motion controller and put your own swing into the game.</p>
            <a className="club-button club-hero__action" href="#games">Find your game <span aria-hidden="true">↓</span></a>
            <p className="club-hero__footnote">Made for playing together, wherever you gather.</p>
          </div>
          <div className="club-join" id="join">
            <div className="club-join__banner">
              <div><p className="club-eyebrow">Small screen. Big energy.</p><p className="club-join__headline">Bring your phone.<br />Bring your game.</p></div>
              <svg className="club-join__phone" viewBox="0 0 120 130" fill="none" aria-hidden="true">
                <path d="M8 94C-2 46 31 16 72 18M10 114C47 133 101 109 110 77" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
                <g transform="rotate(16 64 64)">
                  <rect x="38" y="13" width="53" height="98" rx="12" fill="#faf8ef" stroke="#1d4839" strokeWidth="3" />
                  <rect x="45" y="29" width="39" height="58" rx="5" fill="#1d4839" />
                  <path d="m54 59 8 8 14-19" stroke="#d7f36b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M58 21h14M61 100h7" stroke="#1d4839" strokeWidth="3" strokeLinecap="round" />
                </g>
                <path d="m17 24 4-10m-15 15-9-1m106 78 8 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <JoinBox />
          </div>
        </section>

        <section className="club-games" id="games" aria-labelledby="sports-title">
          <div className="club-section-head">
            <div><p className="club-eyebrow">The lineup</p><h2 id="sports-title">A good game starts here.</h2></div>
            <p>Hosting? Choose a sport on your big screen.<br />Your friends join from their phones.</p>
          </div>
          <div className="club-sports">
            {SPORTS.filter(sport => sport.open).map((sport, index) => (
              <HomeSport key={sport.id} sport={sport} index={index} state={tileState(sport)} error={failure?.sport === sport.id ? failure.message : null} onPlay={() => host(sport)} />
            ))}
          </div>
          <div className="club-next">
            <span className="club-next__label">More room to play</span>
            <p>{SPORTS.filter(sport => !sport.open).map(sport => sport.name).join(', ')} <span>· Coming soon</span></p>
            <span className="club-next__note">Our team is still building. See you on the green.</span>
          </div>
        </section>

        <section className="club-how" id="how" aria-labelledby="how-title">
          <div className="club-section-head"><div><p className="club-eyebrow">From the couch to the court</p><h2 id="how-title">Less setup. More play.</h2></div></div>
          <ol className="club-steps">
            {STEPS.map(({ Icon, title, text }, index) => (
              <li className="club-step" key={title}>
                <div className="club-step__top"><Icon /><span>0{index + 1}</span></div>
                <h3>{title}</h3><p>{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="club-footer club-page">
        <span>Wee Sports <span aria-hidden="true">/</span> Built by our team. Played by yours.</span>
        <a href="https://github.com/juvs227/wee-sports">Meet the project <span aria-hidden="true">↗</span></a>
      </footer>
    </div>
  );
}
