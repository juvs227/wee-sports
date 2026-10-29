import { test, expect } from 'vitest';
import { aimAtTime } from '../src/controller/phoneAim.js';

const neutral = { gamma: 10, screenAngle: 0 };
const reading = (gamma, timeMs = 100, screenAngle = 0) => ({ gamma, timeMs, screenAngle });

test('neutral grip, dead zone, proportional tilt, saturation, and inversion', () => {
  expect(aimAtTime([reading(12)], neutral, 110).aimX).toBe(0);
  expect(aimAtTime([reading(44)], neutral, 110).aimX).toBeCloseTo(0.5);
  expect(aimAtTime([reading(80)], neutral, 110).aimX).toBe(1);
  expect(aimAtTime([reading(-60)], neutral, 110).aimX).toBe(-1);
  expect(aimAtTime([reading(44)], neutral, 110, true).aimX).toBeCloseTo(-0.5);
});

test('orientation is sampled at the swing peak, not at follow-through', () => {
  const history = [reading(44, 100), reading(-30, 200)];
  expect(aimAtTime(history, neutral, 120).aimX).toBeCloseTo(0.5);
});

test('missing, stale, future-only, or rotated-screen data uses no angle aim', () => {
  expect(aimAtTime([], neutral, 100)).toBeNull();
  expect(aimAtTime([reading(44)], null, 100)).toBeNull();
  expect(aimAtTime([reading(44)], neutral, 400)).toBeNull();
  expect(aimAtTime([reading(44, 200)], neutral, 100)).toBeNull();
  expect(aimAtTime([reading(44, 100, 90)], neutral, 100)).toBeNull();
  expect(aimAtTime([reading(NaN)], neutral, 100)).toBeNull();
});

test('angle wraparound does not produce a full-tilt jump', () => {
  expect(aimAtTime([reading(-179)], { gamma: 179, screenAngle: 0 }, 100).aimX).toBe(0);
});

 test('forward/back tilt controls depth relative to ready pose', () => {
  const baseline = { gamma: 0, beta: 20, screenAngle: 0 };
  const sample = beta => [{ gamma: 0, beta, screenAngle: 0, timeMs: 100 }];
  expect(aimAtTime(sample(20), baseline, 100).aimDepth).toBe(0);
  expect(aimAtTime(sample(65), baseline, 100).aimDepth).toBe(1);
  expect(aimAtTime(sample(-25), baseline, 100).aimDepth).toBe(-1);
  expect(aimAtTime(sample(null), baseline, 100).aimDepth).toBeUndefined();
});
