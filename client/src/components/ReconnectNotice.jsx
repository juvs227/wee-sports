import { QrCode } from './QrCode.jsx';
import { usePhoneLink } from '../lib/usePhoneLink.js';

export function ReconnectNotice({ lobby, reconnecting, code }) {
  const { url } = usePhoneLink(code);
  return (
    <main className="stub" role="status" aria-live="polite">
      <h1>{reconnecting ? 'Reconnecting…' : 'Waiting for everyone to reconnect'}</h1>
      <p className="stub__muted">Your lobby and seats are saved for 60 seconds. Keep this page open.</p>
      {!reconnecting && lobby?.reconnecting?.length ? (
        <ul className="seats">
          {lobby.reconnecting.map((player, index) => (
            <li className="seat" key={`${player.name}-${index}`}>
              {player.name}: {Math.ceil(player.msLeft / 1000)} seconds remaining
            </li>
          ))}
        </ul>
      ) : null}
      {code ? <div className="stub__row">
        {url ? <QrCode value={url} className="stub__qr" label="Scan to reconnect" /> : null}
        <div><p className="stub__code">{code}</p><p className="stub__muted">Reopen this lobby in the same phone browser.</p></div>
      </div> : null}
      <p className="stub__status">The ready check or countdown will continue when everyone is back.</p>
    </main>
  );
}
