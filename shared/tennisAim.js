import {createRelativeAimController, isMotionSample} from './motion.js';

/** Keep pointing responsive until the recognizer identifies a real stroke.
 * Capture its pre-onset pose on the phone's sample clock, even when recognition
 * arrives after follow-through. Rotation supplies bounded virtual placement;
 * it does not measure hand position. */
export function createTennisAim({sensitivity = 1} = {}) {
  const paddle = createRelativeAimController({sensitivity});
  const neutral = () => ({aim: 0, depth: 0});
  let live = neutral(), captured = neutral(), history = [];
  let previous = null;
  const reset = () => {paddle.reset(); live = neutral(); captured = neutral(); history = []; previous = null;};
  return {
    reset,
    push(sample) {
      if (!isMotionSample(sample) || !sample.angularVelocity) {reset(); return null;}
      const pose = paddle.push(sample);
      if (!pose) return null;
      const continuous = previous && sample.timeSeconds - previous.timeSeconds <= .15 &&
        sample.screenAngle === previous.screenAngle && sample.calibrationRevision === previous.calibrationRevision;
      if (!continuous) {captured = neutral(); history = [];}
      live = {aim: pose.reach.x, depth: pose.reach.y};
      const timeMs = sample.timeSeconds * 1000;
      history.push({timeMs, ...live});
      // The recognizer accepts up to 1.5 seconds of motion. Retain enough for
      // completion-mode recognition too, while bounding idle/high-rate input.
      while (history.length > 3000 || history[0].timeMs < timeMs - 3000) history.shift();
      previous = sample;
      return {...live};
    },
    capture(startMs) {
      if (startMs === undefined) return {...captured};
      captured = neutral();
      const latest = history.at(-1);
      if (!Number.isFinite(startMs) || !latest || startMs > latest.timeMs + 1e-6) return {...captured};
      // Both values share the canonical phone clock. The triggering sample's
      // rotation already belongs to the stroke, so choose the preceding pose.
      for (let index = history.length - 1; index >= 0; index--) {
        if (history[index].timeMs < startMs - 1e-6) {
          const {aim, depth} = history[index]; captured = {aim, depth}; break;
        }
      }
      return {...captured};
    },
  };
}
