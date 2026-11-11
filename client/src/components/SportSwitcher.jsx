import {useState} from 'react';
import {EVENTS, PHASES, playerCapacity} from '@wee/shared/protocol.js';
import {SPORTS} from '../lib/sports.js';
import {request} from '../lib/socket.js';
import {errorText} from '../lib/errors.js';

/** Switching preserves the room and player identities; motion restarts safely. */
export function SportSwitcher({lobby, role = 'host', disabled = false}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = [PHASES.LOBBY, PHASES.READY].includes(lobby.phase) || lobby.gameState?.phase === 'complete';
  if (!available) return null;
  return <div className="sport-switcher">
    <label>Next sport <select aria-label="Next sport" value={lobby.sport} disabled={disabled || busy}
      onChange={async event => {
        setBusy(true); setError('');
        const result = await request(role === 'host' ? EVENTS.HOST_SWITCH_SPORT : EVENTS.PLAYER_SWITCH_SPORT,
          {sport: event.target.value, gameId: lobby.gameId});
        setBusy(false); if (!result?.ok) setError(errorText(result?.error));
      }}>
      {SPORTS.filter(sport => sport.open).map(sport => <option key={sport.id} value={sport.id}
        disabled={lobby.players.some(player => player.slot >= playerCapacity(sport.id))}>{sport.name}</option>)}
    </select></label>
    <p className="stub__muted">Everyone stays in this lobby.</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
