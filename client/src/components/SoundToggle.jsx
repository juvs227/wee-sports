/** One quiet, accessible control; no test panel or confirmation sound. */
export function SoundToggle({ muted, ready = true, onClick, disabled, busy, title }) {
  const label = !ready ? 'Enable game sound' : muted ? 'Unmute game sound' : 'Mute game sound';
  return <button type="button" className="sports-sound-toggle sports-sound-toggle--icon"
    aria-label={label} aria-pressed={muted} aria-busy={busy || undefined}
    title={title || `${label} on the TV`} disabled={disabled || busy} onClick={onClick}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4 6 8H3v8h3l5 4V4Z" />
      {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}
    </svg>
  </button>;
}
