import {playerCapacity} from '../../shared/protocol.js';

export class ProfileError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export const fail = (code, status) => { throw new ProfileError(code, status); };
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid-fields');
}
export function text(value, max = 40) {
  // eslint-disable-next-line no-control-regex -- Profile text must exclude ASCII control characters.
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid-text');
  return value.trim();
}
export function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value)) fail('invalid-id');
  return value;
}
export const DEFAULT_PREFERENCES = Object.freeze({version: 1, hand: 'Right', sensitivity: 1, assistance: 'friendly', sound: true, haptics: true, reducedMotion: false, touchControls: false});
export function preferences(value) {
  keys(value, Object.keys(DEFAULT_PREFERENCES));
  const result = {...DEFAULT_PREFERENCES, ...value};
  if (result.version !== 1 || !['Right', 'Left'].includes(result.hand) ||
      !['friendly', 'standard'].includes(result.assistance) || !Number.isFinite(result.sensitivity) ||
      result.sensitivity < 0.5 || result.sensitivity > 2 ||
      ['sound', 'haptics', 'reducedMotion', 'touchControls'].some(key => typeof result[key] !== 'boolean')) fail('invalid-preferences');
  return result;
}

// Only bounded, finite JSON is persisted. Sensor samples and private session
// credentials are deliberately outside the checkpoint/result schema.
export function boundedJson(value, maxBytes = 65536) {
  let count = 0;
  const forbidden = /^(?:rawSensors?|samples|password|token|reconnectToken|auth|credentials)$/i;
  function visit(item, depth) {
    if (++count > 8000 || depth > 12) fail('state-too-large');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('invalid-state'); return; }
    if (typeof item === 'string') { if (item.length > 256) fail('invalid-state'); return; }
    if (Array.isArray(item)) { if (item.length > 256) fail('state-too-large'); item.forEach(child => visit(child, depth + 1)); return; }
    if (!object(item)) fail('invalid-state');
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.test(key) || key === '__proto__' || key === 'constructor' || key.length > 64) fail('invalid-state');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maxBytes) fail('state-too-large');
  return encoded;
}

export function checkpoint(sport, value) {
  if (!object(value) || value.version !== 1) fail('unsupported-checkpoint');
  if (sport === 'bowling') {
    keys(value, ['version', 'boundary', 'match', 'pins', 'settings']);
    if (value.boundary !== 'settled' || !object(value.match) || !Array.isArray(value.pins) || value.pins.length > 10) fail('unstable-checkpoint');
    keys(value.match, ['version', 'players', 'deliveries']);
    if (value.match.version !== 1 || !Array.isArray(value.match.players) || value.match.players.length < 1 || value.match.players.length > playerCapacity('bowling') ||
        !Array.isArray(value.match.deliveries) || value.match.deliveries.length > 21 * playerCapacity('bowling')) fail('invalid-checkpoint');
    for (const player of value.match.players) {
      keys(player, ['player', 'name']);
      if (!Number.isInteger(player.player) || player.player < 1 || player.player > playerCapacity('bowling')) fail('invalid-checkpoint');
      text(player.name, 80);
    }
    keys(value.settings, ['aim', 'practice']);
    if (!Number.isFinite(value.settings.aim) || Math.abs(value.settings.aim) > 1 ||
        (value.settings.practice !== undefined && typeof value.settings.practice !== 'boolean')) fail('invalid-state');
    const ids = new Set();
    for (const pin of value.pins) {
      keys(pin, ['id', 'position', 'quaternion', 'standing']);
      if (!Number.isInteger(pin.id) || pin.id < 1 || pin.id > 10 || ids.has(pin.id) || typeof pin.standing !== 'boolean') fail('invalid-pin');
      ids.add(pin.id);
      if (!Array.isArray(pin.position) || pin.position.length !== 3 || pin.position.some(n => !Number.isFinite(n) || Math.abs(n) > 100) ||
          !Array.isArray(pin.quaternion) || pin.quaternion.length !== 4 || pin.quaternion.some(n => !Number.isFinite(n)) ||
          Math.abs(Math.hypot(...pin.quaternion) - 1) > 0.01) fail('invalid-pin');
    }
  } else if (sport === 'tennis') {
    keys(value, ['version', 'boundary', 'score', 'settings', 'humanOpponent']);
    if (value.boundary !== 'point' || typeof value.humanOpponent !== 'boolean') fail('unstable-checkpoint');
    keys(value.score, ['version', 'points', 'sets']);
    if (!Array.isArray(value.score.sets) || value.score.sets.length > 3) fail('invalid-checkpoint');
    for (const set of value.score.sets) keys(set, ['player1', 'player2']);
    keys(value.settings, ['format', 'assistance', 'botDifficulty', 'timingAssist', 'autoMove']);
    if (value.settings.format !== 'full' || !['beginner', 'standard'].includes(value.settings.assistance) ||
        !['beginner', 'standard'].includes(value.settings.botDifficulty) || typeof value.settings.timingAssist !== 'boolean' ||
        typeof value.settings.autoMove !== 'boolean') fail('invalid-state');
  } else fail('unsupported-checkpoint');
  return boundedJson(value);
}
