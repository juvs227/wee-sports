/** Phone ready screen for controller setup, avatar selection, and game start. */
import { useEffect, useRef, useState } from 'react';
import { EVENTS, PHASES, isController } from '@wee/shared/protocol.js';
import { errorText } from '../lib/errors.js';
import { request } from '../lib/socket.js';
import { useCountdown } from '../lib/useCountdown.js';
import { startConfirmationKey } from '../../../shared/startConfirmation.js';
import { sportName } from '../lib/sports.js';

export function PhoneReady({ lobby, slot, disabled = false }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [color, setColor] = useState('#3b82f6');
  const pending = useRef(false);
  const dialog = useRef(null);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationKey = disabled ? null : startConfirmationKey(lobby);
  const current = useRef(null);
  const boundary = `${lobby.code}:${lobby.sport}:${lobby.gameId}:${lobby.phase}:${lobby.inputGeneration ?? 0}:${slot}`;
  if (current.current?.key !== boundary) current.current = { key: boundary };
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown?.msLeft : null);
  const ownSeat = lobby.players.find(player => player.slot === slot);
  const ready = ownSeat?.ready === true;
  const needsSetup = isController(lobby.sport, slot) && !ownSeat?.setup;
  const leaderSlot = lobby.leaderSlot ?? 0;
  const leader = lobby.players.find(player => player.slot === leaderSlot);
  const isLeader = slot === leaderSlot;
  const count = lobby.players.length;
  const readyCount = lobby.players.filter(player => player.ready).length;

  useEffect(() => {
    if (confirmation && confirmation === confirmationKey && isLeader) dialog.current?.showModal();
    else { dialog.current?.close(); setConfirmation(null); }
  }, [confirmation, confirmationKey, isLeader]);

  useEffect(() => {
    if (ownSeat?.color) setColor(ownSeat.color);
  }, [ownSeat?.color]);

  useEffect(() => {
    setError(null);
    setSending(false);
    pending.current = false;
  }, [boundary]);

  useEffect(() => {
    if (lobby.phase !== PHASES.READY || ready || needsSetup || disabled) return;
    let live = true;
    request(EVENTS.PLAYER_READY, { ready: true, skipTutorial: true }).then(result => {
      if (live && !result?.ok) setError(result?.error ?? 'disconnected');
    });
    return () => { live = false; };
  }, [lobby.code, lobby.sport, lobby.gameId, lobby.inputGeneration, lobby.phase, slot, ready, needsSetup, disabled, attempt]);

  async function start() {
    if (pending.current || disabled || !isLeader || !lobby.canStart || counting || !confirmation || confirmation !== confirmationKey) return;
    setConfirmation(null);
    dialog.current?.close();
    const scope = current.current;
    pending.current = true;
    setSending(true);
    setError(null);
    const result = await request(EVENTS.PLAYER_START, {});
    if (current.current !== scope) return;
    pending.current = false;
    setSending(false);
    if (!result?.ok) setError(result?.error ?? 'disconnected');
  }

  async function changeColor(event) {
    const nextColor = event.target.value;
    setColor(nextColor);
    const result = await request(EVENTS.PLAYER_COLOR_SET, { color: nextColor });
    if (!result?.ok) setError(result?.error ?? 'disconnected');
  }

  async function setAvatarReady(nextReady) {
    if (sending || disabled || needsSetup) return;
    setSending(true);
    setError(null);
    const result = await request(EVENTS.PLAYER_READY, { ready: nextReady });
    setSending(false);
    if (!result?.ok) setError(result?.error ?? 'disconnected');
  }

  return <section className="phone-ready">
    {lobby.sport === 'tennis' && ownSeat ? (
      <div className="seat" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
        <span className="seat__badge" data-slot={ownSeat.slot}>P{ownSeat.slot + 1}</span>
        <span>{ownSeat.name}</span>
      </div>
    ) : null}
    {lobby.phase === PHASES.AVATARS && lobby.sport === 'tennis' ? (
      <label style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        Avatar color
        <input type="color" value={color} onChange={changeColor} aria-label="Choose avatar color" disabled={disabled || sending} />
      </label>
    ) : null}
    {counting ? <h2 className="phone-ready__title" role="timer">{secondsLeft > 0 ? `Starting in ${secondsLeft}…` : 'Go!'}</h2> : null}
    {lobby.phase === PHASES.AVATARS ? (
      <>
        <p className="phone-ready__count" aria-live="polite">{readyCount}/{count} ready</p>
        <button type="button" className={`btn ${ready ? 'btn--ghost' : 'btn--primary'} phone-ready__btn`}
          aria-pressed={ready} disabled={sending || disabled || needsSetup} onClick={() => setAvatarReady(!ready)}>
          {ready ? 'Ready ✓ (tap to undo)' : 'Ready'}
        </button>
      </>
    ) : !counting ? <>
      <p className="phone-ready__count" role="status">{lobby.resumeGame ? 'Choose Continue game or New game on the TV.' : needsSetup ? 'Getting your controller ready…'
        : !ready ? 'Connecting your controls…'
          : isLeader ? `${count} ${count === 1 ? 'player' : 'players'} connected. Start when everyone’s here.`
            : `You’re ready. ${leader?.name || 'The first player'} starts the game.`}</p>
      {isLeader && !lobby.resumeGame ? <button type="button" className="btn btn--primary phone-ready__btn"
        disabled={disabled || sending || !lobby.canStart} onClick={() => setConfirmation(confirmationKey)}>{sending ? 'Starting…' : 'Start game'}</button> : null}
    </> : null}
    {needsSetup && lobby.phase === PHASES.AVATARS ? <p className="stub__muted">Finish controller setup below to unlock Ready.</p> : null}
    {error ? <><p className="alert" role="alert">{errorText(error)}</p>
      <button type="button" className="btn btn--ghost" disabled={disabled || sending} onClick={() => {
        setError(null);
        if (ready && isLeader && lobby.canStart) setConfirmation(confirmationKey);
        else setAttempt(value => value + 1);
      }}>Try again</button></> : null}
    <dialog ref={dialog} className="phone-start-confirm" aria-labelledby="phone-start-title" onCancel={() => setConfirmation(null)}>
      <h2 id="phone-start-title">Start {sportName(lobby.sport)}?</h2>
      <p>{count === 1 ? 'Solo play' : `${count} players`} · Everyone ready?</p>
      <button type="button" className="btn btn--primary" disabled={sending || !confirmationKey} onClick={start}>Start now</button>
      <button type="button" className="btn btn--ghost" onClick={() => setConfirmation(null)} autoFocus>Keep waiting</button>
    </dialog>
  </section>;
}
