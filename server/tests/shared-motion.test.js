import {describe, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DEG_TO_RAD, normalizeWebMotion, normalizeNativeGyroscope, toLegacyMotionSample, createTimeConstantFilter, createMotionCalibration, applyMotionCalibration, createRelativeAimController, createMotionRecorder, rotateVectorToScreen, orientationFromWebEvent, isMotionSample} from '@wee/shared/motion.js';
import {createWebMotionAdapter, readLegacyWebMotion} from '@wee/src/controller/webMotionAdapter.js';
import {createSwingStream} from '@wee/src/controller/swingStream.js';
import {createBowlingMotionDetector} from '@wee/src/controller/motionGestures.js';


const options = (timeSeconds = 0, sequence = Math.round(timeSeconds * 1000)) => ({timeSeconds, sequence});
const native = (time, reading = {x: 0, y: 0, z: 0}, more = {}) => normalizeNativeGyroscope(reading, {...options(time), ...more});

test('browser/native gyro units and all three axes agree without changing legacy rates', () => {
  const web = normalizeWebMotion({rotationRate: {alpha: 180, beta: 90, gamma: -45}}, options(1));
  const app = native(1, {x: Math.PI, y: Math.PI / 2, z: -Math.PI / 4});
  expect(web).toEqual(app);
  expect(toLegacyMotionSample(web)).toEqual({timeMs: 1000, rotationAlpha: 180, rotationBeta: 90, rotationGamma: -45});
  expect(readLegacyWebMotion({rotationRate: {alpha: 180, beta: 90, gamma: -45}},
    {timeMs: 1000, timeOriginMs: 500, bias: {alpha: 1, beta: 2, gamma: 3}}).legacy)
    .toEqual({timeMs: 500, rotationAlpha: 179, rotationBeta: 88, rotationGamma: -48});
});

test('missing sensor measurements remain absent and gravity is not confused with linear acceleration', () => {
  expect(normalizeWebMotion({rotationRate: {alpha: null, beta: 0, gamma: 0}}, options())).toBeNull();
  const totalOnly = normalizeWebMotion({accelerationIncludingGravity: {x: 1, y: 2, z: 9.8}}, options());
  expect(totalOnly.angularVelocity).toBeUndefined();
  expect(totalOnly.acceleration).toBeUndefined();
  expect(totalOnly.gravity).toBeUndefined();
  expect(toLegacyMotionSample(totalOnly)).toBeNull();
  const both = normalizeWebMotion({accelerationIncludingGravity: {x: 1, y: 2, z: 10.8}, acceleration: {x: 1, y: 2, z: 1}}, options());
  expect(both.gravity).toEqual({x: 0, y: 0, z: 9.8});
  expect(normalizeNativeGyroscope({x: Infinity, y: 0, z: 0}, options())).toBeNull();
  expect(isMotionSample({...native(0), orientation: {x: 0, y: 0, z: 0, w: 9}})).toBe(false);
});

