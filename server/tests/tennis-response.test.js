import { test, expect } from 'vitest';
import { createSwingStream } from '@wee/src/controller/swingStream.js';
import { tennisPower } from '@wee/src/controller/tennisPower.js';
import { isSwing, PROTOCOL_VERSION, COUNTDOWN_SECONDS, VOTE_SECONDS } from '@wee/shared/protocol.js';
import { RoomStore } from '@server/src/RoomStore.js';

function detect(ratesAt, fast = true) {
  const stream = createSwingStream('Right', { fast });
  const hits = [];
  for (let timeMs = 0; timeMs <= 900; timeMs += 20) {
    const [rotationAlpha, rotationBeta, rotationGamma] = ratesAt(timeMs);
    stream.push({ timeMs, rotationAlpha, rotationBeta, rotationGamma });
    hits.push(...stream.analyze().filter(hit => hit.label !== 'Unknown'));
  }
  return hits;
}

test('a deliberate gentle stroke from rest is confirmed before full completion', () => {
  const rates = time => time < 200 ? [0, 0, 0] : time < 340 ? [170, 310, 0]
    : time < 400 ? [80, 130, 0] : [0, 0, 0];
  const quick = detect(rates), complete = detect(rates, false);
  expect(quick).toHaveLength(1);
  expect(complete).toHaveLength(1);
  expect(quick[0].label).toBe('Forehand');
  expect(quick[0].fast).toBe(true);
  expect(quick[0].endMs).toBeLessThan(complete[0].endMs);
  expect(tennisPower(quick[0].peakRotation)).toBeLessThan(0.4);
});

test('small grip changes, an isolated jolt and missing readings cannot send a stroke', () => {
  expect(detect(() => [50, 90, 30])).toEqual([]);
  expect(detect(time => time === 240 ? [500, 900, 0] : [0, 0, 0])).toEqual([]);
  expect(detect(time => time === 240 ? [2000, 3000, 0] : [0, 0, 0])).toEqual([]);
  expect(detect(time => time >= 200 && time <= 240 ? [170, 310, 0]
    : time === 260 ? [null, 310, 0] : [0, 0, 0])).toEqual([]);
});

test('strength increases smoothly and saturates without non-finite output', () => {
  const powers = [280, 400, 700, 1000, 1200].map(tennisPower);
  for (let i = 1; i < powers.length; i++) expect(powers[i]).toBeGreaterThan(powers[i - 1]);
  expect(tennisPower(1200)).toBe(tennisPower(9000));
  expect(tennisPower(NaN)).toBe(0.5);
  expect(tennisPower(Infinity)).toBe(0.5);
});

test('the lobby forwards bounded strength only from the authenticated playing seat', () => {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  const { code } = store.createRoom('tv', { v: PROTOCOL_VERSION, sport: 'tennis' });
  store.join('phone', { v: PROTOCOL_VERSION, code, name: 'Player' });
  store.setSetup('phone', { setup: 'motion' });
  store.setReady('phone', { ready: true }); store.startGame('phone');
  now += COUNTDOWN_SECONDS * 1000;
  store.finishCountdown(code);
  now += VOTE_SECONDS * 1000;
  store.expireVote(code);
  const event = { type: 'swing', id: 'one', gameId: store.lobby(code).gameId, label: 'Forehand', hand: 'Right' };
  expect(isSwing(event)).toBe(true); // Old clients still work.
  expect(store.swingTarget('phone', { ...event, power: .3, player: 2 }).event)
    .toEqual({ ...event, power: .3, player: 1 });
  for (const power of [-1, 2, null, NaN, Infinity, '1']) {
    expect(store.swingTarget('phone', { ...event, power }).ok).toBe(false);
  }
  expect(store.swingTarget('stranger', { ...event, power: .3 }).ok).toBe(false);
  store.disconnect('tv');
  expect(store.swingTarget('phone', { ...event, power: .3 }).ok).toBe(false);
});
