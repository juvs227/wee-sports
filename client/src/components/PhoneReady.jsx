/** The controller gets ready automatically; the first phone starts the party. */
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
  const pending = useRef(false);
  const dialog = useRef(null);
  const [confirmation, setConfirmation] = useState(null);
  const confirmationKey = disabled ? null : startConfirmationKey(lobby);
  const current = useRef(null);
  const boundary = `${lobby.code}:${lobby.sport}:${lobby.gameId}:${lobby.phase}:${lobby.inputGeneration ?? 0}:${slot}`;
  if (current.current?.key !== boundary) current.current = {key: boundary};
  const counting = lobby.phase === PHASES.COUNTDOWN;
  const secondsLeft = useCountdown(counting ? lobby.countdown?.msLeft : null);
  const ownSeat = lobby.players.find(player => player.slot === slot);
  const ready = ownSeat?.ready === true;
  const needsSetup = isController(lobby.sport, slot) && !ownSeat?.setup;
  const leaderSlot = lobby.leaderSlot ?? 0;
  const leader = lobby.players.find(player => player.slot === leaderSlot);
  const isLeader = slot === leaderSlot;

  useEffect(() => {
    if (confirmation && confirmation === confirmationKey && isLeader) dialog.current?.showModal();
    else { dialog.current?.close(); setConfirmation(null); }
  }, [confirmation, confirmationKey, isLeader]);

  useEffect(() => {
    setError(null); setSending(false); pending.current = false;
  }, [boundary]);
  useEffect(() => {
    if (lobby.phase !== PHASES.READY || ready || needsSetup || disabled) return;
    let live = true;
    request(EVENTS.PLAYER_READY, {ready: true, skipTutorial: true}).then(result => {
      if (live && !result?.ok) setError(result?.error ?? 'disconnected');
    });
    return () => {live = false;};
  }, [lobby.code, lobby.sport, lobby.gameId, lobby.inputGeneration, lobby.phase, slot, ready, needsSetup, disabled, attempt]);

  async function start() {
    if (pending.current || disabled || !isLeader || !lobby.canStart || counting || !confirmation || confirmation !== confirmationKey) return;
    setConfirmation(null); dialog.current?.close();
    const scope = current.current;
    pending.current = true; setSending(true); setError(null);
    const result = await request(EVENTS.PLAYER_START, {});
    if (current.current !== scope) return;
    pending.current = false; setSending(false);
    if (!result?.ok) setError(result?.error ?? 'disconnected');
  }

  const count = lobby.players.length;
  return <section className="phone-ready">
    {counting ? <h2 className="phone-ready__title" role="timer">{secondsLeft > 0 ? `Starting in ${secondsLeft}…` : 'Go!'}</h2> : <>
      <p className="phone-ready__count" role="status">{lobby.resumeGame ? 'Choose Continue game or New game on the TV.' : needsSetup ? 'Getting your controller ready…'
        : !ready ? 'Connecting your controls…'
          : isLeader ? `${count} ${count === 1 ? 'player' : 'players'} connected. Start when everyone’s here.`
            : `You’re ready. ${leader?.name || 'The first player'} starts the game.`}</p>
      {isLeader && !lobby.resumeGame ? <button type="button" className="btn btn--primary phone-ready__btn"
        disabled={disabled || sending || !lobby.canStart} onClick={() => setConfirmation(confirmationKey)}>{sending ? 'Starting…' : 'Start game'}</button> : null}
    </>}
    {error ? <><p className="alert" role="alert">{errorText(error)}</p>
      <button type="button" className="btn btn--ghost" disabled={disabled || sending} onClick={() => {setError(null); if (ready && isLeader && lobby.canStart) setConfirmation(confirmationKey); else setAttempt(value => value + 1);}}>Try again</button></> : null}
    <dialog ref={dialog} className="phone-start-confirm" aria-labelledby="phone-start-title" onCancel={() => setConfirmation(null)}>
      <h2 id="phone-start-title">Start {sportName(lobby.sport)}?</h2>
      <p>{count === 1 ? 'Solo play' : `${count} players`} · Everyone ready?</p>
      <button type="button" className="btn btn--primary" disabled={sending || !confirmationKey} onClick={start}>Start now</button>
      <button type="button" className="btn btn--ghost" onClick={() => setConfirmation(null)} autoFocus>Keep waiting</button>
    </dialog>
  </section>;
}