for (const [fixture, hand] of [['two-forehands-one-backhand', 'Right'], ['four-backhands', 'Right'],
  ['left-mixed', 'Left'], ['left-four-backhands-new', 'Left'], ['left-four-forehands', 'Left']]) {
  test(`normalized recording retains every tennis label and peak: ${fixture}`, () => {
    const data = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${fixture}.json`, import.meta.url)));
    const samples = data.samples ?? data;
    const original = createSwingStream(hand, {fast: true}), canonical = createSwingStream(hand, {fast: true});
    const before = [], after = [];
    samples.forEach((sample, sequence) => {
      original.push(sample);
      const normalized = normalizeWebMotion({rotationRate: {alpha: sample.rotationAlpha, beta: sample.rotationBeta, gamma: sample.rotationGamma}},
        {timeSeconds: sample.timeMs / 1000, sequence});
      canonical.push(toLegacyMotionSample(normalized));
      before.push(...original.analyze()); after.push(...canonical.analyze());
    });
    expect(after.map(event => event.label)).toEqual(before.map(event => event.label));
    expect(after.length).toBeGreaterThan(0);
    after.forEach((event, i) => expect(event.peakTimeMs).toBeCloseTo(before[i].peakTimeMs, 8));
  });
}

test('native/browser equivalent bowling traces reject backswing and preserve forward release power', () => {
  const webDetector = createBowlingMotionDetector(), appDetector = createBowlingMotionDetector();
  const webResults = [], appResults = [];
  for (let ms = 0; ms <= 1000; ms += 20) {
    const alpha = ms < 200 ? -500 : ms < 400 ? 0 : ms < 700 ? 300 : 0;
    const web = normalizeWebMotion({rotationRate: {alpha, beta: 0, gamma: 0}}, options(ms / 1000));
    const app = native(ms / 1000, {x: alpha * DEG_TO_RAD, y: 0, z: 0});
    const a = webDetector.push(toLegacyMotionSample(web)), b = appDetector.push(toLegacyMotionSample(app));
    if (a) webResults.push({ms, ...a}); if (b) appResults.push({ms, ...b});
  }
  expect(webResults).toEqual(appResults);
  expect(webResults).toHaveLength(1);
  expect(webResults[0].ms).toBeGreaterThanOrEqual(700);
});

test('time-constant filtering reaches the same response at 30, 60 and 100Hz', () => {
  const results = [30, 60, 100].map(hz => {
    const filter = createTimeConstantFilter({timeConstantSeconds: .084}); filter.reset(0, 0);
    for (let i = 1; i <= hz; i++) filter.push(1, i / hz);
    return filter.value;
  });
  expect(results[0]).toBeCloseTo(results[1], 12); expect(results[1]).toBeCloseTo(results[2], 12);
  const filter = createTimeConstantFilter(); filter.reset(0, 0); filter.push(1, .1);
  const value = filter.value;
  expect(filter.push(-1, .09)).toBe(value); expect(filter.push(-1, .1)).toBe(value);
  expect(filter.push(-1, 1)).toBe(-1);
});

test('calibration needs continuous stillness; moving, missing and rotated samples cannot qualify', () => {
  const calibration = createMotionCalibration({durationSeconds: 1, revision: 4});
  let result;
  for (let i = 0; i <= 60; i++) result = calibration.push(native(i / 60, {x: .01, y: 0, z: 0}));
  expect(result.state).toBe('done');
  const corrected = applyMotionCalibration(native(2, {x: .11, y: 0, z: 0}), result.calibration);
  expect(corrected.angularVelocity.x).toBeCloseTo(.1);
  expect(corrected.calibrationRevision).toBe(4);
  expect(applyMotionCalibration(native(2, {x: 0, y: 0, z: 0}, {screenAngle: 90}), result.calibration)).toBeNull();
  calibration.reset();
  for (let i = 0; i <= 60; i++) result = calibration.push(native(i / 60, {x: i % 2 ? 1 : -1, y: 0, z: 0}));
  expect(result.state).toBe('moving');
  calibration.reset();
  for (let i = 0; i < 30; i++) calibration.push(native(i / 60));
  expect(calibration.push(native(3)).progress).toBe(0);
});

test('paddle screen coordinates are independent of hand; gaps and recenter never create a stroke', () => {
  const rotated = rotateVectorToScreen({x: 1, y: 0, z: 0}, 90);
  expect(rotated.x).toBeCloseTo(0); expect(rotated.y).toBeCloseTo(-1);
  const right = createRelativeAimController(), left = createRelativeAimController({hand: 'Left'});
  const first = native(0, {x: 0, y: 5, z: 0});
  expect(right.push(first).angularVelocity).toEqual({x: 0, y: 0, z: 0}); left.push(first);
  const second = native(.01, {x: 0, y: 5, z: 0});
  expect(right.push(second)).toEqual(left.push(second));
  expect(right.push(second)).toBeNull();
  expect(right.push(native(1, {x: 0, y: 5, z: 0})).angularVelocity).toEqual({x: 0, y: 0, z: 0});
  right.recenter();
  expect(right.push(native(1.01, {x: 0, y: 5, z: 0})).orientation).toEqual([0, 0, 0, 1]);
  expect(right.push(native(1.02, {x: 0, y: 5, z: 0}, {calibrationRevision: 1})).angularVelocity).toEqual({x: 0, y: 0, z: 0});
});

test('the same measured relative pose has identical paddle intent for either hand', () => {
  const right = createRelativeAimController({hand: 'Right'});
  const left = createRelativeAimController({hand: 'Left'});
  const initial = native(0, {x: 0, y: 0, z: 0}, {
    orientation: orientationFromWebEvent({alpha: 35, beta: 25, gamma: -10}), screenAngle: 90,
  });
  right.push(initial); left.push(initial);
  const movement = native(.02, {x: .5, y: 1, z: -.25}, {
    orientation: orientationFromWebEvent({alpha: 38, beta: 32, gamma: -15}), screenAngle: 90,
  });
  const pose = right.push(movement);
  expect(pose).toEqual(left.push(movement));
  expect(Math.hypot(pose.reach.x, pose.reach.y)).toBeGreaterThan(.01);
});

test('relative orientation crosses 360 degrees without an Euler discontinuity', () => {
  const controller = createRelativeAimController();
  controller.push(native(0, {x: 0, y: 0, z: 1}, {orientation: orientationFromWebEvent({alpha: 359, beta: 0, gamma: 0})}));
  const pose = controller.push(native(.01, {x: 0, y: 0, z: 1}, {orientation: orientationFromWebEvent({alpha: 1, beta: 0, gamma: 0})}));
  expect(Math.abs(pose.orientation[2])).toBeLessThan(.02);
  expect(Math.abs(pose.orientation[3])).toBeGreaterThan(.99);
});

test('cached browser attitude does not freeze gyro aim between slower orientation events', async () => {
  const target = new EventTarget(), document = new EventTarget();
  Object.assign(target, {isSecureContext: true, DeviceMotionEvent: {}, screen: {orientation: {angle: 0}}});
  document.hidden = false;
  let time = 0;
  const poses = [], paddle = createRelativeAimController();
  const adapter = createWebMotionAdapter({target, document, clock: () => time,
    onSample: value => poses.push(paddle.push(value))});
  await adapter.start();
  try {
    for (let i = 0; i <= 60; i++) {
      time = i / 60;
      if (i % 6 === 0) target.dispatchEvent(Object.assign(new Event('deviceorientation'), {alpha: 0, beta: 0, gamma: time * 20}));
      target.dispatchEvent(Object.assign(new Event('devicemotion'), {rotationRate: {alpha: 0, beta: 20, gamma: 0}}));
    }
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i].reach.x - poses[i - 1].reach.x).toBeGreaterThan(.005);
      expect(poses[i].reach.x).toBeCloseTo(2 * Math.sin(i / 60 * 20 * DEG_TO_RAD / 2), 8);
    }
  } finally {adapter.dispose();}
});

test('attitude arriving after gyro setup anchors without changing the existing aim', () => {
  for (const screenAngle of [0, 90]) {
    const paddle = createRelativeAimController();
    const rate = {x: 0, y: .5, z: 0};
    for (let i = 0; i <= 10; i++) paddle.push(native(i * .02, rate, {screenAngle}));
    const baseline = createRelativeAimController();
    for (let i = 0; i <= 10; i++) baseline.push(native(i * .02, rate, {screenAngle}));
    const pose = paddle.push(native(.22, rate, {screenAngle,
      orientation: orientationFromWebEvent({alpha: 30, beta: 20, gamma: 15}), orientationTimeSeconds: .22}));
    const integrated = baseline.push(native(.22, rate, {screenAngle}));
    pose.orientation.forEach((value, index) => expect(value).toBeCloseTo(integrated.orientation[index], 10));
    // A newer measured attitude continues from that anchor, rather than being ignored forever.
    const next = paddle.push(native(.24, {x: 0, y: 0, z: 0}, {screenAngle,
      orientation: orientationFromWebEvent({alpha: 30, beta: 20, gamma: 25}), orientationTimeSeconds: .24}));
    expect(Math.hypot(next.reach.x - pose.reach.x, next.reach.y - pose.reach.y)).toBeGreaterThan(.1);
  }
});

test('bounded opt-in traces contain only motion fields and cannot retain tokens', () => {
  const recorder = createMotionRecorder({maxSamples: 2});
  for (let i = 0; i < 3; i++) recorder.record({...native(i), token: 'private', angularVelocity: {x: 0, y: 0, z: 0, token: 'private'}});
  const trace = recorder.export();
  expect(trace.samples).toHaveLength(2); expect(trace.samples[0].sequence).toBe(1000);
  expect(JSON.stringify(trace)).not.toContain('private');
  trace.samples.length = 0; expect(recorder.export().samples).toHaveLength(2);
});

describe('browser adapter', () => {
  function fixture() {
    let time = 0;
    const target = new EventTarget(), document = new EventTarget();
    Object.assign(target, {isSecureContext: true, DeviceMotionEvent: {}, screen: {orientation: {angle: 0}}});
    document.hidden = false;
    const samples = [], resets = [];
    const adapter = createWebMotionAdapter({target, document, clock: () => time, onSample: s => samples.push(s), onReset: r => resets.push(r)});
    const emit = () => {time += .02; target.dispatchEvent(Object.assign(new Event('devicemotion'), {rotationRate: {alpha: 0, beta: 1, gamma: 2}}));};
    return {target, document, samples, resets, adapter, emit};
  }
  test('listeners suspend on background/pagehide and are removed on dispose', async () => {
    const f = fixture(); await f.adapter.start(); f.emit(); expect(f.samples).toHaveLength(1);
    f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); f.emit(); expect(f.samples).toHaveLength(1);
    f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); f.emit(); expect(f.samples).toHaveLength(2);
    f.target.dispatchEvent(new Event('pagehide')); f.emit(); expect(f.samples).toHaveLength(2);
    f.target.dispatchEvent(new Event('pageshow')); f.emit(); expect(f.samples).toHaveLength(3);
    f.target.screen.orientation.angle = 90; f.emit(); expect(f.resets).toContain('screen-rotation');
    f.adapter.dispose(); f.emit(); expect(f.samples).toHaveLength(4);
    await expect(f.adapter.start()).rejects.toThrow('disposed');
  });
  test('cancelled permission cannot revive a stopped adapter; denial leaves touch available', async () => {
    const f = fixture(); let grant;
    f.target.DeviceMotionEvent = {requestPermission: () => new Promise(resolve => {grant = resolve;})};
    const pending = f.adapter.start(); f.adapter.stop(); grant('granted'); await pending;
    f.emit(); expect(f.samples).toHaveLength(0); expect(f.adapter.active).toBe(false);
    f.target.DeviceMotionEvent.requestPermission = vi.fn(async () => 'denied');
    await expect(f.adapter.start()).rejects.toThrow('Touch controls');
    expect(f.adapter.active).toBe(false);
  });
});



test('native physical X pitch releases bowling; pure Y wrist rotation and Z yaw do not masquerade as pitch', () => {
  const run = axis => {
    const detector = createBowlingMotionDetector(); const releases = [];
    for (let ms = 0; ms <= 800; ms += 20) {
      const rate = ms >= 100 && ms < 500 ? 300 * DEG_TO_RAD : 0;
      const reading = {x: 0, y: 0, z: 0}; reading[axis] = rate;
      const result = detector.push(toLegacyMotionSample(native(ms / 1000, reading)));
      if (result) releases.push(result);
    }
    return releases;
  };
  expect(run('x')).toHaveLength(1);
  expect(run('y')).toHaveLength(0);
  expect(run('z')).toHaveLength(0);
});

test('automatic setup becomes ready from real samples without requiring a stationary pose', async () => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup();
  let result;
  for (let i = 0; i <= 8; i++) result = setup.push(native(i * .02, {x: 2, y: .5, z: 0}));
  expect(result.ready).toBe(true); expect(result.justReady).toBe(true);
  expect(result.biasSource).toBe('provisional'); expect(result.calibration.bias).toEqual({x: 0, y: 0, z: 0});
  expect(result.sample.angularVelocity).toEqual({x: 2, y: .5, z: 0});
  const tooFew = createAutomaticMotionSetup();
  expect(tooFew.push(native(0)).ready).toBe(false);
  expect(tooFew.push(native(.2)).ready).toBe(false);
  expect(tooFew.push(null).state).toBe('no-readings');
});

test('automatic bias refinement only uses a quiet safe boundary and never rebases during a stroke', async () => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup();
  let result;
  for (let i = 0; i <= 50; i++) result = setup.push(native(i * .02, {x: .02, y: -.01, z: 0}), {safeBoundary: false, recenter: true});
  expect(result.biasSource).toBe('provisional');
  const before = result.calibration.revision;
  for (let i = 51; i <= 90; i++) result = setup.push(native(i * .02, {x: .02, y: -.01, z: 0}), {safeBoundary: true, recenter: true});
  expect(result.biasSource).toBe('stationary'); expect(result.calibration.revision).toBeGreaterThan(before);
  expect(result.sample.angularVelocity.x).toBeCloseTo(0);
  const settled = result.calibration;
  for (let i = 91; i <= 140; i++) result = setup.push(native(i * .02, {x: .04, y: .02, z: 0}), {safeBoundary: false, recenter: true});
  expect(result.calibration).toEqual(settled);
});

test('automatic setup discards stale/interrupted streams and never learns acceleration as stationary bias', async () => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup();
  let result;
  for (let i = 0; i <= 50; i++) result = setup.push({...native(i * .02, {x: .02, y: 0, z: 0}),
    acceleration: {x: 3, y: 0, z: 0}}, {safeBoundary: true});
  expect(result.ready).toBe(true); expect(result.biasSource).toBe('provisional');
  const revision = result.calibration.revision;
  result = setup.push(native(2)); expect(result.ready).toBe(false);
  for (let i = 1; i <= 8; i++) result = setup.push(native(2 + i * .02));
  expect(result.ready).toBe(true); expect(result.calibration.revision).toBeGreaterThan(revision);
  setup.reset(); expect(setup.ready).toBe(false);
  result = setup.push(native(3)); expect(result.ready).toBe(false);
  result = setup.push(native(3.02, {x: 0, y: 0, z: 0}, {screenAngle: 90})); expect(result.ready).toBe(false);
});

test('automatic readiness watchdog notices silent sensors without replaying a sample', async () => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup();
  for (let i = 0; i <= 8; i++) setup.push(native(i * .02, {x: 1, y: 0, z: 0}));
  expect(setup.read(.2).ready).toBe(true);
  expect(setup.read(.2).sample).toBeNull();
  expect(setup.read(.5).ready).toBe(false);
  expect(setup.push(native(.52)).ready).toBe(false);
});

test('established readiness can survive a brief gap without treating the gap as quiet calibration', async () => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup({readyGapSeconds: 1.5});
  let result;
  for (let i = 0; i <= 8; i++) result = setup.push(native(i * .02, {x: .02, y: 0, z: 0}), {safeBoundary: true});
  const revision = result.calibration.revision;
  expect(setup.read(.45).ready).toBe(true);
  expect(setup.read(.45).sample).toBeNull();
  for (let i = 0; i <= 15; i++) result = setup.push(native(.5 + i * .02, {x: .02, y: 0, z: 0}), {safeBoundary: true});
  expect(result.ready).toBe(true);
  expect(result.justReady).toBe(false);
  expect(result.calibration.revision).toBe(revision);
  expect(result.biasSource).toBe('provisional');
  for (let i = 16; i <= 31; i++) result = setup.push(native(.5 + i * .02, {x: .02, y: 0, z: 0}), {safeBoundary: true});
  expect(result.biasSource).toBe('stationary');
  expect(setup.read(2.7).ready).toBe(false);
});

test.each(['startup', 'time', 'sequence', 'rotation', 'reset'])('readiness grace still rejects %s discontinuities', async reason => {
  const {createAutomaticMotionSetup} = await import('@wee/shared/motion.js');
  const setup = createAutomaticMotionSetup({readyGapSeconds: 1.5});
  for (let i = 0; i <= (reason === 'startup' ? 3 : 8); i++) setup.push(native(i * .02));
  if (reason === 'reset') setup.reset();
  const sample = reason === 'time' ? native(.1, undefined, {sequence: 200})
    : reason === 'sequence' ? native(.2, undefined, {sequence: 1})
    : reason === 'rotation' ? native(.2, undefined, {screenAngle: 90}) : native(.4);
  expect(setup.push(sample).ready).toBe(false);
});

test('browser adapter can resume after pagehide plus stop without requiring a new permission prompt', async () => {
  const target = new EventTarget(), document = new EventTarget();
  const permission = vi.fn(async () => 'granted');
  Object.assign(target, {isSecureContext: true, DeviceMotionEvent: {requestPermission: permission}, screen: {orientation: {angle: 0}}});
  document.hidden = false;
  let time = 0; const samples = [];
  const adapter = createWebMotionAdapter({target, document, clock: () => time, onSample: sample => samples.push(sample)});
  await adapter.start();
  target.dispatchEvent(new Event('pagehide')); adapter.stop();
  await adapter.start({requestPermission: false});
  time = 1;
  target.dispatchEvent(Object.assign(new Event('devicemotion'), {rotationRate: {alpha: 1, beta: 0, gamma: 0}}));
  expect(samples).toHaveLength(1); expect(permission).toHaveBeenCalledTimes(1);
  adapter.dispose();
});
