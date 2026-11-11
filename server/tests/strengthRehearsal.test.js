import { expect, test } from 'vitest';
import { createStrengthRehearsal, fitStrengthProfile } from '@wee/src/controller/strengthRehearsal.js';
import { tennisPower } from '@wee/src/controller/tennisPower.js';

const stroke = (label, peakRotation, startMs = 0) => ({ label, peakRotation, startMs,
  endMs: startMs + 300, complete: true });
const samples = (forehand = [400, 450, 420], backhand = [700, 720, 750]) => [
  ...forehand.map(peak => stroke('Forehand', peak)), ...backhand.map(peak => stroke('Backhand', peak)),
];

test('power rehearsals require three consistent, bounded samples of each stroke and a valid hand', () => {
  expect(fitStrengthProfile('Right', samples())).toEqual({ hand: 'Right', Forehand: 1.75, Backhand: 740 / 720 });
  for (const peaks of [[200, 400, 450], [400, Infinity, 450], [400, 1100, 450], [1700, 1800, 1750]]) {
    expect(fitStrengthProfile('Right', samples(peaks))).toBeNull();
  }
  expect(fitStrengthProfile('Right', samples().slice(0, 5))).toBeNull();
  expect(fitStrengthProfile('Other', samples())).toBeNull();
});

test('personalized power stays bounded and monotonic without changing the default curve', () => {
  const profile = fitStrengthProfile('Right', samples());
  expect(tennisPower(420, profile, 'Forehand')).toBeGreaterThan(tennisPower(420));
  let previous = 0;
  for (let peak = 0; peak <= 2000; peak += 10) {
    const power = tennisPower(peak, profile, 'Forehand');
    expect(power).toBeGreaterThanOrEqual(previous);
    expect(power).toBeGreaterThanOrEqual(0.2);
    expect(power).toBeLessThanOrEqual(1);
    previous = power;
  }
  expect(tennisPower(1200)).toBe(1);
  expect(tennisPower(280)).toBe(0.2);
  expect(tennisPower(NaN, profile)).toBe(.5);
  expect(tennisPower(400, { Forehand: NaN })).toBe(tennisPower(400));
  expect(tennisPower(400, { Forehand: 100 })).toBe(tennisPower(400, { Forehand: 1.75 }));
});

test('rehearsal teaches forehands then backhands and produces a profile only after six completed strokes', () => {
  const rehearsal = createStrengthRehearsal('Left', 1000);
  let status;
  samples().forEach((sample, index) => {
    status = rehearsal.accept({ ...sample, startMs: index * 1000, endMs: index * 1000 + 300 }, 2000 + index * 1000);
    expect(status.count).toBe(index + 1);
    if (index < 5) expect(status.profile).toBeNull();
  });
  expect(status.state).toBe('complete');
  expect(status.profile.hand).toBe('Left');
  expect(rehearsal.accept(stroke('Backhand', 1000, 8000), 10000).count).toBe(6);
});

test('unknown, early, simple, wrong-direction and duplicate strokes cannot train the profile', () => {
  const rehearsal = createStrengthRehearsal('Right', 0);
  for (const overrides of [{ label: 'Unknown' }, { fast: true }, { early: true }, { simple: true }, { complete: false },
    { startMs: NaN }, { endMs: 20 }, { peakRotation: 2000 }, { label: 'Backhand' }]) {
    expect(rehearsal.accept({ ...stroke('Forehand', 500), ...overrides }, 500).count).toBe(0);
  }
  const first = stroke('Forehand', 500, 1000);
  expect(rehearsal.accept(first, 1500).count).toBe(1);
  expect(rehearsal.accept(first, 1600).count).toBe(1);
});

test('inconsistent completed swings fail clearly; insufficient rehearsal times out without a profile', () => {
  const rehearsal = createStrengthRehearsal('Right', 0);
  samples([300, 1000, 600]).forEach((sample, index) => rehearsal.accept({ ...sample, startMs: index * 1000, endMs: index * 1000 + 300 }, index * 1000));
  expect(rehearsal.read(7000)).toMatchObject({ state: 'failed', profile: null });
  const incomplete = createStrengthRehearsal('Right', 5000);
  incomplete.accept(stroke('Forehand', 500), 6000);
  expect(incomplete.read(65_000)).toMatchObject({ state: 'failed', profile: null, count: 1 });
});
