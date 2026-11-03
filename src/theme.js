/** Shared by the lobby and embedded games/controllers on the same address. */
const STORAGE_KEY = 'wee:theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
let preference = null;
let parentTheme = null;
try {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch { /* The switch still works for this page when storage is blocked. */ }

export function getTheme() {
  return parentTheme || preference || (system.matches ? 'dark' : 'light');
}

function applyTheme() {
  document.documentElement.dataset.theme = getTheme();
  for (const listener of listeners) listener();
  // Storage can be blocked in private/embedded contexts. The parent still owns
  // the appearance of its own same-origin frames in that session.
  for (const frame of document.querySelectorAll('iframe')) {
    frame.contentWindow?.postMessage({type: 'wee:theme', theme: getTheme()}, location.origin);
  }
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  parentTheme = null;
  preference = theme;
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* Optional persistence. */ }
  applyTheme();
}

export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Storage events also reach the same-origin game and phone-controller frames.
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  preference = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
  applyTheme();
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (window.parent !== window && event.source === window.parent && event.data?.type === 'wee:theme' &&
      ['light', 'dark'].includes(event.data.theme)) {
    parentTheme = event.data.theme;
    applyTheme();
  } else if (event.data?.type === 'wee:theme-ready' &&
      [...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)) {
    event.source.postMessage({type: 'wee:theme', theme: getTheme()}, location.origin);
  }
});
system.addEventListener('change', () => { if (!preference) applyTheme(); });
applyTheme();
if (window.parent !== window) window.parent.postMessage({type: 'wee:theme-ready'}, location.origin);
