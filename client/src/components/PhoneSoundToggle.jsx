import { useRef, useState } from 'react';
import { EVENTS } from '@wee/shared/protocol.js';
import { request } from '../lib/socket.js';
import { SoundToggle } from './SoundToggle.jsx';
import '../../../src/audio/sportsAudio.css';

export function PhoneSoundToggle({ lobby, disabled }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    if (pending.current || disabled || typeof lobby.soundMuted !== 'boolean') return;
    pending.current = true; setBusy(true); setError('');
    const result = await request(EVENTS.SOUND_SET, { muted: !lobby.soundMuted });
    pending.current = false; setBusy(false);
    if (!result?.ok) setError('Sound could not change. Try again when connected.');
  }
  return <div className="phone-sound-control">
    <SoundToggle muted={lobby.soundMuted === true} disabled={disabled || typeof lobby.soundMuted !== 'boolean'} busy={busy} onClick={toggle} />
    {error ? <span className="phone-sound-control__error" role="status">{error}</span> : null}
  </div>;
}
