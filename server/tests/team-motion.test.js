import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySwings } from '@wee/src/controller/classifySwing.js';
import { createSwingStream } from '@wee/src/controller/swingStream.js';

// Exact recordings from the teammate's 52597e7 branch; source attribution is
// next to the fixtures. Keep this separate from synthetic gesture coverage.
const cases = [
  ['two-forehands-one-backhand', 'Right', ['Forehand', 'Forehand', 'Backhand']],
  ['four-backhands', 'Right', Array(4).fill('Backhand')],
  ['left-mixed', 'Left', ['Forehand', 'Backhand', 'Forehand', 'Backhand']],
  ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
];
function replay(samples, hand, options = {}) {
  const stream = createSwingStream(hand, options);
  const events = [];
  for (const sample of samples) {
    stream.push(sample);
    events.push(...stream.analyze());
    assert.ok(stream.size <= 3000);
  }
  return { events, stream };
}
const actions = events => events.filter(event => event.label !== 'Unknown');

// Scale real recordings, retaining their timing and direction. These represent
// smaller strokes, not new device recordings. Direction must not depend on a
// single axis reaching the original hard-swing amplitude.
for (const [name, hand, expected] of cases) {
  test(`compact recorded strokes retain their labels without extra recovery shots: ${name}`, () => {
    const data = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url)));
    for (const gain of [.5, .65, .8]) {
      const samples = (data.samples ?? data).map(sample => ({...sample,
        rotationAlpha: sample.rotationAlpha * gain,
        rotationBeta: sample.rotationBeta * gain,
        rotationGamma: sample.rotationGamma * gain}));
      const actual = actions(replay(samples, hand, {fast: true}).events);
      assert.deepEqual(actual.map(event => event.label), expected, `gain=${gain}`);
    }
  });
}

// Browser replay exposed a missed backhand when corroborating samples arrived
// 15.4 ms apart. The same direction evidence must survive normal event jitter.
for (const [name, hand, expected] of cases) {
  test(`recorded stroke directions tolerate two milliseconds of delivery jitter: ${name}`, () => {
    const data = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url)));
    for (const gain of [.5, .65, .8, 1]) for (const phase of [-1, 1]) {
      const samples = (data.samples ?? data).map((sample, index) => ({...sample,
        timeMs: sample.timeMs + (index % 2 ? 2 : -2) * phase,
        rotationAlpha: sample.rotationAlpha * gain,
        rotationBeta: sample.rotationBeta * gain,
        rotationGamma: sample.rotationGamma * gain}));
      const actual = actions(replay(samples, hand, {fast: true}).events);
      assert.deepEqual(actual.map(event => event.label), expected, `gain=${gain}, phase=${phase}`);
    }
  });
}

test('compact right-hand backhands keep the live approach reading before the trigger threshold', () => {
  const data = JSON.parse(readFileSync(new URL('../fixtures/team-motion/four-backhands.json', import.meta.url)));
  const samples = (data.samples ?? data).map(sample => ({...sample,
    rotationAlpha: sample.rotationAlpha * .35,
    rotationBeta: sample.rotationBeta * .35,
    rotationGamma: sample.rotationGamma * .35}));
  const actual = actions(replay(samples, 'Right', {fast: true}).events);
  assert.deepEqual(actual.map(event => event.label), Array(4).fill('Backhand'));
  assert.ok(actual.every(event => event.fast && event.endMs - event.peakTimeMs <= 67));
});
// Detection lag after peak in the original base-game fast mode (ed0b85e).
// These are offline recording measurements, not network/render latency.
const previousFastLag = {
  'two-forehands-one-backhand': [133, 150, 134],
  'four-backhands': [100, 84, 117, 115],
  'left-mixed': [184, 117, 183, 113],
  'left-four-backhands-new': [117, 200, 84, 117],
  'left-four-forehands': [183, 251, 184, 183],
};
for (const [name, hand, expected] of cases) {
  test(`team recording keeps every stroke, label and peak with return suppression: ${name}`, () => {
    const data = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url)));
    const samples = data.samples ?? data;
    const complete = actions(classifySwings(samples, { hand }));
    assert.deepEqual(complete.map(event => event.label), expected);
    for (const fast of [false, true]) {
      const { events, stream } = replay(samples, hand, { fast, suppressReturns: true });
      const actual = actions(events);
      assert.deepEqual(actual.map(event => event.label), expected);
      assert.deepEqual(actual.map(event => event.peakTimeMs), complete.map(event => event.peakTimeMs));
      if (fast) {
        assert.ok(actual.every(event => event.fast));
        assert.ok(actual.every((event, index) => event.endMs < complete[index].endMs));
        assert.ok(actual.every((event, index) => event.endMs - event.peakTimeMs < previousFastLag[name][index]));
      }
      assert.equal(actions(stream.analyze(true)).length, 0, 'final flush cannot deliver a latched stroke twice');
      assert.deepEqual(stream.analyze(true), []);
    }
  });
}

