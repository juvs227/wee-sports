function ViewIcon({island}) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {island ? <><path d="M3 19c3-3 15-3 18 0M12 16c0-4 1-7 3-10M15 6c-4-2-6 0-7 2 3-1 5-1 7-2ZM15 6c3-3 5-1 6 1-2-1-4-1-6-1ZM15 6c3 0 4 2 3 5l-3-5Z" /><path d="M4 22h16" /></> : <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>}
  </svg>;
}

/** Native radios provide arrow-key navigation without moving focus on view load. */
export function HomeViewSwitch({value, onChange, disabled}) {
  return <fieldset className="home-view-switch" disabled={disabled}>
    <legend className="sr-only">Homepage view</legend>
    {['classic', 'island'].map(view => <label key={view} className="home-view-switch__option">
      <input type="radio" name="home-view" value={view} checked={value === view} onChange={() => onChange(view)} />
      <span><ViewIcon island={view === 'island'} />{view === 'classic' ? 'Classic' : 'Island'}</span>
    </label>)}
  </fieldset>;
}
