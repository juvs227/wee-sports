import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {CODE_LENGTH, isRoomCode, normalizeCode} from '@wee/shared/protocol.js';
import {scannedRoom, startRoomCamera} from '../lib/roomScan.js';
import {ScanIcon} from './icons.jsx';
import './RoomScanner.css';

/** One camera flow for the phone homepage, join screen and an existing seat. */
export function RoomScanner({label = 'Scan TV code', className = 'btn btn--secondary room-scan-button', activeRoom = null, onLeave, disabled = false}) {
  const navigate = useNavigate();
  const dialog = useRef(null), video = useRef(null), button = useRef(null), leaving = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Starting camera…');
  const close = () => {setScanning(false); dialog.current?.close();};
  function openTarget(value) {
    close();
    const url = new URL(value);
    if (url.origin === location.origin) navigate(url.pathname + url.search);
    else location.assign(value);
  }
  function found(value) {
    const next = scannedRoom(value, location.origin);
    if (!next) {setStatus('Use the Wee Sports QR code on your TV.'); return false;}
    const url = new URL(next);
    if (activeRoom) {
      if (url.origin === location.origin && url.searchParams.get('code') === activeRoom.code) close();
      else {setTarget(next); setStatus('Your current controller stays connected until you join.');}
    } else openTarget(next);
    return true;
  }
  useEffect(() => {
    if (!scanning || manual || target) return;
    const stop = startRoomCamera(video.current, {
      onReady: () => setStatus('Point at the QR code on your TV.'),
      onError: message => {setStatus(message); setManual(true);},
      onCode: found,
    });
    const hidden = () => {if (document.hidden) {stop(); close();}};
    document.addEventListener('visibilitychange', hidden);
    return () => {stop(); document.removeEventListener('visibilitychange', hidden);};
  }, [scanning, manual, target, activeRoom?.code]);
  async function changeRoom() {
    if (!target || leaving.current) return;
    leaving.current = true; setBusy(true);
    let left = false;
    try {left = await onLeave?.();} catch { /* The current seat stays available for retry. */ }
    leaving.current = false; setBusy(false);
    if (left) openTarget(target);
    else setStatus('Couldn’t leave this lobby yet. Check your connection and try again.');
  }
  return <>
    <button ref={button} type="button" className={className} disabled={disabled} aria-haspopup="dialog" onClick={() => {
      setTarget(null); setManual(false); setCode(''); setStatus('Starting camera…'); setScanning(true); dialog.current?.showModal();
    }}><ScanIcon width="24" height="24" />{label}</button>
    <dialog ref={dialog} className="remote-scanner" aria-labelledby="remote-scan-title"
      onCancel={event => {if (leaving.current) event.preventDefault();}}
      onClose={() => {setScanning(false); button.current?.focus({preventScroll: true});}}>
      <header><h2 id="remote-scan-title">{target ? 'Join another TV?' : 'Scan your TV'}</h2>
        <button type="button" aria-label="Close scanner" disabled={busy} onClick={close}>Close</button></header>
      {!manual && !target ? <div className="remote-viewfinder"><video ref={video} muted playsInline /><span aria-hidden="true" /></div> : null}
      {target ? <p className="remote-scan-room">Game {new URL(target).searchParams.get('code')}<small>{new URL(target).hostname}</small></p> : null}
      <p role="status">{status}</p>
      {target ? <div className="remote-scan-actions">
        <button type="button" className="remote-scan-confirm" disabled={busy} onClick={changeRoom}>{busy ? 'Joining…' : 'Leave and join'}</button>
        <button type="button" disabled={busy} onClick={close}>Keep playing</button>
      </div> : manual ? <form className="remote-scan-code" onSubmit={event => {event.preventDefault(); if (isRoomCode(code)) found(code);}}>
        <label htmlFor="scan-room-code">Lobby code</label>
        <input id="scan-room-code" value={code} onChange={event => setCode(normalizeCode(event.target.value))}
          maxLength={CODE_LENGTH} placeholder="K7PM" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck="false" />
        <button type="submit" className="remote-scan-confirm" disabled={!isRoomCode(code)}>Use code</button>
      </form> : <button type="button" className="remote-scan-manual" onClick={() => {setManual(true); setStatus('Enter the four characters shown on your TV.');}}>Enter a code instead</button>}
    </dialog>
  </>;
}
