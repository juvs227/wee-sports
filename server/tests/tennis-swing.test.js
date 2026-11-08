import { test, expect } from 'vitest';
import { createSwingDetector, SWING_LIMITS, classifierVersion } from '@wee/src/controller/classifySwing.js';

const sample = (timeMs, accelMag) => ({ timeMs, accelMag });

test('exports a stable classifier version string', () => {
  expect(typeof classifierVersion).toBe('string');
  expect(classifierVersion.length).toBeGreaterThan(0);
});

test('detects a swing when accelMag meets the threshold', () => {
  const detector = createSwingDetector();
  const result = detector.push(sample(0, SWING_LIMITS.start));
  expect(result).not.toBeNull();
  expect(result.label).toBe('Forehand');
  expect(result.complete).toBe(true);
});

test('returns null when accelMag is below threshold', () => {
  const detector = createSwingDetector();
  expect(detector.push(sample(0, SWING_LIMITS.start - 1))).toBeNull();
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
  // drop below threshold to reset the above flag
  expect(detector.push(sample(500, 0))).toBeNull();
  const second = detector.push(sample(1000, SWING_LIMITS.start));
  expect(second).not.toBeNull();
  expect(second.label).toBe('Forehand');
});

test('swing result includes startMs and peakTimeMs equal to the sample time', () => {
  const detector = createSwingDetector();
  const result = detector.push(sample(42, SWING_LIMITS.start));
  expect(result.startMs).toBe(42);
  expect(result.peakTimeMs).toBe(42);
});

test('ignores samples with non-finite timeMs or accelMag', () => {
  const detector = createSwingDetector();
  expect(detector.push({ timeMs: NaN, accelMag: 100 })).toBeNull();
  expect(detector.push({ timeMs: 0, accelMag: Infinity })).toBeNull();
  expect(detector.push({ timeMs: Infinity, accelMag: 100 })).toBeNull();
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

test('each fresh detector instance is independent', () => {
  const a = createSwingDetector();
  const b = createSwingDetector();
  expect(a.push(sample(0, SWING_LIMITS.start))).not.toBeNull();
  // b has no prior swing, so it should also fire
  expect(b.push(sample(0, SWING_LIMITS.start))).not.toBeNull();
});

test('SWING_LIMITS is frozen and has a numeric start', () => {
  expect(Object.isFrozen(SWING_LIMITS)).toBe(true);
  expect(typeof SWING_LIMITS.start).toBe('number');
});
