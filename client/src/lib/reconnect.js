/** Tokens are scoped to role + room; never put them in the QR code or public state. */
const memory = new Map();
const key = (role, code) => `wee:session:v2:${role}:${code}`;
const lastHostKey = 'wee:last-host-room';
const lastPlayerKey = 'wee:last-player-room';
let hostRoom = null;
let playerRoom = null;
function storage() { try { return window.localStorage; } catch { return null; } }
export function loadToken(role, code) {
  try { return storage()?.getItem(key(role, code)) ?? memory.get(key(role, code)) ?? null; }
  catch { return memory.get(key(role, code)) ?? null; }
}
export function saveToken(role, code, token) {
  memory.set(key(role, code), token);
  if (role === 'host') {hostRoom = code; try {storage()?.setItem(lastHostKey, code);} catch { /* Memory retains this room when storage is blocked. */ }}
  if (role === 'player') {playerRoom = code; try {storage()?.setItem(lastPlayerKey, code);} catch { /* Memory retains this room when storage is blocked. */ }}
  try { const target = storage(); target?.setItem(key(role, code), token); return Boolean(target); }
  catch { return false; }
}
export function clearToken(role, code) {
  const latestHost = role === 'host' && lastHostRoom() === code;
  const latestPlayer = role === 'player' && lastPlayerRoom() === code;
  memory.delete(key(role, code));
  try { storage()?.removeItem(key(role, code)); } catch { /* Storage can be unavailable. */ }
  if (latestHost) {
    hostRoom = null;
    try {storage()?.removeItem(lastHostKey);} catch { /* Storage can be unavailable. */ }
  }
  if (latestPlayer) {
    playerRoom = null;
    try {storage()?.removeItem(lastPlayerKey);} catch { /* Storage can be unavailable. */ }
  }
}

export function lastHostRoom() {
  let code = hostRoom;
  try {code = storage()?.getItem(lastHostKey) ?? code;} catch { /* Fall back to the in-memory room. */ }
  return /^[A-Z0-9]{4}$/.test(code || '') && loadToken('host', code) ? code : null;
}

/** A return shortcut, not a promise that the server still has this room. */
export function lastPlayerRoom() {
  let code = playerRoom;
  try {code = storage()?.getItem(lastPlayerKey) ?? code;} catch { /* Fall back to the in-memory room. */ }
  return /^[A-Z0-9]{4}$/.test(code || '') && loadToken('player', code) ? code : null;
}
