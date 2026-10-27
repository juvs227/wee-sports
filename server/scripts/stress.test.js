import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessStage, parseOptions } from './stress.js';

test('stress options reject unbounded, empty, or decreasing stages', () => {
  for (const value of ['0', '-1', '2001', '', '10,10', '50,25', '1,', 'NaN', '1.5']) {
    assert.throws(() => parseOptions(['--lobbies', value]));
  }
  assert.throws(() => parseOptions(['--seconds', 'Infinity']));
  assert.throws(() => parseOptions(['--seconds', '1', '--interval-ms', '1001']));
  assert.throws(() => parseOptions(['--url', 'https://example.com']));
  assert.deepEqual(parseOptions(['--lobbies', '1,100']).lobbies, [1, 100]);
});

const metrics = { attempted: 10, skipped: 0, errors: 0, setupErrors: 0,
  unexpectedDisconnects: 0, latenciesMs: [1, 2, 3, 4, 5, 6, 7, 8, 75, 100] };

test('stress pass criterion includes the 75 ms boundary and correct percentile', () => {
  const result = assessStage(metrics);
  assert.equal(result.passed, true);
  assert.equal(result.withinTargetFraction, 0.9);
  assert.equal(result.latencyMs.p90, 75);
  assert.equal(assessStage({ ...metrics, latenciesMs: [1, 2, 3, 4, 5, 6, 7, 76, 76, 100] }).passed, false);
});

test('lost or unscheduled traffic cannot make an overloaded stage pass', () => {
  for (const field of ['skipped', 'errors', 'setupErrors', 'unexpectedDisconnects']) {
    assert.equal(assessStage({ ...metrics, [field]: 1 }).passed, false);
  }
  const lost = assessStage({ ...metrics, attempted: 20 });
  assert.equal(lost.withinTargetFraction, 0.45);
  assert.equal(lost.passed, false);
  const empty = assessStage({ ...metrics, attempted: 0, latenciesMs: [] });
  assert.equal(empty.passed, false);
  assert.equal(empty.latencyMs.p90, null);
});
