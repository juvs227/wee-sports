import {expect, test} from 'vitest';
import {createDiagnostics, browserDiagnostics, nativeDiagnostics} from '@wee/shared/diagnostics.js';

test('diagnostics are inert without explicit opt-in', () => {
  const target = {location: {search: ''}, performance: {now: () => 1}}; target.parent = target;
  const collector = browserDiagnostics('game', target);
  collector.count('hit'); collector.observe('delay', 25); collector.mark('one', 'send');
  expect(collector.snapshot()).toMatchObject({enabled: false, timings: {}, counters: {}, traces: []});
  expect(target.__weeDiagnostics).toBeUndefined();
  expect(nativeDiagnostics('native', target).enabled).toBe(false);
});

test('bounded same-clock traces expose p50 p95 p99 without mixing remote clocks', () => {
  let now = 0;
  const collector = createDiagnostics({enabled: true, scope: 'phone', now: () => now, capacity: 100});
  for (let i = 1; i <= 110; i++) collector.observe('localDelayMs', i);
  collector.mark('swing-1', 'send'); now = 25; collector.mark('swing-1', 'ack');
  collector.measure('swing-1', 'send', 'ack', 'roundTripMs');
  collector.remote('server', {timings: {processingMs: {count: 2, p50: 1, p95: 2, p99: 2, max: 2}},
    traces: [{id: 'swing-1', stages: {received: 100000, relayed: 100002}}], token: 'private'});
  const result = collector.snapshot();
  expect(result.timings.localDelayMs).toEqual({count: 100, p50: 60, p95: 105, p99: 109, max: 110});
  expect(result.timings.roundTripMs.p50).toBe(25);
  expect(result.remote.server.clock).toBe('remote-local');
  expect(result.timings.processingMs).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('private');
  collector.observe('invalid', -1); collector.observe('invalid', Infinity);
  collector.observe('invalid', 60001); collector.count('invalid', NaN);
  expect(collector.snapshot().timings.invalid).toBeUndefined();
});

test('trace, metric and remote payload sizes remain bounded', () => {
  const collector = createDiagnostics({enabled: true, capacity: 8});
  for (let i = 0; i < 1000; i++) {
    collector.mark(`id-${i}`, 'received'); collector.count(`count-${i}`); collector.observe(`timing-${i}`, 1);
  }
  collector.remote('untrusted', {timings: {bad: {count: 1000000, p50: -1}}, counters: {bad: -1},
    traces: [{id: 'bad input with spaces', stages: {a: 1}}, {id: 'good', stages: {data: 'token', received: 2}}]});
  const result = collector.snapshot();
  expect(result.traces).toHaveLength(128); expect(Object.keys(result.timings)).toHaveLength(64);
  expect(Object.keys(result.counters)).toHaveLength(64);
  expect(result.remote.untrusted).toMatchObject({timings: {}, counters: {}, traces: [{id: 'good', stages: {received: 2}}]});
  collector.clear(); expect(collector.snapshot().traces).toEqual([]);
});

test('iframe and native opt-ins expose separate local-clock scopes without visible UI', () => {
  const parent = {location: {search: '?diagnostics=1'}, performance: {now: () => 100}}; parent.parent = parent;
  browserDiagnostics('bridge', parent).observe('delayMs', 2);
  const child = {parent, location: {search: ''}, performance: {now: () => 5}};
  browserDiagnostics('game', child).observe('delayMs', 3);
  expect(parent.__weeDiagnostics.snapshot().scopes.game.timings.delayMs.p50).toBe(3);
  expect(parent.__weeDiagnostics.snapshot().scopes.bridge.timings.delayMs.p50).toBe(2);
  // Replacing an iframe replaces that clock's trace rather than correlating across reloads.
  const replacement = {...child, performance: {now: () => 0}};
  expect(browserDiagnostics('game', replacement).snapshot().timings).toEqual({});
  const native = {__WEE_DIAGNOSTICS__: true, performance: {now: () => 20}};
  expect(nativeDiagnostics('native', native).enabled).toBe(true);
  expect(native.__weeDiagnostics.snapshot().scopes.native.clock).toBe('local-monotonic');
});
