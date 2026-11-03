import { test, expect } from 'vitest';
import { createSimpleSwingStream, createBowlingMotionDetector, bowlingTiltAim } from '../src/controller/motionGestures.js';

const sample = (timeMs, beta, alpha = 0, gamma = 0) => ({ timeMs,
  rotationAlpha: alpha, rotationBeta: beta, rotationGamma: gamma });

test('simple motion maps a deliberate swing to the chosen shot and suppresses follow-through', () => {
  const stream = createSimpleSwingStream('Backhand');
  const results = [];
  for (let time = 0; time <= 2000; time += 20) {
    const rate = time < 300 || time >= 1400 && time < 1700 ? 240 : time < 600 ? -240 : 0;
    stream.push(sample(time, rate));
    results.push(...stream.analyze());
  }
  expect(results.map(result => result.label)).toEqual(['Backhand', 'Backhand']);
});

test('simple motion rejects jitter and disconnected fragments', () => {
  const stream = createSimpleSwingStream();
  for (let time = 0; time <= 1000; time += 20) stream.push(sample(time, 60, 30));
  for (const time of [2000, 2020, 2040, 3000, 3020, 3040]) stream.push(sample(time, 300));
  expect(stream.analyze()).toEqual([]);
});

// Browser DeviceMotion mapping: alpha=X pitch, beta=Y wrist, gamma=Z yaw.
const bowlSample = (time, pitch, twist = 0) => sample(time, twist, pitch);

function delivery(peak = 360, transform = value => value) {
  const detector = createBowlingMotionDetector();
  const rolls = [];
  for (let time = 0; time <= 1600; time += 20) {
    const speed = time < 400 ? peak * Math.sin(Math.PI * time / 400) : 0;
    const result = detector.push(transform(bowlSample(time, speed)));
    if (result) rolls.push(result);
  }
  return rolls;
}

test('bowling underhand pitch releases once after slowing and scales power with speed', () => {
  const slow = delivery(260);
  const fast = delivery(600);
  expect(slow).toHaveLength(1);
  expect(fast).toHaveLength(1);
  expect(slow[0].power).toBeGreaterThanOrEqual(.2);
  expect(fast[0].power).toBeGreaterThan(slow[0].power);
  expect(fast[0].power).toBeLessThanOrEqual(1);
  expect(delivery(600, value => ({ ...value, rotationAlpha: -value.rotationAlpha }))).toHaveLength(1);
});

test('bowling ignores weak movement, sideways tennis strokes, and sensor gaps', () => {
  expect(delivery(60)).toEqual([]);
  expect(delivery(400, value => sample(value.timeMs, value.rotationAlpha, 20))).toEqual([]);
  const detector = createBowlingMotionDetector();
  const results = [];
  for (const time of [0, 20, 40, 60, 500, 520, 540, 560, 580, 600]) {
    const result = detector.push(bowlSample(time, time < 500 ? 400 : 0));
    if (result) results.push(result);
  }
  expect(results).toEqual([]);
});

test('bowling rejects a direction reversal before release and malformed sensor data', () => {
  const detector = createBowlingMotionDetector();
  for (const time of [0, 20, 40, 60, 80]) expect(detector.push(bowlSample(time, 400))).toBeNull();
  expect(detector.push(bowlSample(100, -400))).toBeNull();
  expect(detector.push(bowlSample(120, NaN))).toBeNull();
  for (let time = 140; time <= 500; time += 20) expect(detector.push(bowlSample(time, 0))).toBeNull();
});

test('wrist twist curves in either direction, ignores jitter and stays bounded', () => {
  const twist = gamma => delivery(400, value => ({ ...value, rotationBeta: gamma }))[0];
  expect(twist(0).spin).toBe(0);
  expect(twist(5).spin).toBe(0);
  expect(twist(20).spin).toBe(0);
  expect(twist(70).spin).toBeGreaterThan(0);
  expect(twist(70).spin).toBeLessThan(.15);
  expect(twist(-70).spin).toBeCloseTo(-twist(70).spin);
  expect(twist(150).spin).toBeLessThanOrEqual(.55);
  expect(twist(150).spin).toBeGreaterThan(twist(70).spin);
});

test('wrist movement after the forward swing does not add curve', () => {
  const lateTurn = delivery(400, value => ({ ...value, rotationBeta: value.timeMs > 340 ? 100 : 0 }));
  expect(lateTurn).toHaveLength(1);
  expect(lateTurn[0].spin).toBe(0);
});

test('power can use linear acceleration but works without it and never uses gravity', () => {
  const gyro = delivery(300)[0];
  const measured = delivery(300, value => ({ ...value, acceleration: { x: 0, y: 14, z: 0 } }))[0];
  expect(measured.power).toBeGreaterThan(gyro.power);
  expect(measured.power).toBeLessThanOrEqual(1);
  expect(delivery(300, value => ({ ...value, acceleration: { x: null, y: null, z: null } }))[0]).toEqual(gyro);
  expect(delivery(300, value => ({ ...value, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } }))[0]).toEqual(gyro);
  expect(delivery(0, value => ({ ...value, acceleration: { x: 30, y: 30, z: 30 } }))).toEqual([]);
});

test('wrist curve and power remain close at common sensor sampling rates', () => {
  const rolls = [30, 60, 100].map(hz => {
    const detector = createBowlingMotionDetector();
    for (let time = 0; time <= 1000; time += 1000 / hz) {
      const envelope = time < 400 ? Math.sin(Math.PI * time / 400) : 0;
      const result = detector.push(bowlSample(time, 400 * envelope, 100 * envelope));
      if (result) return result;
    }
  });
  expect(rolls.every(Boolean)).toBe(true);
  for (const roll of rolls) {
    expect(Math.abs(roll.power - rolls[0].power)).toBeLessThan(.03);
    expect(Math.abs(roll.spin - rolls[0].spin)).toBeLessThan(.1);
  }
});

test('tilt aims only from a still screen-up grip and clamps to the lane', () => {
  expect(bowlingTiltAim({ x: 0, y: 0, z: 9.8 }, 0)).toBe(0);
  expect(bowlingTiltAim({ x: -3, y: 0, z: 9.3 }, 10)).toBeGreaterThan(.3);
  expect(bowlingTiltAim({ x: 3, y: 0, z: 9.3 }, 10)).toBeLessThan(-.3);
  expect(bowlingTiltAim({ x: -.5, y: 0, z: 9.79 }, 10)).toBe(0);
  expect(bowlingTiltAim({ x: -7, y: 0, z: 7 }, 10)).toBe(1);
  for (const gravity of [null, { x: null, y: 0, z: 9.8 }, { x: 0, y: 9.8, z: 0 }, { x: 0, y: 0, z: 30 }]) {
    expect(bowlingTiltAim(gravity, 0)).toBeNull();
  }
  expect(bowlingTiltAim({ x: 0, y: 0, z: 9.8 }, 100)).toBeNull();
});