test('recorded fast confirmation keeps bounded post-peak delay without waiting for rest', () => {
  const delays = [];
  for (const [name, hand] of cases) {
    const data = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url)));
    const samples = data.samples ?? data;
    const stream = createSwingStream(hand, {fast: true, suppressReturns: true});
    for (const sample of samples) {
      stream.push(sample);
      for (const event of stream.analyze()) if (event.label !== 'Unknown') {
        delays.push(sample.timeMs - event.peakTimeMs);
      }
    }
  }
  delays.sort((a, b) => a - b);
  assert.equal(delays.length, 19);
  // Fixture-clock timing only: neither network RTT nor motion-to-screen delay.
  assert.ok(delays[Math.floor(delays.length / 2)] <= 51);
  assert.ok(delays[Math.ceil(delays.length * .95) - 1] <= 100);
  assert.ok(delays.every(delay => delay >= 40), 'retain post-peak evidence before committing');
});

function samplesTo(durationMs, ratesAt) {
  return Array.from({ length: durationMs / 20 + 1 }, (_, index) => {
    const timeMs = index * 20;
    const [rotationAlpha, rotationBeta, rotationGamma] = ratesAt(timeMs);
    return { timeMs, rotationAlpha, rotationBeta, rotationGamma };
  });
}
test('fast confirmation does not reopen a long weak return as a fresh swing', () => {
  const samples = samplesTo(1500, timeMs => timeMs < 200 ? [600, 1200, 0]
    : timeMs >= 380 && timeMs < 1000 ? [-400, -300, 0] : [0, 0, 0]);
  const { events, stream } = replay(samples, 'Right', { fast: true });
  assert.deepEqual(actions(events).map(event => event.label), ['Forehand']);
  assert.deepEqual(stream.analyze(true), []);
});
test('continuous post-peak movement stays in one latched window until genuine relative rest', () => {
  const samples = samplesTo(2000, timeMs => timeMs < 200 ? [600, 1200, 0]
    : timeMs < 1000 ? [-400, -300, 0]
      : timeMs < 1200 ? [0, 0, 0]
        : timeMs < 1400 ? [600, 1200, 0] : [0, 0, 0]);
  const { events } = replay(samples, 'Right', { fast: true });
  assert.deepEqual(actions(events).map(event => event.label), ['Forehand', 'Forehand']);
  assert.deepEqual(actions(events).map(event => event.peakTimeMs), [0, 1200]);
});
test('unrecognized movement and gaps cannot synthesize a usable stroke', () => {
  const weak = samplesTo(1600, () => [40, 70, 20]);
  assert.equal(actions(replay(weak, 'Right', { fast: true }).events).length, 0);
  const broken = samplesTo(200, () => [600, 1200, 0]);
  broken[4].rotationAlpha = null;
  broken[8].timeMs = 1000;
  assert.equal(actions(replay(broken, 'Right', { fast: true }).events).length, 0);
});
test('experimental early delivery also needs real rest after a sensor interruption', () => {
  const stream = createSwingStream('Right', { early: true });
  const events = [];
  const push = (timeMs, active) => {
    stream.push({ timeMs, rotationAlpha: active ? 600 : 0,
      rotationBeta: active ? 1200 : 0, rotationGamma: 0 });
    events.push(...stream.analyze());
  };
  for (let timeMs = 0; timeMs <= 180; timeMs += 20) push(timeMs, true);
  for (let timeMs = 1000; timeMs <= 1200; timeMs += 20) push(timeMs, true);
  assert.equal(events.length, 1, 'missing samples must not rearm a delivered gesture');
  push(1220, false);
  push(2000, false); // This gap cannot count as 780 ms of rest.
  for (let timeMs = 2020; timeMs <= 2200; timeMs += 20) push(timeMs, true);
  assert.equal(events.length, 1);
  for (let timeMs = 2220; timeMs <= 2340; timeMs += 20) push(timeMs, false);
  for (let timeMs = 2360; timeMs <= 2540; timeMs += 20) push(timeMs, true);
  assert.equal(events.length, 2, 'continuous live quiet readings rearm the next stroke');
});
