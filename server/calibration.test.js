import { test, expect } from 'vitest';
import { calibrationBias } from '../src/controller/calibration.js';
test('calibration requires enough recent, finite, still samples', () => {
  const still = Array.from({ length: 20 }, () => ({ alpha: .2, beta: -.1, gamma: .3 }));
  expect(calibrationBias(still, 10)).toEqual(expect.objectContaining({ alpha: expect.closeTo(.2), beta: expect.closeTo(-.1) }));
  expect(calibrationBias(still.slice(0, 9), 10)).toBeNull();
  expect(calibrationBias(still, 501)).toBeNull();
  expect(calibrationBias(still.map(() => ({ alpha: 8, beta: 0, gamma: 0 })), 10)).toBeNull();
  expect(calibrationBias(still.map((_, i) => ({ alpha: i % 2 ? 8 : -8, beta: 0, gamma: 0 })), 10)).toBeNull();
  expect(calibrationBias([{ alpha: NaN }, ...still], 10)).toBeNull();
});
