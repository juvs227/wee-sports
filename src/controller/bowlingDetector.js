/**
 * Bowling detector — example game detector built on the Motion SDK.
 *
 * Consumes the enriched sample stream and emits two event types:
 *
 *   { type: 'aim',      aim, locked, timeMs }  — whenever aim changes
 *   { type: 'delivery', power, spin, aim }      — when a delivery fires
 *
 * Turn state must be kept in sync via setTurn() as the game progresses.
 * Call rejectRelease() when the server rejects a delivery so the player
 * can retry.
 */

import {createBowlingDeliveryGate} from './motionGestures.js';
import {createBowlingAimController} from './bowlingAim.js';

export function createBowlingDetector({sensitivity = 1} = {}) {
  const gate = createBowlingDeliveryGate();
  const aimController = createBowlingAimController();

  let active = false;
  let turnKey = 0;
  let lastLockedAim = undefined;
  let lastLiveAim = null;

  return {
    push(sample, emit) {
      const prevPhase = gate.phase;
      const result = gate.push(sample, {active, turnKey, aim: lastLiveAim ?? 0});

      // Update live aim while positioning (gate not yet locked).
      if (gate.lockedAim === null && active) {
        const tilt = aimController.push(sample, {sensitivity});
        if (tilt !== null && tilt !== lastLiveAim) {
          lastLiveAim = tilt;
          emit({type: 'aim', aim: tilt, locked: false, timeMs: sample.timeMs});
        }
      }

      // Emit when aim locks (gate transitions to forward).
      const lockedAim = gate.lockedAim;
      if (lockedAim !== lastLockedAim) {
        lastLockedAim = lockedAim;
        if (lockedAim !== null) {
          emit({type: 'aim', aim: lockedAim, locked: true, timeMs: sample.timeMs});
        }
      }

      // Emit delivery when the gate fires.
      if (result) {
        emit({
          type: 'delivery',
          power: Math.min(1, result.power * sensitivity),
          spin: result.spin,
          aim: result.aim,
        });
      }
    },
    setTurn(key, canRoll) {
      turnKey = key;
      active = canRoll;
      if (!canRoll) {
        lastLiveAim = null;
        lastLockedAim = undefined;
        aimController.reset();
      }
    },
    rejectRelease(key, result) {
      return gate.rejectRelease(key, result);
    },
    get phase() { return gate.phase; },
    get preview() { return gate.preview; },
    get lockedAim() { return gate.lockedAim; },
  };
}
