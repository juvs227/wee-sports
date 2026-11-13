import {Link} from 'react-router-dom';
import './ClassicLanding.css';

export default function ClassicLanding() {
  return <main className="page classic-landing">
    <section className="classic-welcome" aria-labelledby="classic-welcome-title">
      <h1 id="classic-welcome-title">Wee Sports.<br /><span>Game night, made simple.</span></h1>
      <p>Play together with your phones.</p>
      <Link className="btn btn--primary classic-welcome__play" to="/home?view=classic">Play
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
      </Link>
    </section>
  </main>;
}
