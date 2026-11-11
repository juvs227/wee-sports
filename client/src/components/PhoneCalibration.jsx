/**
 * Phone-side calibration UI. Shown during PHASES.CALIBRATION so the player
 * knows to hold still with the screen facing the net.
 */
export function PhoneCalibration({ progress = 0, calState = 'settling' }) {
  const done = progress >= 1;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = done ? circ : progress * circ;

  let statusText;
  if (done) statusText = 'Calibrated ✓';
  else if (calState === 'moving') statusText = 'Movement detected — keep still';
  else if (calState === 'calibrating') statusText = `Calibrating… ${Math.round(progress * 100)}%`;
  else statusText = 'Hold still…';

  return (
    <div className="phone-cal">
      <div className="phone-cal__ring-wrap" aria-hidden="true">
        <svg className="phone-cal__ring" viewBox="0 0 88 88" width="88" height="88">
          <circle cx="44" cy="44" r={r} fill="none" strokeWidth="8" stroke="var(--border)" />
          <circle
            cx="44" cy="44" r={r}
            fill="none"
            strokeWidth="8"
            stroke={done ? 'var(--p3)' : calState === 'moving' ? 'var(--danger)' : 'var(--accent)'}
            strokeDasharray={`${fill} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 44 44)"
            style={{ transition: 'stroke-dasharray 0.15s ease, stroke 0.2s ease' }}
          />
          <text x="44" y="49" textAnchor="middle" fontSize="14" fontWeight="800"
            fill={done ? 'var(--p3)' : calState === 'moving' ? 'var(--danger)' : 'var(--text)'}>
            {done ? '✓' : `${Math.round(progress * 100)}%`}
          </text>
        </svg>
      </div>
      <div className="phone-cal__text">
        <p className="phone-cal__title">Face the net</p>
        <p className="phone-cal__status" data-state={calState} data-done={done}>
          {statusText}
        </p>
        {!done ? (
          <p className="phone-cal__help">
            Hold your phone with the screen pointing toward the net.
          </p>
        ) : null}
      </div>
    </div>
  );
}
