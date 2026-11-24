import {RECONNECT_MS} from '@wee/shared/protocol.js';
import {useCountdown} from '../lib/useCountdown.js';

const NO_MEMBERS = [];

function MemberCountdown({name, msLeft, estimated = false}) {
  const hasDeadline = Number.isFinite(msLeft);
  const seconds = useCountdown(hasDeadline ? Math.max(0, msLeft) : null);

  let message = 'Waiting to reconnect';
  if (msLeft === null) {
    message = 'Waiting for the TV to return';
  } else if (hasDeadline) {
    message =
      seconds > 0
        ? `${estimated ? 'About ' : ''}${seconds}s to reconnect`
        : 'Reconnect window ended · waiting for server';
  }

  return (
    <li>
      <strong>{name}</strong>: <span>{message}</span>
    </li>
  );
}

export function ReconnectCountdown({members = NO_MEMBERS, estimating = false}) {
  const entries =
    members.length > 0
      ? members
      : estimating
        ? [{name: 'Your controller', msLeft: RECONNECT_MS}]
        : NO_MEMBERS;

  if (entries.length === 0) {
    return null;
  }

  return (
    <ul
      className="reconnect-countdown"
      aria-label="Reconnect time remaining"
      aria-live="off"
    >
      {entries.map((member, index) => (
        <MemberCountdown
          key={`${member.name}-${index}`}
          name={member.name}
          msLeft={member.msLeft}
          estimated={members.length === 0 && estimating}
        />
      ))}
    </ul>
  );
}
