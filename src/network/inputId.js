// Input IDs deduplicate game actions; they are not authentication/session tokens.
// randomUUID requires HTTPS, while getRandomValues also works on LAN HTTP.
let sequence = 0;
const fallbackPrefix = Math.random().toString(36).slice(2, 12).padEnd(10, '0');

export function createInputId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Older WebViews may expose neither API. Keep actions unique within this tab.
  sequence += 1;
  return `${fallbackPrefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
