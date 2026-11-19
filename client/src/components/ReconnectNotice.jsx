import { QrCode } from './QrCode.jsx';
import { usePhoneLink } from '../lib/usePhoneLink.js';
import { Link } from 'react-router-dom';

export function ReconnectNotice({ lobby, reconnecting, code, compact = false, homeHref }) {
  const { url } = usePhoneLink(code);
  const tvAway = lobby?.reconnecting?.some(member => member.role === 'host' || (!member.role && member.name === 'TV'));
  if (compact) return <aside className="phone-reconnect-notice" role="status" aria-live="polite">
    <strong>{reconnecting ? 'Reconnecting your controller…' : tvAway ? 'TV disconnected' : 'Waiting for a controller…'}</strong>
    <span>{reconnecting ? 'Trying to reconnect. You can go home and return to this room.'
      : tvAway ? `Reopen room ${lobby.code} on the TV. You can wait here or go home.`
      : `${lobby?.reconnecting?.map(player => player.name).join(', ')} will rejoin automatically.`}</span>
  </aside>;
  return (
    <main className="stub" role="status" aria-live="polite">
      <h1>{reconnecting ? 'Reconnecting…' : 'Waiting for everyone to reconnect'}</h1>
      <p className="stub__muted">{homeHref ? 'Trying to reconnect to your room. You can go home at any time.' : 'Your room is waiting. The TV can return while players stay connected.'}</p>
      {!reconnecting && lobby?.reconnecting?.length ? (
        <ul className="seats">
          {lobby.reconnecting.map((player, index) => (
            <li className="seat" key={`${player.name}-${index}`}>
              {player.name}: {player.msLeft === null ? 'Waiting for the TV to return' : `${Math.ceil(player.msLeft / 1000)} seconds remaining`}
            </li>
          ))}
        </ul>
      ) : null}
      {code ? <div className="stub__row">
        {url ? <QrCode value={url} className="stub__qr" label="Scan to reconnect" /> : null}
        <div><p className="stub__code">{code}</p><p className="stub__muted">Reopen this lobby in the same phone browser.</p></div>
      </div> : null}
      {homeHref ? <Link className="btn btn--primary" to={homeHref}>Go home</Link> : <p className="stub__status">The ready check or countdown will continue when everyone is back.</p>}
    </main>
  );
}
