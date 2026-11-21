import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWebMotion, toLegacyMotionSample } from '@wee/shared/motion.js';
import {
  AIM_TILT,
  STRAIGHT_SPIN,
  bowlingTutorialMove,
  createTutorialDetector,
  tutorialMoveMatches,
} from '@wee/src/controller/tutorialMoves.js';

// Samples here have exactly the shape the controller passes on: time and
// bias-free rotation rates in degrees per second, with no accelMag field.
const still = { rotationAlpha: 0, rotationBeta: 0, rotationGamma: 0 };

/** Feed samples 20 ms apart and collect every attempt the detector reports. */
function feed(detector, samples, gravity) {
  const attempts = [];
  samples.forEach((sample, index) => {
    const attempt = detector.push({ timeMs: index * 20, ...still, ...sample }, gravity?.(index));
    if (attempt) attempts.push(attempt);
  });
  return attempts;
}

const rest = (count) => Array.from({ length: count }, () => ({}));

/** A quick swing (200 ms of rotation), then enough rest for it to complete. */
function swing(rotationAlpha, rotationBeta) {
  return [...Array.from({ length: 10 }, () => ({ rotationAlpha, rotationBeta })), ...rest(50)];
}
const FOREHAND = swing(300, 600);
const BACKHAND = swing(-300, -600);
const UNCLEAR = swing(300, -600);

/** A short rest, an underhand roll with a steady wrist turn, then the slow-down. */
function roll(wristTurn) {
  return [
    ...rest(16),
    ...Array.from({ length: 15 }, (_, i) => ({ rotationAlpha: 400, rotationBeta: i < 15 ? wristTurn : 0 })),
    ...rest(20),
  ];
}

test('a roll counts as straight below the readout threshold, otherwise by spin direction', () => {
  assert.equal(bowlingTutorialMove(0), 'straight');
  assert.equal(bowlingTutorialMove(STRAIGHT_SPIN / 2), 'straight');
  assert.equal(bowlingTutorialMove(-STRAIGHT_SPIN / 2), 'straight');
  assert.equal(bowlingTutorialMove(0.2), 'curveRight');
  assert.equal(bowlingTutorialMove(-0.2), 'curveLeft');
  assert.equal(bowlingTutorialMove(NaN), 'straight');
});

test('any swing counts as a serve, but forehand and backhand must match', () => {
  for (const seen of ['forehand', 'backhand', 'serve']) assert.equal(tutorialMoveMatches('serve', seen), true);
  assert.equal(tutorialMoveMatches('forehand', 'forehand'), true);
  assert.equal(tutorialMoveMatches('forehand', 'backhand'), false);
  assert.equal(tutorialMoveMatches('curveLeft', 'curveRight'), false);
});

test('unknown sports and moves have no detector', () => {
  assert.equal(createTutorialDetector('tennis', 'curveLeft'), null);
  assert.equal(createTutorialDetector('bowling', 'serve'), null);
  assert.equal(createTutorialDetector('golf', 'aim'), null);
});

test('tennis uses the match recognizer: forehand and backhand are told apart', () => {
  assert.deepEqual(feed(createTutorialDetector('tennis', 'forehand'), FOREHAND), [
    { detected: 'forehand', matched: true },
  ]);
  assert.deepEqual(feed(createTutorialDetector('tennis', 'backhand'), BACKHAND), [
    { detected: 'backhand', matched: true },
  ]);
  assert.deepEqual(feed(createTutorialDetector('tennis', 'backhand'), FOREHAND), [
    { detected: 'forehand', matched: false },
  ]);
});

test('the playing hand decides which way is a forehand', () => {
  assert.deepEqual(feed(createTutorialDetector('tennis', 'forehand', { hand: 'Left' }), swing(300, -600)), [
    { detected: 'forehand', matched: true },
  ]);
});

test('unclear and gentle swings are ignored, like in a match, but a serve takes any swing', () => {
  assert.deepEqual(feed(createTutorialDetector('tennis', 'forehand'), UNCLEAR), []);
  assert.deepEqual(feed(createTutorialDetector('tennis', 'forehand'), swing(100, 100)), []);
  assert.deepEqual(feed(createTutorialDetector('tennis', 'serve'), UNCLEAR), [{ detected: 'serve', matched: true }]);
});

test('aim needs a clear tilt both ways, and is reported once', () => {
  // Screen up: gravity mostly on z, with x giving the left/right tilt.
  const tilted = (degrees) => ({
    x: -9.8 * Math.sin((degrees * Math.PI) / 180),
    y: 0,
    z: 9.8 * Math.cos((degrees * Math.PI) / 180),
  });
  const big = 35 * AIM_TILT + 10;
  assert.deepEqual(feed(createTutorialDetector('bowling', 'aim'), rest(5), () => tilted(big)), []);
  const angles = [big, big, 0, -big, -big, big, -big];
  assert.deepEqual(
    feed(createTutorialDetector('bowling', 'aim'), rest(angles.length), (index) => tilted(angles[index])),
    [{ detected: 'aim', matched: true }],
  );
});

test('bowling uses the match delivery gate, and each try is judged afresh', () => {
  const right = createTutorialDetector('bowling', 'curveRight');
  const [first, second] = feed(right, [...roll(0), ...roll(100)]);
  assert.equal(first.detected, 'straight');
  assert.equal(first.matched, false);
  assert.equal(second.detected, 'curveRight');
  assert.equal(second.matched, true);
  assert.ok(second.spin > STRAIGHT_SPIN);
  assert.equal(feed(createTutorialDetector('bowling', 'curveLeft'), roll(-100))[0].detected, 'curveLeft');
});

test('a roll without a rest first does not count, like in a match', () => {
  const moving = Array.from({ length: 15 }, () => ({ rotationAlpha: 400 }));
  assert.deepEqual(feed(createTutorialDetector('bowling', 'straight'), [...moving, ...rest(5)]), []);
});

/** A teammate's recorded swings, converted the way the controller converts live motion. */
function recording(name) {
  const parsed = JSON.parse(readFileSync(new URL(`../fixtures/team-motion/${name}.json`, import.meta.url)));
  return (parsed.samples ?? parsed).map((sample, sequence) =>
    toLegacyMotionSample(
      normalizeWebMotion(
        { rotationRate: { alpha: sample.rotationAlpha, beta: sample.rotationBeta, gamma: sample.rotationGamma } },
        { timeSeconds: sample.timeMs / 1000, sequence },
      ),
    ),
  );
}

const RECORDINGS = [
  ['two-forehands-one-backhand', 'Right', ['forehand', 'forehand', 'backhand']],
  ['four-backhands', 'Right', Array(4).fill('backhand')],
  ['left-mixed', 'Left', ['forehand', 'backhand', 'forehand', 'backhand']],
  ['left-four-backhands-new', 'Left', Array(4).fill('backhand')],
  ['left-four-forehands', 'Left', Array(4).fill('forehand')],
];

for (const [name, hand, strokes] of RECORDINGS) {
  test(`real recorded swings are recognized in the tutorial: ${name}`, () => {
    const detector = createTutorialDetector('tennis', 'forehand', { hand });
    const attempts = [];
    for (const sample of recording(name)) {
      const attempt = detector.push(sample);
      if (attempt) attempts.push(attempt.detected);
    }
    assert.deepEqual(attempts, strokes);
  });
}
