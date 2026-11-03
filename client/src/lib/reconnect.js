/** Tokens are scoped to role + room; never put them in the QR code or public state. */
const memory = new Map();
const key = (role, code) => `wee:session:v2:${role}:${code}`;
function storage() { try { return window.localStorage; } catch { return null; } }
export function loadToken(role, code) {
  try { return storage()?.getItem(key(role, code)) ?? memory.get(key(role, code)) ?? null; }
  catch { return memory.get(key(role, code)) ?? null; }
}
export function saveToken(role, code, token) {
  memory.set(key(role, code), token);
  try { const target = storage(); target?.setItem(key(role, code), token); return Boolean(target); }
  catch { return false; }
}
export function clearToken(role, code) {
  memory.delete(key(role, code));
  try { storage()?.removeItem(key(role, code)); } catch { /* Storage can be unavailable. */ }
}
