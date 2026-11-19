#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createSwingStream} from '../src/controller/swingStream.js';
import {normalizeWebMotion, toLegacyMotionSample} from '../shared/motion.js';

// Replays the original recordings on their recorded clock. This measures only
// detector confirmation; it is not a sensor, network, render or device benchmark.
const fixtures = [
  ['two-forehands-one-backhand', 'Right', ['Forehand', 'Forehand', 'Backhand']],
  ['four-backhands', 'Right', Array(4).fill('Backhand')],
  ['left-mixed', 'Left', ['Forehand', 'Backhand', 'Forehand', 'Backhand']],
  ['left-four-backhands-new', 'Left', Array(4).fill('Backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('Forehand')],
];
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--json' || !args[1])) {
  console.error('Usage: node scripts/replay-motion.mjs [--json output.json]');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
function summary(values) {
  if (!values.length) return {count: 0, minMs: null, medianMs: null, p95Ms: null, maxMs: null};
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    maxMs: sorted.at(-1),
  };
}
const results = [];
for (const [name, hand, expectedLabels] of fixtures) {
  const bytes = readFileSync(new URL(`../server/fixtures/team-motion/${name}.json`, import.meta.url));
  const parsed = JSON.parse(bytes);
  const samples = parsed.samples ?? parsed;
  assert.ok(Array.isArray(samples) && samples.length > 0, `${name}: missing samples`);
  const modes = [];
  for (const fast of [true, false]) {
    const stream = createSwingStream(hand, {fast, suppressReturns: true});
    const canonicalStream = createSwingStream(hand, {fast, suppressReturns: true});
    const actions = [];
    const canonicalActions = [];
    let unknownCount = 0;
    for (const [sequence, sample] of samples.entries()) {
      const normalized = normalizeWebMotion({rotationRate: {
        alpha: sample.rotationAlpha, beta: sample.rotationBeta, gamma: sample.rotationGamma,
      }}, {timeSeconds: sample.timeMs / 1000, sequence});
      const roundTrip = toLegacyMotionSample(normalized);
      assert.ok(roundTrip, `${name}: canonical adapter rejected a recorded sample`);
      canonicalStream.push(roundTrip);
      for (const event of canonicalStream.analyze()) if (event.label !== 'Unknown') {
        canonicalActions.push({label: event.label, peakTimeMs: event.peakTimeMs, confirmedAtSampleMs: sample.timeMs});
      }
      stream.push(sample);
      for (const event of stream.analyze()) {
        if (event.label === 'Unknown') { unknownCount++; continue; }
        assert.ok(Number.isFinite(event.peakTimeMs) && event.peakTimeMs <= sample.timeMs,
          `${name}: invalid peak clock`);
        actions.push({
          label: event.label,
          peakTimeMs: event.peakTimeMs,
          confirmedAtSampleMs: sample.timeMs,
          peakToConfirmationMs: sample.timeMs - event.peakTimeMs,
          detectorWindowEndMs: event.endMs,
        });
      }
      assert.ok(stream.size <= 3000, `${name}: unbounded detector buffer`);
    }
    assert.deepEqual(actions.map(event => event.label), expectedLabels, `${name}: ${fast ? 'fast' : 'completed'} labels`);
    const flushActions = stream.analyze(true).filter(event => event.label !== 'Unknown');
    assert.equal(flushActions.length, 0, `${name}: trailing flush must not synthesize or duplicate a stroke`);
    assert.equal(canonicalStream.analyze(true).filter(event => event.label !== 'Unknown').length, 0,
      `${name}: canonical roundtrip must not synthesize trailing strokes`);
    assert.deepEqual(canonicalActions.map(event => event.label), expectedLabels,
      `${name}: canonical adapter must preserve every stroke label`);
    const peakErrors = canonicalActions.map((event, index) => Math.abs(event.peakTimeMs - actions[index].peakTimeMs));
    const confirmationErrors = canonicalActions.map((event, index) => Math.abs(event.confirmedAtSampleMs - actions[index].confirmedAtSampleMs));
    assert.ok(peakErrors.every(error => error < 1e-6) && confirmationErrors.every(error => error < 1e-6),
      `${name}: canonical unit conversion changed detector timing`);
    modes.push({mode: fast ? 'fast' : 'completed', unknownCount, actions,
      canonicalRoundTrip: {adapter: 'shared/motion.js: browser degrees → SI radians → legacy degrees',
        samples: samples.length, strokes: canonicalActions.length, labelsMatch: true,
        maxPeakErrorMs: Math.max(...peakErrors), maxConfirmationErrorMs: Math.max(...confirmationErrors)},
      peakToConfirmation: summary(actions.map(event => event.peakToConfirmationMs))});
  }
  results.push({name, hand, samples: samples.length, expectedLabels,
    sha256: digest('sha256', bytes),
    gitBlobSha1: digest('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])),
    modes});
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  runtime: process.version,
  detectorSources: ['src/controller/swingStream.js', 'src/controller/classifySwing.js', 'shared/motion.js'].map(path => ({
    path, sha256: digest('sha256', readFileSync(new URL(`../${path}`, import.meta.url))),
  })),
  measurement: 'Recorded peak to first online stream emission on the fixture clock; milliseconds.',
  limitation: 'Five selected recordings, 19 expected strokes. No physical device, sensor delivery, network, rendering or haptic timing was measured. This is not a general accuracy benchmark.',
  summaries: ['fast', 'completed'].map(mode => ({mode,
    ...summary(results.flatMap(result => result.modes.find(item => item.mode === mode).actions.map(action => action.peakToConfirmationMs)))})),
  fixtures: results,
};
if (args[1]) writeFileSync(args[1], `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
console.log(`PASS: ${results.length} recordings, 19 expected strokes in each detector mode`);
console.log('PASS: canonical SI adapter roundtrip preserves every recorded label, peak and online confirmation time');
for (const result of report.summaries) {
  console.log(`${result.mode}: n=${result.count}; min=${result.minMs} ms; median=${result.medianMs} ms; p95=${result.p95Ms} ms; max=${result.maxMs} ms`);
}
console.log(report.limitation);
if (args[1]) console.log(`Evidence written to ${args[1]} (existing files are never overwritten).`);
