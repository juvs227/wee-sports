import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwingStream } from '../src/controller/swingStream.js';

test('continuous play beyond ten seconds sends each swing once and bounds history', () => {
  const stream = createSwingStream('Right');
  const labels = [];
  for (let i = 0; i < 3600; i++) {
    const active = i % 60 < 10;
    stream.push({ timeMs: i * 20, rotationAlpha: active ? 300 : 0,
      rotationBeta: active ? 600 : 0, rotationGamma: 0 });
    if (i % 8 === 0) labels.push(...stream.analyze().map(swing => swing.label));
    assert.ok(stream.size <= 3000);
  }
  labels.push(...stream.analyze(true).map(swing => swing.label));
  assert.equal(labels.length, 60);
  assert.ok(labels.every(label => label === 'Forehand'));
  assert.deepEqual(stream.analyze(true), []);
});

test('idle time and long continuous movement do not grow the buffer indefinitely', () => {
  const stream = createSwingStream('Left');
  for (let i = 0; i < 10000; i++) {
    stream.push({ timeMs: i * 20, rotationAlpha: i < 5000 ? -1000 : 0,
      rotationBeta: 0, rotationGamma: 0 });
    if (i % 8 === 0) assert.deepEqual(stream.analyze(), []);
    assert.ok(stream.size <= 3000);
  }
});

test('early mode fires before rest, once per swing, then rearms', () => {
  const stream = createSwingStream('Right', { early: true });
  const events = [];
  for (let i = 0; i < 120; i++) {
    const active = i % 60 < 20;
    stream.push({ timeMs: i * 20, rotationAlpha: active ? 300 : 0,
      rotationBeta: active ? 600 : 0, rotationGamma: 0 });
    events.push(...stream.analyze());
  }
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.label === 'Forehand' && event.early && !event.complete));
  assert.ok(events.every(event => event.detectionDelayMs >= 110 && event.detectionDelayMs < 400));
  assert.deepEqual(stream.analyze(true), []);
});

test('early mode rejects weak motion and resets temporal evidence across sensor gaps', () => {
  const stream = createSwingStream('Left', { early: true });
  for (let i = 0; i < 50; i++) stream.push({ timeMs: i * 20, rotationAlpha: 10, rotationBeta: 20, rotationGamma: 0 });
  assert.deepEqual(stream.analyze(), []);
  for (const timeMs of [2000, 2020, 2040, 2060, 2080, 2500]) {
    stream.push({ timeMs, rotationAlpha: 900, rotationBeta: -400, rotationGamma: -200 });
  }
  assert.deepEqual(stream.analyze(), []);
});

for (const early of [true, false]) {
  test(`return suppression blocks follow-through and rearms (${early ? 'early' : 'completion'})`, () => {
    function run(suppressReturns) {
      const stream = createSwingStream('Right', { early, suppressReturns });
      const events = [];
      for (let timeMs = 0; timeMs <= 1500; timeMs += 20) {
        const forward = timeMs < 200 || (timeMs >= 1000 && timeMs < 1200);
        const returning = timeMs >= 380 && timeMs < 580;
        stream.push({ timeMs, rotationAlpha: forward ? 300 : returning ? -900 : 0,
          rotationBeta: forward ? 600 : returning ? -500 : 0, rotationGamma: 0 });
        events.push(...stream.analyze().filter(event => event.label !== 'Unknown'));
      }
      return { stream, events };
    }
    assert.deepEqual(run(true).events.map(event => event.label), ['Forehand', 'Forehand']);
    assert.deepEqual(run(false).events.map(event => event.label), ['Forehand', 'Backhand', 'Forehand']);
    assert.ok(run(true).stream.recoverySamples.length <= 150);
  });
}

test('recovery requires both cooldown and continuous quiet, and sensor gaps reset quiet evidence', () => {
  const stream = createSwingStream('Right', { early: true });
  for (let timeMs = 0; timeMs <= 180; timeMs += 20) {
    stream.push({ timeMs, rotationAlpha: 300, rotationBeta: 600, rotationGamma: 0 });
    stream.analyze();
  }
  assert.equal(stream.phase, 'recovering');
  for (let timeMs = 200; timeMs <= 460; timeMs += 20) {
    stream.push({ timeMs, rotationAlpha: 0, rotationBeta: 0, rotationGamma: 0 });
  }
  assert.equal(stream.phase, 'recovering'); // quiet enough, but not 400 ms since emission
  stream.push({ timeMs: 1000, rotationAlpha: 0, rotationBeta: 0, rotationGamma: 0 });
  assert.equal(stream.phase, 'recovering'); // gap must not count as quiet
  for (let timeMs = 1020; timeMs <= 1260; timeMs += 20) {
    stream.push({ timeMs, rotationAlpha: 0, rotationBeta: 0, rotationGamma: 0 });
  }
  assert.equal(stream.phase, 'ready');
});
