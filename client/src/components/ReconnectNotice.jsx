import {ReconnectCountdown} from './ReconnectCountdown.jsx';
import {LeaveRoomButton} from './LeaveRoomButton.jsx';
import {QrCode} from './QrCode.jsx';
import {usePhoneLink} from '../lib/usePhoneLink.js';
import {Link} from 'react-router-dom';

export function ReconnectNotice({
  lobby,
  reconnecting,
  code,
  compact = false,
  homeHref,
  onLeave,
}) {
  const {url} = usePhoneLink(code);
  const tvAway = lobby?.reconnecting?.some(
    member => member.role === 'host' || (!member.role && member.name === 'TV'),
  );
  if (compact)
    return (
      <aside
        className="phone-reconnect-notice"
        role="status"
        aria-live="polite"
      >
        <strong>
          {reconnecting
            ? 'Reconnecting your controller…'
            : tvAway
              ? 'TV disconnected'
              : 'Waiting for a controller…'}
        </strong>
        <span>
          {reconnecting
            ? 'Trying to reconnect. Use Go home if you want to leave the room.'
            : tvAway
              ? `Reopen room ${lobby.code} on the TV. You can wait here or go home.`
              : `${lobby?.reconnecting?.map(player => player.name).join(', ')} will rejoin automatically.`}
        </span>
        <ReconnectCountdown
          members={lobby?.reconnecting}
          estimating={reconnecting}
        />
      </aside>
    );
  return (
    <main className="stub" role="status" aria-live="polite">
      <h1>
        {reconnecting ? 'Reconnecting…' : 'Waiting for everyone to reconnect'}
      </h1>
      <p className="stub__muted">
        {homeHref
          ? 'Trying to reconnect to your room. You can go home at any time.'
          : 'Your room is waiting. The TV can return while players stay connected.'}
      </p>
      <ReconnectCountdown
        members={lobby?.reconnecting}
        estimating={reconnecting}
      />
      {code ? (
        <div className="stub__row">
          {url ? (
            <QrCode
              value={url}
              className="stub__qr"
              label="Scan to reconnect"
            />
          ) : null}
          <div>
            <p className="stub__code">{code}</p>
            <p className="stub__muted">
              Reopen this lobby in the same phone browser.
            </p>
          </div>
        </div>
      ) : null}
      {homeHref ? (
        onLeave ? (
          <LeaveRoomButton onLeave={onLeave} />
        ) : (
          <Link className="btn btn--primary" to={homeHref}>
            Go home
          </Link>
        )
      ) : (
        <p className="stub__status">
          The ready check or countdown will continue when everyone is back.
        </p>
      )}
    </main>
  );
}
