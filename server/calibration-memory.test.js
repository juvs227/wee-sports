import { expect, test } from 'vitest';
import { createCalibrationMemory, createCalibrationResume, CALIBRATION_STORAGE_KEY, CALIBRATION_MAX_AGE_MS } from '../src/controller/calibrationMemory.js';

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

test('blocked storage stays optional', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const memory = createCalibrationMemory(blocked);
  expect(memory.save(setup)).toBe(false);
  expect(memory.read()).toBeNull();
  expect(() => memory.clear()).not.toThrow();
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

test('recent setup resumes from a fresh moving stream without measuring that motion as zero', () => {
  const resume = createCalibrationResume(100, setup.bias);
  for (let i = 0; i < 10; i++) resume.push({ alpha: i % 2 ? 90 : -90, beta: 50, gamma: 20 }, 100 + i * 20);
  expect(resume.read(280)).toEqual({ state: 'done', bias: setup.bias, progress: 1 });
});

test('resume requires finite live readings and cannot combine stale or interrupted samples', () => {
  const resume = createCalibrationResume(0, setup.bias);
  for (let i = 0; i < 15; i++) resume.push({ alpha: null, beta: 0, gamma: 0 }, i * 20);
  expect(resume.read(300).state).toBe('no-readings');
  for (let i = 0; i < 9; i++) resume.push(setup.bias, 400 + i * 20);
  expect(resume.read(560).state).toBe('collecting');
  resume.push(setup.bias, 1000);
  expect(resume.read(1000).state).toBe('collecting');
  for (let i = 1; i < 10; i++) resume.push(setup.bias, 1000 + i * 20);
  expect(resume.read(1700).state).toBe('stale');
  expect(resume.read(6000)).toEqual({ state: 'failed', reason: 'stale', progress: 0 });
});
