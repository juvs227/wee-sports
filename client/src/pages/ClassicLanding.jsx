import {Link} from 'react-router-dom';
import {HowItWorks} from '../components/HowItWorks.jsx';
import {JoinBox} from '../components/JoinBox.jsx';
import {SwingIcon} from '../components/icons.jsx';
import {SPORTS, playerRange} from '../lib/sports.js';
import './ClassicLanding.css';

const PLAYABLE = SPORTS.filter(sport => sport.open);

/** A decorative preview: choosing a sport and creating a room happen on /home. */
function PlayScene() {
  return <div className="classic-scene" aria-hidden="true">
    <div className="classic-scene__halo" />
    <div className="classic-scene__screen">
      <div className="classic-scene__screen-bar"><span>wee.</span><span>Let’s play</span><span className="classic-scene__dots">● ● ●</span></div>
      <div className="classic-scene__games">
        {PLAYABLE.map(({id, name, Icon}) => <div className={`classic-scene__game classic-scene__game--${id}`} key={id}>
          <Icon /><span>{name}</span>
        </div>)}
      </div>
      <div className="classic-scene__screen-footer"><span className="classic-scene__player-dot" />Your crew. Your game.</div>
    </div>
    <div className="classic-scene__stand" />
    <div className="classic-scene__phone">
      <span className="classic-scene__phone-speaker" />
      <span className="classic-scene__phone-player">PLAYER 1</span>
      <SwingIcon />
      <strong>Your move!</strong>
      <span className="classic-scene__phone-button">Swing to play</span>
      <span className="classic-scene__phone-home" />
    </div>
    <span className="classic-scene__connection">Phone → big screen</span>
  </div>;
}

export default function ClassicLanding({lastRoom}) {
  return <main className="page classic-landing">
    <section className="classic-welcome" aria-labelledby="classic-welcome-title">
      <div className="classic-welcome__copy">
        <p className="eyebrow">A game night for everyone</p>
        <h1 id="classic-welcome-title">Game night,<br /><span>made simple.</span></h1>
        <p className="classic-welcome__lede">The big screen is your playground. Your phone is the controller. Bring your crew and let the friendly competition begin.</p>
        <div className="classic-welcome__actions">
          <Link className="btn btn--primary classic-welcome__play" to="/home?view=classic">Play<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></Link>
          <a className="classic-welcome__join" href="#join-game">Have a room code?</a>
        </div>
        <p className="classic-welcome__note">No account needed · Join with your phone’s camera</p>
        {lastRoom && <Link className="classic-welcome__resume" to={`/host/${lastRoom}`}>Return to room {lastRoom} <span aria-hidden="true">↗</span></Link>}
      </div>
      <PlayScene />
    </section>

    <section className="classic-sports-preview" aria-label="Available sports">
      <p>A little rivalry.<br /><strong>A whole lot of fun.</strong></p>
      <div className="classic-sports-preview__games">
        {PLAYABLE.map(({id, name, Icon, players}) => <div className="classic-sports-preview__game" key={id}>
          <Icon /><div><strong>{name}</strong><span>{playerRange(players)}</span></div>
        </div>)}
      </div>
      <span className="classic-sports-preview__hint">Play solo or together</span>
    </section>

    <HowItWorks />

    <section id="join-game" className="classic-join" aria-labelledby="classic-join-title">
      <div><p className="eyebrow">The more, the merrier</p><h2 id="classic-join-title">Already have a game going?</h2><p>Scan the QR code on your TV, or enter the room code to jump in with your friends.</p></div>
      <JoinBox title="Join your crew" description="Enter the four-character code shown on the TV." />
    </section>
  </main>;
}
