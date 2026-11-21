import { createSwingStream } from './swingStream.js';
import { bowlingTiltAim, createBowlingDeliveryGate } from './motionGestures.js';

/**
 * Tutorial move detection. The controller feeds it the same motion samples as
 * a real match, and it recognizes moves with the same recognizers the match
 * uses, so a move that counts here also works in the game. Nothing it detects
 * is ever sent to the game: it only tells the phone page which move it saw, so
 * the tutorial can advance once every learner has really done the move.
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
 * Whether a detected move completes the expected one. The swing recognizer
 * only tells forehands from backhands, so any real swing counts as a serve.
 */
export function tutorialMoveMatches(expected, detected) {
  if (expected === 'serve') return ['serve', 'forehand', 'backhand'].includes(detected);
  return expected === detected;
}

/**
 * The match's own swing recognizer for this hand. Like the match, it ignores
 * motion it can't classify: real swings sometimes leave a stray unclassified
 * fragment, which must not count against the player. A serve can't be
 * classified at all, so for the serve step any swing counts.
 */
function tennisDetector(move, hand) {
  const swings = createSwingStream(hand);
  return {
    push(sample) {
      swings.push(sample);
      for (const swing of swings.analyze()) {
        const unknown = swing.label === 'Unknown';
        if (move === 'serve') return { detected: 'serve', matched: true };
        if (unknown || !(swing.complete || swing.early || swing.fast)) continue;
        const detected = swing.label.toLowerCase();
        return { detected, matched: tutorialMoveMatches(move, detected) };
      }
      return null;
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

/**
 * The match's delivery gate: a short rest, then one underhand roll. Each try
 * gets a fresh turn key, so the next roll is judged on its own.
 */
function rollDetector(move) {
  const gate = createBowlingDeliveryGate();
  let tries = 0;
  return {
    push(sample) {
      const roll = gate.push(sample, { active: true, turnKey: tries, aim: 0 });
      if (!roll) return null;
      tries += 1;
      const detected = bowlingTutorialMove(roll.spin);
      return { detected, matched: detected === move, power: roll.power, spin: roll.spin };
    },
  };
}

/**
 * A detector for one tutorial step. push(sample, gravity) returns null until
 * it sees an attempt, then { detected, matched, ... } for that attempt. hand
 * is the controller's playing hand, which tennis needs to tell its swings apart.
 */
export function createTutorialDetector(sport, move, { hand = 'Right' } = {}) {
  if (sport === 'tennis' && ['forehand', 'backhand', 'serve'].includes(move)) return tennisDetector(move, hand);
  if (sport === 'bowling' && move === 'aim') return aimDetector();
  if (sport === 'bowling' && ['straight', 'curveRight', 'curveLeft'].includes(move)) return rollDetector(move);
  return null;
}
