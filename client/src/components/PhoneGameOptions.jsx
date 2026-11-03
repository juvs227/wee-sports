import { useEffect, useRef, useState } from 'react';
import { EVENTS, PHASES, isGameOptions } from '@wee/shared/protocol.js';
import { request } from '../lib/socket.js';
import { errorText } from '../lib/errors.js';
import { createInputId } from '../../../src/network/inputId.js';
import { ThemeToggle } from './ThemeToggle.jsx';

/** Shared match changes belong to P1; appearance remains local to each phone. */
export function PhoneGameOptions({ lobby, slot, disabled }) {
  const dialog = useRef(null);
  const pending = useRef(false);
  const currentGame = useRef(lobby.gameId);
  currentGame.current = lobby.gameId;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [format, setFormat] = useState('full');
  const [stroke, setStroke] = useState('alternate');
  const [hand, setHand] = useState('Right');
  const options = lobby.gameOptions;
  const available = options?.gameId === lobby.gameId && isGameOptions(options, lobby.sport);
  const playing = lobby.phase === PHASES.TUTORIAL;
  const tennis = lobby.sport === 'tennis';
  const settings = options?.settings;
  const locked = disabled || lobby.paused || !playing || !available || slot !== 0 || busy;
  useEffect(() => {
    setMessage(''); setConfirmRestart(false);
    dialog.current?.close();
  }, [lobby.gameId]);
  useEffect(() => { if (settings?.format) setFormat(settings.format); }, [settings?.format]);
  async function command(action, detail = {}) {
    if (locked || pending.current) return;
    const gameId = lobby.gameId;
    pending.current = true; setBusy(true); setMessage('');
    const result = await request(EVENTS.PLAYER_GAME_COMMAND, { id: createInputId(), gameId, action, ...detail });
    pending.current = false; setBusy(false);
    if (currentGame.current !== gameId) return;
    setMessage(result?.ok ? action === 'new-match' ? 'New game ready. Watch the TV.' : 'Updated.' : errorText(result?.error));
    if (result?.ok) setConfirmRestart(false);
  }
  const configure = (name, value) => command('configure', { settings: { [name]: value } });
  return <>
    <button type="button" className="phone-options-toggle" aria-label="Game options" aria-haspopup="dialog"
      onClick={() => { setMessage(''); setConfirmRestart(false); dialog.current?.showModal(); }}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" />
      </svg>
    </button>
    <dialog ref={dialog} className="phone-game-options" aria-labelledby="phone-game-options-title"
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="phone-game-options__content">
        <header><div><p className="eyebrow">{lobby.sport === 'bowling' ? 'Bowling' : 'Tennis'} · {lobby.code}</p><h2 id="phone-game-options-title">Game options</h2></div>
          <button className="phone-options-close" type="button" aria-label="Close game options" onClick={() => dialog.current?.close()}>×</button></header>
        <div className="phone-game-options__appearance"><span>Light / dark mode</span><ThemeToggle /></div>
        {!playing ? <p className="stub__muted">Match options will be ready when play starts.</p>
          : slot !== 0 ? <p className="stub__muted">Player 1 manages shared match settings. Your sound button still controls the TV sound.</p>
          : !available ? <p role="status">Waiting for the TV’s game settings…</p> : <>
            {lobby.paused || disabled ? <p role="status">Settings resume when everyone is connected and ready.</p> : null}
            <fieldset disabled={locked}>
              {tennis ? <>
                <label>Playing assistance<select value={settings.assistance} onChange={event => configure('assistance', event.target.value)}>
                  <option value="standard">Standard</option><option value="beginner">Beginner · easier timing</option></select></label>
                {!options.humanOpponent ? <label>Bot challenge<select value={settings.botDifficulty} onChange={event => configure('botDifficulty', event.target.value)}>
                  <option value="standard">Standard</option><option value="beginner">Beginner</option></select></label> : null}
                <label className="phone-options-check"><input type="checkbox" checked={settings.timingAssist} onChange={event => configure('timingAssist', event.target.checked)} /> Timing assistance</label>
                {!options.humanOpponent ? <label className="phone-options-check"><input type="checkbox" checked={settings.splitView} onChange={event => configure('splitView', event.target.checked)} /> Show both views in solo play</label> : null}
                <details className="phone-options-section"><summary>Movement</summary>
                  <label className="phone-options-check"><input type="checkbox" checked={settings.autoMove} onChange={event => configure('autoMove', event.target.checked)} /> Automatic movement</label>
                  <p className="stub__muted">Keep this on for phone play. Turning it off uses the TV keyboard for movement.</p>
                </details>
                {!options.humanOpponent ? <details className="phone-options-section"><summary>Practice returns</summary>
                  {options.practice.active ? <><p>Your match score is saved while you practise.</p><button type="button" className="btn btn--secondary" onClick={() => command('practice-stop')}>Return to match</button></>
                    : <><label>Feed<select value={stroke} onChange={event => setStroke(event.target.value)}><option value="alternate">Alternate strokes</option><option value="forehand">Forehands</option><option value="backhand">Backhands</option></select></label>
                      <label>Playing hand<select value={hand} onChange={event => setHand(event.target.value)}><option>Right</option><option>Left</option></select></label>
                      <button type="button" className="btn btn--secondary" onClick={() => command('practice-start', { stroke, hand })}>Start practice</button></>}
                </details> : null}
              </> : <p className="stub__muted">Ten frames. Strike and spare bonuses update as your next rolls finish.</p>}
              <details className="phone-options-section"><summary>{tennis ? 'New match' : 'New bowling game'}</summary>
                {tennis ? <label>Match length<select value={format} onChange={event => { setFormat(event.target.value); setConfirmRestart(false); }}><option value="full">Full · best of 3 sets</option><option value="quick">Quick · tie-break to 7</option></select></label> : null}
                <p className="stub__muted">This resets the current score for everyone.</p>
                {confirmRestart ? <div className="phone-options-confirm"><button type="button" className="btn btn--primary" onClick={() => command('new-match', tennis ? { format } : {})}>Reset score and start</button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmRestart(false)}>Cancel</button></div>
                  : <button type="button" className="btn btn--secondary" onClick={() => setConfirmRestart(true)}>{tennis ? 'Start new match' : 'Start new bowling game'}</button>}
              </details>
            </fieldset>
          </>}
        <p className="phone-options-message" role="status">{busy ? 'Updating the game…' : message}</p>
        <button type="button" className="btn btn--primary phone-options-done" onClick={() => dialog.current?.close()}>Back to play</button>
      </div>
    </dialog>
  </>;
}
