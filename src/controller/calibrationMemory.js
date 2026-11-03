import { classifierVersion } from './classifySwing.js';

export const CALIBRATION_STORAGE_KEY = 'wee:controller-calibration:v1';
export const CALIBRATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const axes = ['alpha', 'beta', 'gamma'];
const version = `still-v1:${classifierVersion}`;

const validBias = bias => axes.every(axis => Number.isFinite(bias?.[axis])) &&
  Math.hypot(...axes.map(axis => bias[axis])) <= 5;
const validStrength = (profile, hand) => profile?.hand === hand &&
  ['Forehand', 'Backhand'].every(label => Number.isFinite(profile[label]) && profile[label] >= .75 && profile[label] <= 1.75);

/** Same-origin recent setup. Reading it never grants permission or marks ready. */
export function createCalibrationMemory(storage, now = Date.now, fallbackStorage) {
  const stores = [...new Set([storage, fallbackStorage].filter(Boolean))];
  function clear() {
    for (const store of stores) {
      try { store.removeItem(CALIBRATION_STORAGE_KEY); } catch { /* Storage can be disabled. */ }
    }
  }
  function read() {
    for (const store of stores) {
      let encoded;
      try { encoded = store.getItem(CALIBRATION_STORAGE_KEY); } catch { continue; }
      if (!encoded) continue;
      let saved;
      try { saved = JSON.parse(encoded); } catch { clear(); return null; }
      if (!saved) continue;
      const age = now() - saved.verifiedAt;
      if (saved.version !== version || !['Right', 'Left'].includes(saved.hand) || !validBias(saved.bias) ||
          !Number.isFinite(saved.verifiedAt) || age < 0 || age > CALIBRATION_MAX_AGE_MS ||
          (saved.strength !== null && !validStrength(saved.strength, saved.hand))) {
        clear(); return null;
      }
      return saved;
    }
    return null;
  }
  function save({ hand, bias, strength = null, verifiedAt = now() }) {
    if (!['Right', 'Left'].includes(hand) || !validBias(bias) ||
        (strength !== null && !validStrength(strength, hand)) || !Number.isFinite(verifiedAt)) return false;
    const encoded = JSON.stringify({ version, hand, bias, strength, verifiedAt });
    for (const store of stores) {
      try {
        store.setItem(CALIBRATION_STORAGE_KEY, encoded);
        // Retire an older fallback so it cannot replace this newer verification.
        for (const other of stores) if (other !== store) {
          try { other.removeItem(CALIBRATION_STORAGE_KEY); } catch { /* Optional. */ }
        }
        return true;
      } catch { /* Try same-tab storage if persistent storage is blocked. */ }
    }
    return false;
  }
  return { read, save, clear };
}

/** Fresh still readings must agree before a saved setup can be reused. */
export function matchesSavedBias(saved, current) {
  return validBias(saved) && validBias(current) &&
    Math.hypot(...axes.map(axis => saved[axis] - current[axis])) <= 2;
}
