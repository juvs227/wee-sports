import { expect, test } from 'vitest';
import { RoomStore } from '@server/src/RoomStore.js';
import { COUNTDOWN_SECONDS, PROTOCOL_VERSION as v, VOTE_SECONDS } from '@wee/shared/protocol.js';

function fixture() {
  let now = 0;
  const store = new RoomStore({ now: () => now });
  function solo(prefix) {
    const host = store.createRoom(`${prefix}-tv`, { v, sport: 'tennis' });
    const phone = store.join(`${prefix}-phone`, { v, code: host.code, name: 'Player' });
    store.setSetup(`${prefix}-phone`, { setup: 'motion' });
    store.setReady(`${prefix}-phone`, { ready: true });
    now += COUNTDOWN_SECONDS * 1000;
    store.finishCountdown(host.code);
    now += VOTE_SECONDS * 1000;
    store.expireVote(host.code);
    const gameId = store.lobby(host.code).gameId;
    return { host, phone, gameId,
      input: id => store.swingTarget(`${prefix}-phone`, { type: 'swing', id, gameId, label: 'Forehand', hand: 'Right' }),
      result: id => ({ id, gameId, player: 1, result: 'hit', reason: 'Good contact', receivedToContactMs: 20 }),
    };
  }
  return { store, solo, advance: ms => { now += ms; } };
}

test('a host cannot route a diagnostic across rooms even when both rooms used the same input ID', () => {
  const { store, solo } = fixture();
  const a = solo('a'), b = solo('b');
  a.input('same-id'); b.input('same-id');
  expect(store.strokeResultTarget('a-tv', b.result('same-id')).ok).toBe(false);
  expect(store.strokeResultTarget('b-tv', a.result('same-id')).ok).toBe(false);
  expect(store.strokeResultTarget('a-tv', a.result('same-id')).phoneSocketId).toBe('a-phone');
  expect(store.strokeResultTarget('b-tv', b.result('same-id')).phoneSocketId).toBe('b-phone');
});

test('setup interruption clears pending diagnostics so they cannot replay after calibration/rehearsal', () => {
  const { store, solo } = fixture();
  const a = solo('a');
  a.input('before-setup');
  store.setSetup('a-phone', { setup: null });
  expect(store.strokeResultTarget('a-tv', a.result('before-setup')).error).toBe('paused');
  store.setSetup('a-phone', { setup: 'motion' });
  expect(store.strokeResultTarget('a-tv', a.result('before-setup')).error).toBe('unknown-stroke');
  a.input('after-setup');
  expect(store.strokeResultTarget('a-tv', a.result('after-setup')).ok).toBe(true);
});

test('host reconnect revokes the old socket and only results for new inputs are eligible', () => {
  const { store, solo } = fixture();
  const a = solo('a');
  a.input('before-disconnect');
  store.disconnect('a-tv');
  expect(store.resume('new-tv', { v, code: a.host.code, token: a.host.token, role: 'host' }).ok).toBe(true);
  expect(store.strokeResultTarget('a-tv', a.result('before-disconnect')).error).toBe('not-host');
  expect(store.strokeResultTarget('new-tv', a.result('before-disconnect')).error).toBe('unknown-stroke');
  a.input('after-reconnect');
  expect(store.strokeResultTarget('new-tv', a.result('after-reconnect')).phoneSocketId).toBe('a-phone');
});

test('pending diagnostics have a fixed capacity and cannot survive their age limit', () => {
  const { store, solo, advance } = fixture();
  const a = solo('a');
  for (let i = 0; i < 129; i++) a.input(`stroke-${i}`);
  expect(store.strokeResultTarget('a-tv', a.result('stroke-0')).error).toBe('unknown-stroke');
  expect(store.strokeResultTarget('a-tv', a.result('stroke-128')).ok).toBe(true);
  advance(5001);
  expect(store.strokeResultTarget('a-tv', a.result('stroke-127')).error).toBe('unknown-stroke');
});
