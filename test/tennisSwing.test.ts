import { test, expect } from 'vitest';
import { createSwingDetector, SWING_LIMITS } from '../src/controller/classifySwing.js';

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

// check if can correctly categorize a swing as a forehand or backhand
// sample normal vector
// if facing the same way, forehand
// if facing the opposite way, backhand

// initialize with a sample normal vector
// create a swing detector
// and push a sample

// do this in 2 different directions verify

const swing = (netNormal: [number, number, number], currentNormal: [number, number, number]) =>
  createSwingDetector().push({
    timeMs: 0,
    accelMag: SWING_LIMITS.start,
    netOrientation: { normal: netNormal },
    currentNormal,
  } as any);

// facing east (net normal [1,0,0])
test('forehand when facing same direction as net — east', () => {
  expect(swing([1, 0, 0], [1, 0, 0])!.label).toBe('Forehand');
});
test('backhand when facing opposite to net — east', () => {
  expect(swing([1, 0, 0], [-1, 0, 0])!.label).toBe('Backhand');
});

// facing north (net normal [0,1,0])
test('forehand when facing same direction as net — north', () => {
  expect(swing([0, 1, 0], [0, 1, 0])!.label).toBe('Forehand');
});
test('backhand when facing opposite to net — north', () => {
  expect(swing([0, 1, 0], [0, -1, 0])!.label).toBe('Backhand');
});

// verify classification stays consistent across many swings with the same orientation
test('forehand classification stays consistent across 20 swings', () => {
  const detector = createSwingDetector();
  const netNormal: [number, number, number] = [0, 1, 0];
  const currentNormal: [number, number, number] = [0, 1, 0];
  const results = [];
  for (let i = 0; i < 20; i++) {
    const t = i * 1100; // spaced beyond cooldown
    detector.push({ timeMs: t, accelMag: 0, netOrientation: { normal: netNormal }, currentNormal } as any);
    const r = detector.push({ timeMs: t + 10, accelMag: SWING_LIMITS.start, netOrientation: { normal: netNormal }, currentNormal } as any);
    if (r) results.push(r.label);
  }
  expect(results).toHaveLength(20);
  expect(results.every(l => l === 'Forehand')).toBe(true);
});

test('backhand classification stays consistent across 20 swings', () => {
  const detector = createSwingDetector();
  const netNormal: [number, number, number] = [0, 1, 0];
  const currentNormal: [number, number, number] = [0, -1, 0];
  const results = [];
  for (let i = 0; i < 20; i++) {
    const t = i * 1100;
    detector.push({ timeMs: t, accelMag: 0, netOrientation: { normal: netNormal }, currentNormal } as any);
    const r = detector.push({ timeMs: t + 10, accelMag: SWING_LIMITS.start, netOrientation: { normal: netNormal }, currentNormal } as any);
    if (r) results.push(r.label);
  }
  expect(results).toHaveLength(20);
  expect(results.every(l => l === 'Backhand')).toBe(true);
});
