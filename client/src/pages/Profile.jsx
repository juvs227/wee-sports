import {useEffect, useRef, useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {claimGuestHistory, profileRequest} from '../lib/profile.js';
import {request, socket, useConnection} from '../lib/socket.js';
import {saveToken} from '../lib/reconnect.js';
import {createControllerCapabilities} from '../../../shared/controllerCapabilities.js';
import {displayRole} from '../lib/displayRole.js';
import './Profile.css';

const MESSAGES = {
  'not-signed-in': 'Sign in to view your profile.',
  'invalid-login': 'The username or password did not match.',
  'username-taken': 'That username is already taken.',
  'invalid-username': 'Use 3–32 letters, numbers, underscores, or hyphens for your username.',
  'password-length': 'Choose a password with 12–128 characters.',
  'revision-conflict': 'Your profile changed in another session. Reload before saving again.',
  'too-many-attempts': 'Too many attempts. Please try again in 15 minutes.',
  'wrong-origin': 'Open your profile on the same site as your game.',
  'profile-timeout': 'The profile request took too long. Check your connection and reload before trying again.',
  'recovery-in-use': 'This saved game is already opening in another lobby. Close that lobby first, or wait five minutes if setup was interrupted.',
  'recovery-already-continued': 'This saved game has already continued. Reload your profile to find the latest saved boundary.',
  'recovery-claim-mismatch': 'This recovery session expired or moved to another lobby. Reload your profile to continue from an available boundary.',
};
const message = error => MESSAGES[error.message] || 'Your profile could not be saved right now. Guest play is still available.';
const sportName = sport => ({tennis: 'Tennis', bowling: 'Bowling'})[sport] || sport;

export default function Profile() {
  const remote = displayRole(navigator) === 'remote';
  const navigate = useNavigate();
  const returnTo = useLocation().state?.returnTo;
  const returnToRoom = typeof returnTo === 'string' && /^(?:\/host\/[A-Z0-9]{4}|\/join\?code=[A-Z0-9]{4})$/.test(returnTo);
  const connection = useConnection();
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [recoverable, setRecoverable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({username: '', password: '', displayName: ''});
  const [editing, setEditing] = useState(null);
  const pageRequest = useRef(null);
  const accept = value => { setProfile(value); setEditing({...value, preferences: {...value.preferences}}); };
  async function loadHistory(signal) {
    await claimGuestHistory({signal});
    if (signal.aborted) return;
    const data = await profileRequest('/history', {signal});
    if (signal.aborted) return;
    setHistory(data.history);
    const recovery = await profileRequest('/recovery', {signal});
    if (!signal.aborted) setRecoverable(recovery.matches);
  }
  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current = controller;
    const {signal} = controller;
    profileRequest('', {signal}).then(async data => {
      if (signal.aborted) return;
      accept(data.profile);
      await loadHistory(signal);
    }).catch(reason => { if (!signal.aborted && reason.status !== 401) setError(message(reason)); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function authenticate(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const signal = pageRequest.current.signal;
    try {
      const data = await profileRequest(registering ? '/register' : '/login', {method: 'POST', signal,
        body: registering ? form : {username: form.username, password: form.password}});
      if (signal.aborted) return;
      accept(data.profile); setForm({...form, password: ''});
      socket.disconnect(); socket.connect();
      await loadHistory(signal);
    } catch (reason) { if (!signal.aborted) setError(message(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const signal = pageRequest.current.signal;
    try {
      const data = await profileRequest('', {method: 'PATCH', signal, body: {revision: profile.revision,
        displayName: editing.displayName, avatar: editing.avatar, preferences: editing.preferences}});
      if (signal.aborted) return;
      accept(data.profile); setNotice('Preferences saved.');
    } catch (reason) { if (!signal.aborted) setError(message(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    const signal = pageRequest.current.signal;
    try {
      await profileRequest('/logout', {method: 'POST', signal});
      if (signal.aborted) return;
      socket.disconnect(); socket.connect(); setProfile(null); setEditing(null); setHistory([]); setRecoverable([]); setNotice('Signed out. You can keep playing as a guest.');
    } catch (reason) { if (!signal.aborted) setError(message(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function restore(matchId) {
    if (remote) return;
    setBusy(true); setError(''); setNotice('');
    const signal = pageRequest.current.signal;
    try {
      const result = await request('host:restore', {matchId, capabilities: createControllerCapabilities()});
      if (!result?.ok) throw new Error(result?.error || 'recovery-unavailable');
      saveToken('host', result.code, result.token);
      if (!signal.aborted) navigate(`/host/${result.code}`);
    } catch (reason) { if (!signal.aborted) setError(reason.message === 'recovery-unavailable' ? 'This saved boundary cannot be restored. Start a new game to keep playing.' : message(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  const changePreference = (key, value) => setEditing(current => ({...current, preferences: {...current.preferences, [key]: value}}));
  const completed = history.filter(game => game.status === 'complete');
  const bowlingScores = completed.filter(game => game.sport === 'bowling').map(game => game.score);
  return <main className="profile-page page">
    <header className="profile-heading"><Link className="btn btn--ghost" to={returnToRoom ? returnTo : '/home'}>{returnToRoom ? 'Back to room' : remote ? 'Back to controller' : 'Back to games'}</Link><h1>Your profile</h1></header>
    <p>Keep your preferences and match history across your controllers. Playing as a guest always stays available.</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="profile-notice" role="status">{notice}</p>}
    {loading ? <p role="status">Loading profile…</p> : !profile ? <section className="profile-card">
      <h2>{registering ? 'Create a profile' : 'Sign in'}</h2>
      <form onSubmit={authenticate} className="profile-form">
        <label htmlFor="profile-username">Username</label><input id="profile-username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
        {registering && <><label htmlFor="profile-name">Display name</label><input id="profile-name" autoComplete="nickname" required maxLength={40} value={form.displayName} onChange={e => setForm({...form, displayName: e.target.value})} /></>}
        <label htmlFor="profile-password">Password</label><input id="profile-password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 12 : undefined} maxLength={128} value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
        {registering && <p className="profile-note">Use at least 12 characters and keep your password somewhere safe. Password recovery is not available yet.</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Working…' : registering ? 'Create profile' : 'Sign in'}</button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => {setRegistering(!registering); setError('');}}>{registering ? 'Already have a profile? Sign in' : 'Create a profile'}</button>
      </form>
    </section> : <>
      <section className="profile-card">
        <h2><span aria-hidden="true">{{ball: '🎾', pin: '🎳', racket: '🏓', star: '⭐'}[profile.avatar]}</span> {profile.displayName}</h2><p>Signed in as {profile.username}</p>
        <h3>Preferences</h3>
        <form onSubmit={save} className="profile-form">
          <label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" required maxLength={40} value={editing.displayName} onChange={e => setEditing({...editing, displayName: e.target.value})} />
          <label htmlFor="profile-avatar">Avatar</label><select id="profile-avatar" value={editing.avatar} onChange={e => setEditing({...editing, avatar: e.target.value})}><option value="ball">Ball</option><option value="pin">Bowling pin</option><option value="racket">Racket</option><option value="star">Star</option></select>
          <label htmlFor="profile-hand">Playing hand</label><select id="profile-hand" value={editing.preferences.hand} onChange={e => changePreference('hand', e.target.value)}><option>Right</option><option>Left</option></select>
          <label htmlFor="profile-sensitivity">Motion sensitivity: {editing.preferences.sensitivity.toFixed(1)}×</label><input id="profile-sensitivity" type="range" min="0.5" max="2" step="0.1" value={editing.preferences.sensitivity} onChange={e => changePreference('sensitivity', Number(e.target.value))} />
          <label htmlFor="profile-assistance">Assistance</label><select id="profile-assistance" value={editing.preferences.assistance} onChange={e => changePreference('assistance', e.target.value)}><option value="friendly">Friendly</option><option value="standard">Standard</option></select>
          {[['sound', 'Sound'], ['haptics', 'Haptic feedback when available'], ['reducedMotion', 'Reduce decorative motion'], ['touchControls', 'Prefer touch controls']].map(([key, label]) => <label key={key} className="profile-checkbox"><input type="checkbox" checked={editing.preferences[key]} onChange={e => changePreference(key, e.target.checked)} />{label}</label>)}
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button>
        </form>
      </section>
      {recoverable.length > 0 && <section className="profile-card">
        <h2>Continue a solo game</h2>
        <p>On your TV or laptop, continue a saved game. Scan the new code with a phone signed into this profile and tap Play. The interrupted roll or point starts again.</p>
        <ul className="profile-history">{recoverable.map(game => <li key={game.matchId}>
          <strong>{sportName(game.sport)}</strong><span>{game.playerName} · saved {new Date(game.savedAt).toLocaleString()}</span>
          {!remote && <button type="button" className="btn btn--primary" disabled={busy || connection !== 'online'} onClick={() => restore(game.matchId)}>{busy ? 'Opening…' : 'Continue on this screen'}</button>}
        </li>)}</ul>
      </section>}
      <section className="profile-card">
        <h2>Recent games</h2>
        {completed.length > 0 && <dl className="profile-stats">
          <div><dt>Completed</dt><dd>{completed.length}</dd></div>
          <div><dt>Best bowling score</dt><dd>{bowlingScores.length ? Math.max(...bowlingScores) : '—'}</dd></div>
        </dl>}
        {!history.length ? <p>No saved games yet. Finish a match while signed in to add a result.</p> : <ul className="profile-history">{history.map(game => <li key={game.matchId}>
          <strong>{sportName(game.sport)}</strong><span>{game.playerName}</span>
          <span>{game.status === 'complete' ? `${game.score} points · ${game.outcome}` : game.recoveryStatus === 'continued' ? 'Continued from this checkpoint' : game.recoveryStatus === 'reserved' ? 'Opening a recovery lobby' : 'In progress'}</span>
          <span className="profile-note">{game.saved ? game.status === 'complete' ? 'Result saved' : 'Last boundary saved' : 'Not saved'} · Casual game</span>
          <time dateTime={new Date(game.startedAt).toISOString()}>{new Date(game.startedAt).toLocaleDateString()}</time>
        </li>)}</ul>}
        <p className="profile-note">Statistics cover your 50 most recent games. Recovery restores the last saved point or settled roll. An unfinished action may need to be played again.</p>
      </section>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={logout}>Sign out</button>
    </>}
  </main>;
}
