import { expect, test } from 'vitest';
import { RoomStore } from './src/RoomStore.js';
import { PROTOCOL_VERSION as v, isStrokeResult, isGameSoundEvent } from '../shared/protocol.js';
import { createTimingStats } from '../src/network/timingStats.js';

function game() {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const { code } = store.createRoom('tv', { v, sport: 'tennis' });
  store.join('phone', { v, code, name: 'Player' });
  store.setSetup('phone', { setup: 'motion' }); store.setReady('phone', { ready: true });
  store.start('tv'); now = 5000; store.finishCountdown(code);
  const gameId = store.lobby(code).gameId;
  const input = id => store.swingTarget('phone', { type: 'swing', id, gameId, label: 'Forehand', hand: 'Right', power: .5 });
  const result = { id: 'stroke', gameId, player: 1, result: 'hit', reason: 'Good contact', receivedToContactMs: 84 };
  return { store, code, input, result, advance: value => { now += value; } };
}

test('contact diagnostics require a real current input and authenticated host; only the matching phone receives them', () => {
  const { store, code, input, result } = game();
  expect(store.strokeResultTarget('tv', result).ok).toBe(false);
  expect(input(result.id).ok).toBe(true);
  expect(store.strokeResultTarget('phone', result).error).toBe('not-host');
  expect(store.strokeResultTarget('tv', { ...result, player: 2 }).ok).toBe(false);
  expect(store.strokeResultTarget('tv', { ...result, gameId: 'old' }).ok).toBe(false);
  expect(store.strokeResultTarget('tv', { ...result, token: 'do not expose', type: 'ignored' })).toEqual({
    ok: true, phoneSocketId: 'phone', event: result,
  });
  expect(store.strokeResultTarget('tv', result).ok).toBe(false);
  expect(JSON.stringify(store.lobby(code))).not.toContain('stroke');
});

test('old or paused diagnostic events never replay after reconnect', () => {
  const { store, input, result, advance } = game();
  input(result.id); advance(5001);
  expect(store.strokeResultTarget('tv', result).ok).toBe(false);
  input('fresh'); store.disconnect('phone');
  expect(store.strokeResultTarget('tv', { ...result, id: 'fresh' }).error).toBe('paused');
  for (const invalid of [null, {}, { ...result, receivedToContactMs: Infinity },
    { ...result, result: 'miss' }, { ...result, reason: 'x'.repeat(161) }]) {
    expect(isStrokeResult(invalid)).toBe(false);
  }
});

test('timing summaries have bounded samples, median and slow-tail values without clock subtraction', () => {
  const stats = createTimingStats(4);
  expect(stats.summary()).toBeNull();
  for (const value of [10, 20, 30, 100]) stats.add(value);
  expect(stats.summary()).toEqual({ count: 4, median: 25, p95: 100 });
  stats.add(40); stats.add(-1); stats.add(NaN);
  expect(stats.summary()).toEqual({ count: 4, median: 35, p95: 100 });
  stats.clear(); expect(stats.summary()).toBeNull();
});

test('game audio is limited to known sport events', () => {
  expect(isGameSoundEvent('tennis', 'serve')).toBe(true);
  expect(isGameSoundEvent('bowling', 'roll-end')).toBe(true);
  expect(isGameSoundEvent('tennis', 'roll')).toBe(false);
  expect(isGameSoundEvent('unknown', 'hit')).toBe(false);
  expect(isGameSoundEvent('tennis', '/external/audio.mp3')).toBe(false);
});
