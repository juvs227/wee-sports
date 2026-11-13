import { useEffect, useRef, useState } from 'react';
import { EVENTS, PHASES, isGameOptions } from '@wee/shared/protocol.js';
import { request } from '../lib/socket.js';
import { errorText } from '../lib/errors.js';
import { createInputId } from '../../../src/network/inputId.js';
import { sportName } from '../lib/sports.js';
import { ThemeToggle } from './ThemeToggle.jsx';
import {SelectedSportIcon} from './SelectedSportIcon.jsx';
import {SportSwitcher} from './SportSwitcher.jsx';

/** Shared match changes belong to the first joined phone; appearance remains local to each phone. */
export function PhoneGameOptions({ lobby, slot, disabled }) {
  const dialog = useRef(null);
  const pending = useRef(false);
  const currentGame = useRef(lobby.gameId);
  currentGame.current = lobby.gameId;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [resultMode, setResultMode] = useState(false);
  const resultShown = useRef(null);
  const [stroke, setStroke] = useState('alternate');
  const [hand, setHand] = useState('Right');
  const isLeader = slot === (lobby.leaderSlot ?? 0);
  const options = lobby.gameOptions;
  const available = options?.gameId === lobby.gameId && isGameOptions(options, lobby.sport);
  const playing = lobby.phase === PHASES.GAME;
  const tennis = lobby.sport === 'tennis';
  const settings = options?.settings;
  const completed = playing && lobby.gameState?.phase === 'complete';
  const winners = completed ? tennis ? [lobby.gameState.winner] : lobby.gameState.winners ?? [] : [];
  const winnerNames = winners.map(player => lobby.players?.find(seat => seat.slot + 1 === player)?.name ??
    ((tennis) && player === 2 ? 'Bot' : `Player ${player}`));
  const resultTitle = winnerNames.length > 1 ? 'A shared victory!' : winnerNames.length ? `${winnerNames[0]} wins!` : 'Game complete';
  const locked = disabled || lobby.paused || !playing || !available || !isLeader || busy;
  // P1 can end the match from the countdown, the tutorial vote and the tutorial too.
  const active = playing || [PHASES.COUNTDOWN, PHASES.VOTE, PHASES.TUTORIAL].includes(lobby.phase);
  const returnLocked = disabled || !active || !lobby.gameId || !isLeader || busy;
  const pauseLocked = disabled || !playing || !lobby.gameId || !isLeader || busy || (completed && !lobby.manuallyPaused);
  // Another controller or the TV may change pause after this action succeeds.
  // Keep errors, but only show a pause acknowledgement for its current state.
  const statusMessage = typeof message === 'string' ? message :
    message.manuallyPaused === Boolean(lobby.manuallyPaused) && message.paused === Boolean(lobby.paused) ? message.text : '';
  useEffect(() => {
    setMessage(''); setConfirmRestart(false); setConfirmReturn(false);
    setResultMode(false);
    dialog.current?.close();
  }, [lobby.gameId]);
  useEffect(() => {
    if (!completed) {
      resultShown.current = null;
      if (resultMode) { dialog.current?.close(); setResultMode(false); }
      return;
    }
    // Polling/reconnect must not reopen a result the player already dismissed.
    if (disabled || lobby.paused || resultShown.current === lobby.gameId) return;
    resultShown.current = lobby.gameId;
    setMessage(''); setResultMode(true);
    dialog.current?.showModal();
  }, [completed, disabled, lobby.paused, lobby.gameId, resultMode]);
  async function command(action, detail = {}) {
    if (locked || pending.current) return;
    const gameId = lobby.gameId;
    pending.current = true; setBusy(true); setMessage('');
    const result = await request(EVENTS.PLAYER_GAME_COMMAND, { id: createInputId(), gameId, action, ...detail });
    pending.current = false; setBusy(false);
    if (currentGame.current !== gameId) return;
    setMessage(result?.ok ? action === 'new-match' ? 'New game ready. Watch the TV.' : 'Updated.' : errorText(result?.error));
    if (result?.ok) { setConfirmRestart(false); setConfirmReturn(false); }
  }
  async function returnToLobby() {
    if (returnLocked || pending.current) return;
    if (!confirmReturn) { setConfirmReturn(true); setMessage(''); return; }
    const gameId = lobby.gameId;
    pending.current = true; setBusy(true); setMessage('');
    const result = await request(EVENTS.PLAYER_RETURN_TO_LOBBY, { gameId });
    pending.current = false; setBusy(false);
    if (currentGame.current !== gameId) return;
    if (result?.ok) { setConfirmReturn(false); dialog.current?.close(); }
    else setMessage(errorText(result?.error));
  }
  async function togglePause() {
    if (pauseLocked || pending.current) return;
    const gameId = lobby.gameId;
    pending.current = true; setBusy(true); setMessage('');
    const result = await request(EVENTS.PLAYER_PAUSE, { gameId, paused: !lobby.manuallyPaused });
    pending.current = false; setBusy(false);
    if (currentGame.current !== gameId) return;
    setMessage(result?.ok ? { manuallyPaused: Boolean(result.manuallyPaused), paused: Boolean(result.paused),
      text: result.manuallyPaused ? 'Game paused.' : result.paused
        ? 'Still waiting for everyone to reconnect and finish setup.' : 'Game resumed.' } : errorText(result?.error));
  }
  const configure = (name, value) => command('configure', { settings: { [name]: value } });
  return <>
    <button type="button" className="phone-options-toggle" aria-label="Game options" aria-haspopup="dialog"
      onClick={() => { setMessage(''); setConfirmRestart(false); setConfirmReturn(false); setResultMode(completed); dialog.current?.showModal(); }}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" />
      </svg>
    </button>
    <dialog ref={dialog} className={`phone-game-options${resultMode ? ' phone-game-options--result' : ''}`} data-sport={lobby.sport} aria-labelledby="phone-game-options-title"
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="phone-game-options__content">
        <header><SelectedSportIcon sport={lobby.sport} className="phone-options-sport-icon" /><div><p className="eyebrow">{sportName(lobby.sport)} · {lobby.code}</p><h2 id="phone-game-options-title">{resultMode ? 'Match complete' : 'Game options'}</h2></div>
          <button className="phone-options-close" type="button" aria-label={resultMode ? 'Close result' : 'Close game options'} onClick={() => dialog.current?.close()}>×</button></header>
        {!resultMode ? <button type="button" className="btn btn--primary phone-options-done" onClick={() => dialog.current?.close()}>{playing ? 'Back to play' : 'Back to lobby'}</button> : null}
        {resultMode ? <div className="phone-match-result">
          <div className="phone-match-result__medal" aria-hidden="true"><svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7h18v12a9 9 0 0 1-18 0V7ZM15 10H8v5a8 8 0 0 0 8 8M33 10h7v5a8 8 0 0 1-8 8M24 28v10M16 41h16M19 38h10" /></svg></div>
          <h3>{resultTitle}</h3>
          {winnerNames.length > 1 ? <p>{winnerNames.join(' & ')}</p> : null}
          {!tennis && Number.isInteger(lobby.gameState?.winnerScore) ? <p className="phone-match-result__score">{lobby.gameState.winnerScore}<span>points</span></p> : null}
          <p>{isLeader ? 'Another round?' : 'The first player can start the next game.'}</p>
          {lobby.paused || disabled ? <p role="status">{lobby.manuallyPaused ? 'Resume the game to play again.' : 'Reconnect everyone to play again.'}</p> : null}
          {isLeader ? <button type="button" className="btn btn--primary" disabled={locked}
            onClick={() => command('new-match', tennis ? { format: 'full' } : {})}>{busy ? 'Starting…' : 'Play again'}</button> : null}
          <p className="phone-options-message" role="status">{statusMessage}</p>
          <button type="button" className="btn btn--ghost" onClick={() => dialog.current?.close()}>{isLeader ? 'Not now' : 'Keep watching'}</button>
        </div> : <>
        <div className="phone-game-options__appearance"><span>Light / dark mode</span><ThemeToggle /></div>
        {playing && (!completed || lobby.manuallyPaused) ? <div className="phone-options-pause">
          {isLeader ? <button type="button" className="btn btn--secondary" disabled={pauseLocked}
            onClick={togglePause}>{lobby.manuallyPaused ? 'Resume game' : 'Pause game'}</button> : null}
          {lobby.manuallyPaused ? <p role="status">Game paused. The first player or the TV can resume.</p> : null}
        </div> : null}
        {!playing ? <p className="stub__muted">Match options will be ready when play starts.</p>
          : !isLeader ? <p className="stub__muted">The first player manages shared match settings. Your sound button still controls the TV sound.</p>
          : !available ? <p role="status">Waiting for the TV’s game settings…</p> : <>
            {lobby.paused || disabled ? <p role="status">{lobby.manuallyPaused ? 'Resume play to change match settings.' : 'Settings resume when everyone is connected and ready.'}</p> : null}
            <fieldset disabled={locked}>
              {tennis ? <>
                <label>Playing assistance<select value={settings.assistance} onChange={event => configure('assistance', event.target.value)}>
                  <option value="standard">Standard</option><option value="beginner">Beginner · easier timing</option></select></label>
                {!options.humanOpponent ? <label>Opponent<select value={settings.botDifficulty} onChange={event => configure('botDifficulty', event.target.value)}>
                  <option value="standard">Challenge</option><option value="beginner">Rally</option></select></label> : null}
                <label className="phone-options-check"><input type="checkbox" checked={settings.timingAssist} onChange={event => configure('timingAssist', event.target.checked)} /> Timing assistance</label>
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
              </> : (<>
                <p className="stub__muted">Ten frames. Strike and spare bonuses update as your next rolls finish.</p>
                {lobby.players.length === 1 ? <button type="button" className="btn btn--secondary"
                  onClick={() => command(options.practice?.active ? 'practice-stop' : 'practice-start')}>
                  {options.practice?.active ? 'Start a new ten-frame game' : 'Practice rolls (resets score)'}</button> : null}
              </>)}
              <details className="phone-options-section"><summary>{tennis ? 'New match' : 'New bowling game'}</summary>
                {tennis ? <p>Follow the score on your TV. Choose the match format before starting.</p> : (null)}
                <p className="stub__muted">This resets the current score for everyone.</p>
                {confirmRestart ? <div className="phone-options-confirm"><button type="button" className="btn btn--primary" onClick={() => command('new-match', tennis ? { format: 'full' } : {})}>Reset score and start</button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmRestart(false)}>Cancel</button></div>
                  : <button type="button" className="btn btn--secondary" onClick={() => setConfirmRestart(true)}>{tennis ? 'Start new match' : 'Start new bowling game'}</button>}
              </details>
            </fieldset>
          </>}
        <p className="phone-options-message" role="status">{busy ? 'Updating the game…' : statusMessage}</p>
        </>}
        {completed && isLeader ? <SportSwitcher lobby={lobby} role="player" disabled={disabled || busy} /> : null}
        {resultMode && lobby.manuallyPaused && isLeader ? <button type="button" className="btn btn--secondary"
          disabled={pauseLocked} onClick={togglePause}>Resume game</button> : null}
        {isLeader && active ? <section className="phone-options-section phone-options-return" aria-label="Return to lobby">
          <button type="button" className="btn btn--secondary" disabled={returnLocked}
            aria-describedby={confirmReturn ? 'phone-return-explanation' : undefined} onClick={returnToLobby}>
            {confirmReturn ? busy ? 'Returning…' : 'Save and return' : 'Return to lobby'}
          </button>
          {confirmReturn ? <><p id="phone-return-explanation">Everyone returns together. Continue the unfinished match from the TV, or choose a new game.</p>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirmReturn(false)}>Keep playing</button></> : null}
        </section> : null}
      </div>
    </dialog>
  </>;
}
