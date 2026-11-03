import { test, expect } from 'vitest';
import { calibrationBias, createCalibrationSession } from '../src/controller/calibration.js';
test('calibration requires enough recent, finite, still samples', () => {
  const still = Array.from({ length: 20 }, () => ({ alpha: .2, beta: -.1, gamma: .3 }));
  expect(calibrationBias(still, 10)).toEqual(expect.objectContaining({ alpha: expect.closeTo(.2), beta: expect.closeTo(-.1) }));
  expect(calibrationBias(still.slice(0, 9), 10)).toBeNull();
  expect(calibrationBias(still, 501)).toBeNull();
  expect(calibrationBias(still.map(() => ({ alpha: 8, beta: 0, gamma: 0 })), 10)).toBeNull();
  expect(calibrationBias(still.map((_, i) => ({ alpha: i % 2 ? 8 : -8, beta: 0, gamma: 0 })), 10)).toBeNull();
  expect(calibrationBias([{ alpha: NaN }, ...still], 10)).toBeNull();
});

test('calibration ignores tap movement, then requires sustained fresh still readings', () => {
  const session = createCalibrationSession(0);
  for (let time = 0; time <= 2000; time += 20) {
    session.push({ alpha: time < 800 ? 90 : .2, beta: 0, gamma: 0 }, time);
    if (time < 2000) expect(session.read(time).state).not.toBe('done');
  }
  expect(session.read(2000)).toMatchObject({ state: 'done', bias: { alpha: expect.closeTo(.2) } });
});

test('calibration recovers from setting the phone down slowly without another tap', () => {
  const session = createCalibrationSession(0);
  for (let time = 0; time <= 4000; time += 20) {
    session.push({ alpha: time < 2000 ? time % 40 ? -15 : 15 : .1, beta: 0, gamma: 0 }, time);
    session.read(time);
  }
  expect(session.read(4000).state).toBe('done');
});

test('calibration times out without sensors and never treats null or stale readings as zero', () => {
  const missing = createCalibrationSession(0);
  for (let time = 0; time <= 10000; time += 20) missing.push({ alpha: null, beta: null, gamma: null }, time);
  expect(missing.read(10000)).toMatchObject({ state: 'failed', reason: 'no-readings' });
  const stale = createCalibrationSession(0);
  for (let time = 800; time < 1800; time += 20) stale.push({ alpha: 0, beta: 0, gamma: 0 }, time);
  expect(stale.read(10000)).toMatchObject({ state: 'failed', reason: 'stale' });
});

test('sensor gaps cannot count toward a continuous still calibration window', () => {
  const session = createCalibrationSession(0);
  for (let time = 800; time < 1500; time += 20) session.push({ alpha: 0, beta: 0, gamma: 0 }, time);
  for (let time = 3000; time <= 3600; time += 20) session.push({ alpha: 0, beta: 0, gamma: 0 }, time);
  expect(session.read(3600).state).not.toBe('done');
  for (let time = 3620; time <= 4200; time += 20) session.push({ alpha: 0, beta: 0, gamma: 0 }, time);
  expect(session.read(4200).state).toBe('done');
});
