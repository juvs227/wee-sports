import { expect, test } from 'vitest';
import { createCalibrationMemory, matchesSavedBias, CALIBRATION_STORAGE_KEY, CALIBRATION_MAX_AGE_MS } from '../src/controller/calibrationMemory.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const setup = { hand: 'Left', bias: { alpha: .2, beta: -.1, gamma: .3 },
  strength: { hand: 'Left', Forehand: 1.2, Backhand: .9 } };

test('recent setup retains playing hand and bounded strength, without altering the stored timestamp on read', () => {
  const store = storage();
  let now = 1000;
  const memory = createCalibrationMemory(store, () => now);
  expect(memory.save(setup)).toBe(true);
  now = 5000;
  expect(memory.read()).toMatchObject({ ...setup, verifiedAt: 1000 });
  now = 1000 + CALIBRATION_MAX_AGE_MS + 1;
  expect(memory.read()).toBeNull();
  expect(store.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
});

test('stored version, hand, timestamp, bias and strength must all be valid', () => {
  const store = storage();
  const memory = createCalibrationMemory(store, () => 1000);
  memory.save(setup);
  const valid = JSON.parse(store.getItem(CALIBRATION_STORAGE_KEY));
  for (const patch of [{ version: 'old-version' }, { hand: 'Unknown' }, { verifiedAt: 1001 },
    { bias: { alpha: 10, beta: 0, gamma: 0 } }, { bias: { alpha: null, beta: 0, gamma: 0 } },
    { strength: { hand: 'Right', Forehand: 1, Backhand: 1 } }, { strength: { hand: 'Left', Forehand: 10, Backhand: 1 } }]) {
    store.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify({ ...valid, ...patch }));
    expect(memory.read()).toBeNull();
  }
  store.setItem(CALIBRATION_STORAGE_KEY, '{bad');
  expect(memory.read()).toBeNull();
});

test('blocked storage stays optional and cached bias only matches a fresh, similar still offset', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const memory = createCalibrationMemory(blocked);
  expect(memory.save(setup)).toBe(false);
  expect(memory.read()).toBeNull();
  expect(() => memory.clear()).not.toThrow();
  expect(matchesSavedBias(setup.bias, { alpha: .3, beta: 0, gamma: .4 })).toBe(true);
  expect(matchesSavedBias(setup.bias, { alpha: 4, beta: 0, gamma: 0 })).toBe(false);
  expect(matchesSavedBias(setup.bias, { alpha: NaN, beta: 0, gamma: 0 })).toBe(false);
});

test('persistent storage shares recent setup across tabs and blocked persistence falls back to session storage', () => {
  const persistent = storage();
  const firstTab = storage();
  const secondTab = storage();
  expect(createCalibrationMemory(persistent, () => 1000, firstTab).save(setup)).toBe(true);
  expect(createCalibrationMemory(persistent, () => 2000, secondTab).read()).toMatchObject(setup);
  expect(firstTab.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  expect(secondTab.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  expect(createCalibrationMemory(blocked, () => 1000, firstTab).save(setup)).toBe(true);
  expect(createCalibrationMemory(blocked, () => 1500, firstTab).read()).toMatchObject(setup);
  expect(createCalibrationMemory(blocked, () => 1500, secondTab).read()).toBeNull();
  const recovered = createCalibrationMemory(persistent, () => 2000, firstTab);
  expect(recovered.save({ ...setup, strength: null })).toBe(true);
  expect(firstTab.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
});
