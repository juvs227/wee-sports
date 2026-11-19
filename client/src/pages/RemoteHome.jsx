import {useEffect, useRef, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {JoinBox} from '../components/JoinBox.jsx';
import {ThemeToggle} from '../components/ThemeToggle.jsx';
import {RoomScanner} from '../components/RoomScanner.jsx';
import {SPORTS} from '../lib/sports.js';
import {clearToken, lastPlayerRoom} from '../lib/reconnect.js';
import './RemoteHome.css';

export default function RemoteHome() {
  const title = useRef(null);
  const {state} = useLocation();
  const [returnRoom, setReturnRoom] = useState(lastPlayerRoom);
  useEffect(() => {document.title = 'Your controller · Wee Sports'; title.current?.focus({preventScroll: true});}, []);
  return <main className="remote-home" data-display-role="remote">
    <header className="remote-header"><Link to="/" className="remote-wordmark">Wee Sports<span>Controller</span></Link><ThemeToggle /></header>
    <section className="remote-connect">
      <div className="remote-controller-mark" aria-hidden="true"><svg viewBox="0 0 80 100" fill="none"><rect x="19" y="7" width="42" height="86" rx="14" /><path d="M33 16h14M30 79h20M29 43h22m-11-11v22" /><circle cx="40" cy="66" r="3" /></svg></div>
      <h1 ref={title} tabIndex={-1}>Ready to play?</h1>
      {state?.controllerNotice ? <p className="remote-notice" role="status">{state.controllerNotice}</p> : null}
      <p>Connect to your TV.<br />Your phone does the rest.</p>
      {returnRoom ? <section className="remote-return" aria-label="Your last room">
        <Link className="btn btn--primary" to={`/join?code=${returnRoom}`}>Return to room {returnRoom}</Link>
        <p>Rejoin while the room is still open.</p>
        <button type="button" className="btn btn--ghost" onClick={() => {clearToken('player', returnRoom); setReturnRoom(null);}}>Forget room</button>
      </section> : null}
      <ul className="remote-sports" aria-label="Sports you can play">{SPORTS.filter(sport => sport.open).map(({id, name, Icon}) =>
        <li key={id}><Icon /><span>{name}</span></li>)}</ul>
      <RoomScanner className="remote-scan" />
      <details className="remote-manual"><summary>Enter a code instead</summary>
        <JoinBox title="TV code" description="Enter the four characters shown on your TV." />
      </details>
    </section>
    <footer className="remote-footer">
      <p>No account needed to play.</p></footer>
  </main>;
}
