export const CONTROLLER_PREFERENCES_KEY = 'wee.controller.preferences.v1';
const defaults = Object.freeze({hand: 'Right', sensitivity: 1, haptics: true, touchControls: false});
const valid = {
  hand: value => value === 'Right' || value === 'Left',
  sensitivity: value => Number.isFinite(value) && value >= .5 && value <= 2,
  haptics: value => typeof value === 'boolean',
  touchControls: value => typeof value === 'boolean',
};
function fields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(valid).filter(([key, check]) => check(value[key])).map(([key]) => [key, value[key]]));
}

/** Preferences are portable choices, never sensor permission or calibration.
 * Explicit device choices win over late remote defaults; nothing stores bias.
 */
export function createControllerPreferences(storage) {
  let chosen = {}, profileApplied = false;
  try {
    const saved = JSON.parse(storage?.getItem(CONTROLLER_PREFERENCES_KEY) ?? 'null');
    if (saved?.version === 1) chosen = fields(saved.preferences);
  } catch { /* Preference storage is optional. */ }
  const save = () => {
    try { storage?.setItem(CONTROLLER_PREFERENCES_KEY, JSON.stringify({version: 1, preferences: chosen})); } catch { /* Keep this tab's choices. */ }
  };
  return {
    get values() { return {...defaults, ...chosen}; },
    update(value) { Object.assign(chosen, fields(value)); save(); return this.values; },
    applyProfile(value, {active = false, protectedKeys = []} = {}) {
      if (profileApplied) return false;
      profileApplied = true;
      let changed = false;
      for (const [key, next] of Object.entries(fields(value))) {
        // A late response must not change a live gesture's mapping. Vibration
        // preference can still be applied without interrupting the controller.
        if (Object.hasOwn(chosen, key) || protectedKeys.includes(key) || active && key !== 'haptics') continue;
        chosen[key] = next; changed = true;
      }
      if (changed) save();
      return changed;
    },
  };
}
