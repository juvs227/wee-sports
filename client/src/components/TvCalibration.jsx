/**
 * Shown during the CALIBRATION phase. Each phone iframes postMessages its
 * progress; the TV parent collects them and passes calibrationProgress here.
 * calibratedSlots (from server) covers standalone phones that don't postMessage.
 * Once everyone hits 1.0, the parent emits HOST_CALIBRATION_DONE.
 */
export function TvCalibration({ lobby, calibrationProgress }) {
  const { players } = lobby;
  // Standalone phones signal done via socket.io → server → calibratedSlots
  const calibratedSlots = new Set(lobby.calibratedSlots ?? []);

  return (
    <section className="cal-tv stub">
      <div className="cal-tv__scene">
        <div className="cal-tv__shell">
          <div className="cal-tv__screen">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <circle cx="24" cy="24" r="22" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2.5"/>
              <path d="M10 16c8 4 8 12 0 16M38 16c-8 4-8 12 0 16" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="cal-tv__chin" />
          <div className="cal-tv__stand" />
        </div>
        <div className="cal-tv__phone" aria-hidden="true">
          <svg viewBox="0 0 80 148" fill="none" xmlns="http://www.w3.org/2000/svg" width="52" height="96">
            <rect x="3" y="3" width="74" height="142" rx="13" fill="#edeae4" stroke="#c8c0b4" strokeWidth="2.5"/>
            <rect x="8" y="8" width="64" height="132" rx="10" fill="#d8d4cc" stroke="#b8b0a4" strokeWidth="1.5"/>
            {/* camera bump */}
            <rect x="22" y="14" width="36" height="30" rx="8" fill="#c8c0b8" stroke="#b0a898" strokeWidth="1.5"/>
            <circle cx="34" cy="24" r="6" fill="#888" stroke="#666" strokeWidth="1"/>
            <circle cx="34" cy="24" r="3.5" fill="#333"/>
            <circle cx="34" cy="24" r="1.5" fill="#111"/>
            <circle cx="46" cy="24" r="6" fill="#888" stroke="#666" strokeWidth="1"/>
            <circle cx="46" cy="24" r="3.5" fill="#333"/>
            <circle cx="46" cy="24" r="1.5" fill="#111"/>
            <circle cx="40" cy="36" r="4" fill="#888" stroke="#666" strokeWidth="1"/>
            <circle cx="40" cy="36" r="2" fill="#333"/>
            {/* home indicator */}
            <rect x="28" y="130" width="24" height="4" rx="2" fill="#b8b0a4"/>
          </svg>
        </div>
      </div>

      <h2 className="cal-tv__title">Face the net</h2>
      <p className="cal-tv__help">
        Hold your phone with the screen pointing toward the net and keep still.
      </p>

      <ul className="cal-tv__players">
        {players.map(({ slot, name }) => {
          const pct = calibratedSlots.has(slot) ? 1 : (calibrationProgress[slot] ?? 0);
          const done = pct >= 1;
          const moving = !done && calibrationProgress[`${slot}_state`] === 'moving';
          return (
            <li key={slot} className="cal-card" data-done={done} style={{ '--player': `var(--p${slot + 1})` }}>
              <span className="seat__badge" data-slot={slot}>P{slot + 1}</span>
              <div className="cal-card__body">
                <span className="cal-card__name">{name}</span>
                <div className="cal-card__bar-wrap">
                  <div className="cal-card__bar" style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
              </div>
              <span className="cal-card__pct">{done ? '✓' : `${Math.round(pct * 100)}%`}</span>
              {moving ? <span className="cal-card__alert">Keep it still!</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
