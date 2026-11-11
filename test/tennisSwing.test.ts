import { test, expect } from 'vitest';
import { createSwingDetector, SWING_LIMITS } from '../src/controller/accelerationSwing.js';

const sample = (timeMs: number, accelMag: number) => ({ timeMs, accelMag });

test('detects a swing when accelMag meets the threshold', () => {
  const detector = createSwingDetector();
  const result = detector.push(sample(0, SWING_LIMITS.start));
  expect(result).not.toBeNull();
  expect(result!.label).toBe('Forehand');
  expect(result!.complete).toBe(true);
});

test('returns null when accelMag is below threshold', () => {
  const detector = createSwingDetector();
  expect(detector.push(sample(0, SWING_LIMITS.start - 1))).toBeNull();
});

test('sustained high accel only fires once per crossing', () => {
  const detector = createSwingDetector();
  const results = [];
  for (let t = 0; t < 500; t += 50) {
    const r = detector.push(sample(t, SWING_LIMITS.start + 5));
    if (r) results.push(r);
  }
  expect(results).toHaveLength(1);
});

test('suppresses a second swing within the cooldown window', () => {
  const detector = createSwingDetector();
  expect(detector.push(sample(0, SWING_LIMITS.start))).not.toBeNull();
  expect(detector.push(sample(500, SWING_LIMITS.start + 10))).toBeNull();
  expect(detector.push(sample(999, SWING_LIMITS.start + 10))).toBeNull();
});

test('allows a second swing after the cooldown window', () => {
  const detector = createSwingDetector();
  expect(detector.push(sample(0, SWING_LIMITS.start))).not.toBeNull();
  expect(detector.push(sample(500, 0))).toBeNull(); // drop below to reset above flag
  const second = detector.push(sample(1000, SWING_LIMITS.start));
  expect(second).not.toBeNull();
  expect(second!.label).toBe('Forehand');
});

test('swing result includes startMs and peakTimeMs equal to the sample time', () => {
  const detector = createSwingDetector();
  const result = detector.push(sample(42, SWING_LIMITS.start));
  expect(result!.startMs).toBe(42);
  expect(result!.peakTimeMs).toBe(42);
});
