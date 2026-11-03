import { test } from 'vitest';
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

test('a fast delivery stays latched through its full motion window and sensor gaps cannot rearm it', () => {
  const stream = createSwingStream('Right', { fast: true });
  const events = [];
  const push = (timeMs, alpha = 0, beta = 0) => {
    stream.push({ timeMs, rotationAlpha: alpha, rotationBeta: beta, rotationGamma: 0 });
    events.push(...stream.analyze());
  };
  for (let timeMs = 0; timeMs <= 180; timeMs += 20) push(timeMs, 600, 1200);
  for (let timeMs = 200; timeMs <= 240; timeMs += 20) push(timeMs);
  assert.equal(events.length, 1);
  assert.equal(stream.phase, 'recovering');
  // A gap after fast confirmation is not evidence of a completed follow-through.
  for (let timeMs = 1000; timeMs <= 1200; timeMs += 20) push(timeMs, 600, 1200);
  assert.equal(stream.phase, 'waiting-for-rest');
  assert.equal(events.length, 1);
  for (let timeMs = 1220; timeMs <= 1340; timeMs += 20) push(timeMs);
  for (let timeMs = 1360; timeMs <= 1540; timeMs += 20) push(timeMs, 600, 1200);
  for (let timeMs = 1560; timeMs <= 1700; timeMs += 20) push(timeMs);
  assert.deepEqual(events.map(event => event.label), ['Forehand', 'Forehand']);
  assert.deepEqual(stream.analyze(true), []);
});

for (const early of [false, true]) {
  test(`gentler forehands and backhands work for both hands (${early ? 'early' : 'completion'})`, () => {
    for (const [hand, label, alpha, beta, gamma] of [
      ['Right', 'Forehand', 90, 270, 0],
      ['Right', 'Backhand', -240, -180, 0],
      ['Left', 'Forehand', 240, -160, -80],
      ['Left', 'Backhand', -300, -50, 20],
    ]) {
      const stream = createSwingStream(hand, { early });
      const results = [];
      for (let i = 0; i < 40; i++) {
        const active = i < 12;
        stream.push({ timeMs: i * 20, rotationAlpha: active ? alpha : 0,
          rotationBeta: active ? beta : 0, rotationGamma: active ? gamma : 0 });
        results.push(...stream.analyze());
      }
      assert.deepEqual(results.map(result => result.label), [label]);
    }
  });
}

test('small shakes and known left-hand return direction remain unclassified', () => {
  for (const early of [false, true]) {
    for (const rates of [[40, 70, 20], [-688, 250, 209]]) {
      const stream = createSwingStream('Left', { early });
      const results = [];
      for (let i = 0; i < 40; i++) {
        const active = i < 12;
        stream.push({ timeMs: i * 20, rotationAlpha: active ? rates[0] : 0,
          rotationBeta: active ? rates[1] : 0, rotationGamma: active ? rates[2] : 0 });
        results.push(...stream.analyze());
      }
      assert.ok(results.every(result => result.label === 'Unknown'));
    }
  }
});
