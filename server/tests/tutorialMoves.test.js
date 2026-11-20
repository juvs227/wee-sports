import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  AIM_TILT,
  STRAIGHT_SPIN,
  bowlingTutorialMove,
  createTutorialDetector,
  tutorialMoveMatches,
} from '@wee/src/controller/tutorialMoves.js';

const still = { rotationAlpha: 0, rotationBeta: 0, rotationGamma: 0 };

/** Feed samples 10 ms apart and collect every attempt the detector reports. */
function feed(detector, samples, gravity) {
  const attempts = [];
  samples.forEach((sample, index) => {
    const attempt = detector.push({ timeMs: index * 10, accelMag: 9.8, ...still, ...sample }, gravity?.(index));
    if (attempt) attempts.push(attempt);
  });
  return attempts;
}

/** A forward underhand roll with a steady wrist turn, then the slow-down that releases it. */
function roll(wristTurn) {
  return [
    ...Array.from({ length: 30 }, () => ({ rotationAlpha: 300, rotationBeta: wristTurn })),
    ...Array.from({ length: 12 }, () => ({ rotationAlpha: 40 })),
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
  for (const swing of ['forehand', 'backhand', 'serve']) assert.equal(tutorialMoveMatches('serve', swing), true);
  assert.equal(tutorialMoveMatches('forehand', 'forehand'), true);
  assert.equal(tutorialMoveMatches('forehand', 'backhand'), false);
  assert.equal(tutorialMoveMatches('curveLeft', 'curveRight'), false);
});

test('unknown sports and moves have no detector', () => {
  assert.equal(createTutorialDetector('tennis', 'curveLeft'), null);
  assert.equal(createTutorialDetector('bowling', 'serve'), null);
  assert.equal(createTutorialDetector('golf', 'aim'), null);
});

test('a fast tennis swing is reported once, and a slow one not at all', () => {
  const fast = createTutorialDetector('tennis', 'forehand');
  assert.deepEqual(feed(fast, [{ accelMag: 30 }, { accelMag: 31 }, { accelMag: 9.8 }]), [
    { detected: 'forehand', matched: true },
  ]);
  const slow = createTutorialDetector('tennis', 'forehand');
  assert.deepEqual(feed(slow, [{ accelMag: 15 }, { accelMag: 20 }]), []);
});

test('the swing detector cannot tell a serve, so the serve step takes any swing', () => {
  const serve = createTutorialDetector('tennis', 'serve');
  assert.deepEqual(feed(serve, [{ accelMag: 30 }]), [{ detected: 'serve', matched: true }]);
  const backhand = createTutorialDetector('tennis', 'backhand');
  // Without an orientation every swing reads as a forehand, which is a miss here.
  assert.deepEqual(feed(backhand, [{ accelMag: 30 }]), [{ detected: 'forehand', matched: false }]);
});

test('aim needs a clear tilt both ways, and is reported once', () => {
  // Screen up: gravity mostly on z, with x giving the left/right tilt.
  const tilted = (degrees) => ({
    x: -9.8 * Math.sin((degrees * Math.PI) / 180),
    y: 0,
    z: 9.8 * Math.cos((degrees * Math.PI) / 180),
  });
  const big = 35 * AIM_TILT + 10;
  const oneWay = createTutorialDetector('bowling', 'aim');
  assert.deepEqual(feed(oneWay, Array.from({ length: 5 }, () => ({})), () => tilted(big)), []);
  const bothWays = createTutorialDetector('bowling', 'aim');
  const angles = [big, big, 0, -big, -big, big, -big];
  assert.deepEqual(
    feed(bothWays, angles.map(() => ({})), (index) => tilted(angles[index])),
    [{ detected: 'aim', matched: true }],
  );
});

test('a roll is judged by its wrist turn, and the next try is judged afresh', () => {
  const right = createTutorialDetector('bowling', 'curveRight');
  const [first, second] = feed(right, [...roll(0), ...roll(200)]);
  assert.equal(first.detected, 'straight');
  assert.equal(first.matched, false);
  assert.equal(second.detected, 'curveRight');
  assert.equal(second.matched, true);
  assert.ok(second.spin > STRAIGHT_SPIN);

  const left = createTutorialDetector('bowling', 'curveLeft');
  assert.equal(feed(left, roll(-200))[0].detected, 'curveLeft');
});
