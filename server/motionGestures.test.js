import { test, expect } from 'vitest';
import { createSimpleSwingStream, createBowlingMotionDetector } from '../src/controller/motionGestures.js';

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

function delivery(peak = 360, transform = value => value) {
  const detector = createBowlingMotionDetector();
  const rolls = [];
  for (let time = 0; time <= 1600; time += 20) {
    const speed = time < 400 ? peak * Math.sin(Math.PI * time / 400) : 0;
    const result = detector.push(transform(sample(time, speed)));
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
  expect(delivery(600, value => ({ ...value, rotationBeta: -value.rotationBeta }))).toHaveLength(1);
});

test('bowling ignores weak movement, sideways tennis strokes, and sensor gaps', () => {
  expect(delivery(60)).toEqual([]);
  expect(delivery(400, value => sample(value.timeMs, 20, value.rotationBeta))).toEqual([]);
  const detector = createBowlingMotionDetector();
  const results = [];
  for (const time of [0, 20, 40, 60, 500, 520, 540, 560, 580, 600]) {
    const result = detector.push(sample(time, time < 500 ? 400 : 0));
    if (result) results.push(result);
  }
  expect(results).toEqual([]);
});

test('bowling rejects a direction reversal before release and malformed sensor data', () => {
  const detector = createBowlingMotionDetector();
  for (const time of [0, 20, 40, 60, 80]) expect(detector.push(sample(time, 400))).toBeNull();
  expect(detector.push(sample(100, -400))).toBeNull();
  expect(detector.push(sample(120, NaN))).toBeNull();
  for (let time = 140; time <= 500; time += 20) expect(detector.push(sample(time, 0))).toBeNull();
});
