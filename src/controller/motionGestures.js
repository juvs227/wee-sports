const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteSample = sample => Number.isFinite(sample?.timeMs) &&
  ['rotationAlpha', 'rotationBeta', 'rotationGamma'].every(axis => Number.isFinite(sample[axis]));

/** Explicitly selected shot mapping; does not claim to classify handed strokes. */
export function createSimpleSwingStream(label = 'Forehand') {
  let previous = null;
  let started = null;
  let angle = 0;
  let quietSince = null;
  let recovering = false;
  let recoveryStarted = null;
  const pending = [];
  const reset = () => { started = null; angle = 0; quietSince = null; };
  return {
    push(sample) {
      if (!finiteSample(sample)) { reset(); previous = null; return; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) reset();
      previous = sample.timeMs;
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      if (recovering) {
        quietSince = speed < 70 ? quietSince ?? sample.timeMs : null;
        if (sample.timeMs - recoveryStarted >= 450 && quietSince !== null && sample.timeMs - quietSince >= 250) {
          recovering = false; reset();
        }
        return;
      }
      if (speed < 140) { reset(); return; }
      started ??= sample.timeMs;
      angle += speed * Math.max(0, Math.min(gap, 100)) / 1000;
      if (sample.timeMs - started >= 100 && angle >= 22) {
        pending.push({ label, early: true, complete: false, detectionDelayMs: sample.timeMs - started, simple: true });
        recovering = true; recoveryStarted = sample.timeMs; reset();
      }
    },
    analyze() { return pending.splice(0); },
    get phase() { return recovering ? 'recovering' : 'ready'; },
  };
}

/** A bowling delivery is a forward underhand pitch followed by deceleration.
 * The UI explicitly arms one delivery, so repositioning between turns cannot roll.
 * Power is a bounded game input, not an estimate of real ball speed.
 */
export function createBowlingMotionDetector() {
  let previous = null;
  let started = null;
  let peak = 0;
  let rotation = 0;
  let pitchRotation = 0;
  let slowSince = null;
  let direction = 0;
  let finished = false;
  function reset() { started = null; peak = 0; rotation = 0; pitchRotation = 0; slowSince = null; direction = 0; }
  return {
    push(sample) {
      if (finished) return null;
      if (!finiteSample(sample)) { reset(); previous = null; return null; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) reset();
      previous = sample.timeMs;
      const pitch = Math.abs(sample.rotationBeta);
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      if (started === null) {
        if (pitch < 100 || pitch < speed * .55) return null;
        started = sample.timeMs;
        direction = Math.sign(sample.rotationBeta);
      }
      if (sample.timeMs - started > 1800 || (pitch > 100 && Math.sign(sample.rotationBeta) !== direction)) {
        reset(); return null;
      }
      peak = Math.max(peak, pitch);
      const dt = Math.max(0, Math.min(gap, 100)) / 1000;
      rotation += speed * dt;
      pitchRotation += pitch * dt;
      slowSince = pitch < peak * .45 ? slowSince ?? sample.timeMs : null;
      if (slowSince !== null && sample.timeMs - slowSince >= 80) {
        if (sample.timeMs - started >= 160 && pitchRotation >= 25 && pitchRotation >= rotation * .55 && peak >= 150) {
          finished = true;
          return { power: clamp((peak - 90) / 600, .2, 1), peakRotation: peak };
        }
        reset();
      }
      return null;
    },
  };
}
