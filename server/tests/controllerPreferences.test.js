import {expect, test} from 'vitest';
import {CONTROLLER_PREFERENCES_KEY, createControllerPreferences} from '@wee/src/controller/preferences.js';

function memory() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('profile defaults fill unset preferences without persisting sensor or account data', () => {
  const storage = memory();
  const preferences = createControllerPreferences(storage);
  expect(preferences.applyProfile({hand: 'Left', haptics: false, sensitivity: 1.5, touchControls: true,
    bias: {alpha: 99}, token: 'private', calibrated: true})).toBe(true);
  expect(preferences.values).toEqual({hand: 'Left', haptics: false, sensitivity: 1.5, touchControls: true});
  const saved = JSON.parse(storage.getItem(CONTROLLER_PREFERENCES_KEY));
  expect(Object.keys(saved.preferences).sort()).toEqual(['hand', 'haptics', 'sensitivity', 'touchControls']);
  expect(createControllerPreferences(storage).values).toEqual(preferences.values);
});

test('local choices, protected calibration context and active sessions win over remote defaults', () => {
  const storage = memory();
  const preferences = createControllerPreferences(storage);
  preferences.update({haptics: true});
  preferences.applyProfile({hand: 'Left', haptics: false, sensitivity: 2}, {protectedKeys: ['hand']});
  expect(preferences.values).toEqual({hand: 'Right', haptics: true, sensitivity: 2, touchControls: false});
  expect(preferences.applyProfile({hand: 'Left', haptics: false})).toBe(false);
  const active = createControllerPreferences(memory());
  expect(active.applyProfile({hand: 'Left', touchControls: true}, {active: true})).toBe(false);
  expect(active.values.hand).toBe('Right');
  expect(active.applyProfile({hand: 'Left'})).toBe(false);
});

test('invalid preference values and unavailable storage cannot invent calibration or crash play', () => {
  const preferences = createControllerPreferences({getItem() {throw new Error('blocked');}, setItem() {throw new Error('blocked');}});
  preferences.update({hand: 'Up', sensitivity: Infinity, haptics: 1, touchControls: 'true'});
  expect(preferences.values).toEqual({hand: 'Right', sensitivity: 1, haptics: true, touchControls: false});
  expect(preferences.applyProfile({sensitivity: 2.1})).toBe(false);
  preferences.update({haptics: false});
  expect(preferences.values.haptics).toBe(false);
});
