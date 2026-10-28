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
  let twist = 0;
  let accelerationPeak = 0;
  function values() {
    const gyroPower = clamp((peak - 90) / 600, .2, 1);
    const accelerationPower = clamp(accelerationPeak / 18, 0, 1);
    // Acceleration assists the gyro estimate only when the device supplies
    // gravity-free readings; gravity itself must never charge a shot.
    const power = peak ? clamp(Math.max(gyroPower, gyroPower * .8 + accelerationPower * .2), .2, 1) : 0;
    const spin = Math.abs(twist) <= 4 ? 0 : clamp((twist - Math.sign(twist) * 4) / 32, -1, 1);
    return { power, spin, peakRotation: peak };
  }
  function reset() { started = null; peak = 0; rotation = 0; pitchRotation = 0; slowSince = null; direction = 0; twist = 0; accelerationPeak = 0; }
  return {
    push(sample) {
      if (finished) return null;
      if (!finiteSample(sample)) { reset(); previous = null; return null; }
      const gap = previous === null ? 0 : sample.timeMs - previous;
      if (gap <= 0 || gap > 100) reset();
      previous = sample.timeMs;
      // DeviceMotion rates are alpha=X (underhand pitch), beta=Y (wrist
      // roll), gamma=Z. DeviceOrientation angle names use a different order.
      const pitch = Math.abs(sample.rotationAlpha);
      const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
      if (started === null) {
        if (pitch < 100 || pitch < speed * .55) return null;
        started = sample.timeMs;
        direction = Math.sign(sample.rotationAlpha);
      }
      if (sample.timeMs - started > 1800 || (pitch > 100 && Math.sign(sample.rotationAlpha) !== direction)) {
        reset(); return null;
      }
      peak = Math.max(peak, pitch);
      const dt = Math.max(0, Math.min(gap, 100)) / 1000;
      rotation += speed * dt;
      pitchRotation += pitch * dt;
      twist += sample.rotationBeta * dt;
      const acceleration = sample.acceleration;
      if (acceleration && ['x', 'y', 'z'].every(axis => Number.isFinite(acceleration[axis]))) {
        accelerationPeak = Math.max(accelerationPeak, Math.min(30, Math.hypot(acceleration.x, acceleration.y, acceleration.z)));
      }
      slowSince = pitch < peak * .45 ? slowSince ?? sample.timeMs : null;
      if (slowSince !== null && sample.timeMs - slowSince >= 80) {
        if (sample.timeMs - started >= 160 && pitchRotation >= 25 && pitchRotation >= rotation * .55 && peak >= 150) {
          finished = true;
          return values();
        }
        reset();
      }
      return null;
    },
    get preview() { return values(); },
  };
}

/** Screen-up tilt aim uses gravity only while positioning, never during a roll.
 * Reject vigorous movement/near-vertical grips rather than letting them aim.
 */
export function bowlingTiltAim(gravity, rotationSpeed) {
  if (!gravity || !['x', 'y', 'z'].every(axis => Number.isFinite(gravity[axis])) || !Number.isFinite(rotationSpeed) || rotationSpeed > 65) return null;
  const magnitude = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (magnitude < 7.5 || magnitude > 12 || gravity.z < 5) return null;
  const angle = -Math.atan2(gravity.x, gravity.z) * 180 / Math.PI;
  return clamp(angle / 25, -1, 1) || 0;
}
