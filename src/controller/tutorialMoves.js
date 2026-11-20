import { createSwingDetector } from './accelerationSwing.js';
import { bowlingTiltAim, createBowlingMotionDetector } from './motionGestures.js';

/**
 * Tutorial move detection. The controller feeds it the same motion samples as
 * a real match, but nothing it detects is ever sent to the game: it only tells
 * the phone page which move it saw, so the tutorial can advance once every
 * learner has really done the move.
 *
 * Move ids match TUTORIAL_MOVES in shared/protocol.js.
 */

/** Below this much side spin a roll counts as straight, as on the phone readout. */
export const STRAIGHT_SPIN = 0.04;

/** How far the phone must tilt each way, as a share of the full aim range. */
export const AIM_TILT = 0.5;

/** The bowling move a finished roll's spin matches. Positive spin bends right. */
export function bowlingTutorialMove(spin) {
  if (!Number.isFinite(spin) || Math.abs(spin) < STRAIGHT_SPIN) return 'straight';
  return spin > 0 ? 'curveRight' : 'curveLeft';
}

/**
 * Whether a detected move completes the expected one. The swing detector only
 * tells forehands from backhands, so any real swing counts as a serve.
 */
export function tutorialMoveMatches(expected, detected) {
  if (expected === 'serve') return ['serve', 'forehand', 'backhand'].includes(detected);
  return expected === detected;
}

function tennisDetector(move) {
  const swings = createSwingDetector();
  return {
    push(sample) {
      const swing = swings.push(sample);
      if (!swing) return null;
      const detected = move === 'serve' ? 'serve' : swing.label.toLowerCase();
      return { detected, matched: tutorialMoveMatches(move, detected) };
    },
  };
}

/** Aim is learned by tilting the phone clearly left and clearly right. */
function aimDetector() {
  let left = false;
  let right = false;
  let reported = false;
  return {
    push(sample, gravity) {
      if (reported) return null;
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      const tilt = bowlingTiltAim(gravity, speed);
      if (tilt === null) return null;
      if (tilt <= -AIM_TILT) left = true;
      if (tilt >= AIM_TILT) right = true;
      if (!left || !right) return null;
      reported = true;
      return { detected: 'aim', matched: true };
    },
  };
}

/** Every roll is judged, then a fresh detector waits for the next try. */
function rollDetector(move) {
  let rolls = createBowlingMotionDetector();
  return {
    push(sample) {
      const roll = rolls.push(sample);
      if (!roll) return null;
      rolls = createBowlingMotionDetector();
      const detected = bowlingTutorialMove(roll.spin);
      return { detected, matched: detected === move, power: roll.power, spin: roll.spin };
    },
  };
}

/**
 * A detector for one tutorial step. push(sample, gravity) returns null until
 * it sees an attempt, then { detected, matched, ... } for that attempt.
 */
export function createTutorialDetector(sport, move) {
  if (sport === 'tennis' && ['forehand', 'backhand', 'serve'].includes(move)) return tennisDetector(move);
  if (sport === 'bowling' && move === 'aim') return aimDetector();
  if (sport === 'bowling' && ['straight', 'curveRight', 'curveLeft'].includes(move)) return rollDetector(move);
  return null;
}
