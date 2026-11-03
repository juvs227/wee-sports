import { useSyncExternalStore } from 'react';
import { getTheme, setTheme, subscribeTheme } from '../../../src/theme.js';

/** A local display preference; never changes another player's screen. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const dark = theme === 'dark';
  const label = `Switch to ${dark ? 'light' : 'dark'} mode`;
  return <button type="button" className="theme-toggle" title={label}
    aria-label={label} aria-pressed={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />}
    </svg>
  </button>;
}
