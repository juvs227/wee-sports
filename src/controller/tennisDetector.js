/**
 * Tennis detector — example game detector built on the Motion SDK.
 *
 * Consumes the enriched sample stream from the SDK and emits a TennisSwing
 * whenever a stroke is classified:
 *   { label, power, placement, recognitionMs, swing }
 *
 * Uses the existing classifySwing/swingStream pipeline unchanged.
 * Aim is captured at swing.startMs using the canonical timeSeconds clock.
 */

import {createSwingStream} from './swingStream.js';
import {createSimpleSwingStream} from './motionGestures.js';
import {tennisPower} from './tennisPower.js';
import {createTennisAim} from '../../shared/tennisAim.js';

export function createTennisDetector({
  hand = 'Right',
  mode = 'auto',       // 'auto' | 'Forehand' | 'Backhand'
  response = 'fast',   // 'early' | 'fast' | 'complete'
  suppressReturns = true,
  sensitivity = 1,
  strengthProfile = null,
} = {}) {
  const stream = mode === 'auto'
    ? createSwingStream(hand, {
        early: response === 'early',
        fast: response === 'fast',
        suppressReturns,
      })
    : createSimpleSwingStream(mode);

  const aim = createTennisAim({sensitivity});

  function classify(emit) {
    for (const swing of stream.analyze()) {
      if (!(swing.complete || swing.early || swing.fast)) continue;
      if (swing.label === 'Unknown') continue;
      const power = Math.min(
        1,
        tennisPower(swing.peakRotation, strengthProfile, swing.label) * sensitivity,
      );
      emit({
        label: swing.label,
        power,
        placement: aim.capture(swing.startMs),
        recognitionMs: swing.detectionDelayMs,
        swing,
      });
    }
  }

  return {
    push(sample, emit) {
      // sample has both canonical fields (timeSeconds, angularVelocity, gravity)
      // and legacy fields (timeMs, rotationAlpha/Beta/Gamma) from the SDK.
      aim.push(sample);
      stream.push(sample);
      classify(emit);
    },
    flush(emit) {
      // Flush any in-progress window when motion stops.
      for (const swing of stream.analyze(true)) {
        if (!(swing.complete || swing.early || swing.fast)) continue;
        if (swing.label === 'Unknown') continue;
        const power = Math.min(
          1,
          tennisPower(swing.peakRotation, strengthProfile, swing.label) * sensitivity,
        );
        emit({
          label: swing.label,
          power,
          placement: aim.capture(swing.startMs),
          recognitionMs: swing.detectionDelayMs,
          swing,
        });
      }
      aim.reset();
    },
    setStrengthProfile(profile) {
      strengthProfile = profile;
    },
  };
}
