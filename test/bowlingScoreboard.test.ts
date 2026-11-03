import {expect, test} from 'vitest';
import {BowlingMatch, FULL_RACK} from '../src/bowling/match';
import {awaitingBonus, createRollCallouts, frameMarks} from '../src/bowling/scoreboard';

test('ordinary frames retain two boxes, strike uses the second, and zero is a dash', () => {
  expect(frameMarks([], 0)).toEqual(['', '']);
  expect(frameMarks([10], 0)).toEqual(['', 'X']);
  expect(frameMarks([7], 0)).toEqual(['7', '']);
  expect(frameMarks([7, 3], 0)).toEqual(['7', '/']);
  expect(frameMarks([0, 6], 0)).toEqual(['–', '6']);
});

test('tenth frame shows all three deliveries with correct fill-roll spare marks', () => {
  expect(frameMarks([], 9)).toEqual(['', '', '']);
  expect(frameMarks([10, 10, 10], 9)).toEqual(['X', 'X', 'X']);
  expect(frameMarks([10, 7, 3], 9)).toEqual(['X', '7', '/']);
  expect(frameMarks([7, 3, 10], 9)).toEqual(['7', '/', 'X']);
  expect(frameMarks([8, 1], 9)).toEqual(['8', '1', '']);
});

test('only unresolved earned bonuses receive the pending indicator', () => {
  expect(awaitingBonus([], 0, null)).toBe(false);
  expect(awaitingBonus([6], 0, null)).toBe(false);
  expect(awaitingBonus([6, 2], 0, 8)).toBe(false);
  expect(awaitingBonus([10], 0, null)).toBe(true);
  expect(awaitingBonus([7, 3], 0, null)).toBe(true);
  expect(awaitingBonus([10], 0, 26)).toBe(false);
  expect(awaitingBonus([10, 10], 9, null)).toBe(true);
  expect(awaitingBonus([10, 10, 10], 9, 300)).toBe(false);
});

test('strike and spare announcements follow real completed rolls, not repeated snapshots', () => {
  const match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  const calls = createRollCallouts();
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([]);
  expect(calls.observe(match.getState(), false)).toEqual({kind: 'strike', player: 'Yit'});
  expect(calls.observe(match.getState(), false)).toBeNull();
  expect(calls.observe(match.getState(true), false)).toBeNull();
  match.record([1, 2, 3]);
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([]);
  expect(calls.observe(match.getState(), false)).toEqual({kind: 'spare', player: 'Yit'});
  expect(calls.observe(match.getState(), false)).toBeNull();
});

test('reload and paused snapshots never replay a stale celebration', () => {
  const match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  match.record([]);
  const calls = createRollCallouts();
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([]);
  expect(calls.observe(match.getState(), true)).toBeNull();
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([]);
  expect(calls.observe(match.getState(), false)).toEqual({kind: 'strike', player: 'Yit'});
});

test('a new match and consecutive identical strikes each get their own result once', () => {
  let match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  const calls = createRollCallouts();
  calls.observe(match.getState(), false);
  for (let i = 0; i < 3; i++) {
    match.record([]);
    expect(calls.observe(match.getState(), false)?.kind).toBe('strike');
  }
  calls.reset();
  match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([...FULL_RACK]);
  expect(calls.observe(match.getState(), false)).toBeNull();
  match.record([]);
  expect(calls.observe(match.getState(), false)?.kind).toBe('spare');
});

test('the tenth-frame fill spare is announced once and its cumulative total is resolved', () => {
  const match = new BowlingMatch([{player: 1, name: 'Yit'}]);
  const calls = createRollCallouts();
  calls.observe(match.getState(), false);
  for (let roll = 0; roll < 10; roll++) {
    match.record([]);
    calls.observe(match.getState(), false);
  }
  match.record([1, 2, 3]);
  expect(calls.observe(match.getState(), false)).toBeNull();
  const pending = match.getState().players[0];
  expect(awaitingBonus(pending.frames[9], 9, pending.frameScores[9])).toBe(true);
  match.record([]);
  const final = match.getState();
  expect(calls.observe(final, false)).toEqual({kind: 'spare', player: 'Yit'});
  expect(calls.observe(final, false)).toBeNull();
  expect(frameMarks(final.players[0].frames[9], 9)).toEqual(['X', '7', '/']);
  expect(final.players[0].frameScores[9]).toBe(287);
  expect(awaitingBonus(final.players[0].frames[9], 9, final.players[0].frameScores[9])).toBe(false);
});
