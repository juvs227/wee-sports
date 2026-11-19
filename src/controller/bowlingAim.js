import {bowlingTiltAim} from './motionGestures.js';

/** Leave room for sensor callback jitter around a 16.7 ms display interval.
 * A strict 16 ms cutoff drops ordinary early frames and produces 33 ms steps. */
export function createBowlingAimStream(send, { intervalMs = 12, heartbeatMs = 200 } = {}) {
  let sequence = 0;
  let last = null;
  return {
    publish(aim, locked, timeMs, active) {
      if (!active || !Number.isFinite(aim) || Math.abs(aim) > 1 || !Number.isFinite(timeMs)) {
        last = null;
        return false;
      }
      const changedLock = last && last.locked !== locked;
      const elapsed = last ? timeMs - last.timeMs : Infinity;
      if (last && !changedLock && elapsed >= 0 &&
          (elapsed < intervalMs || (Math.abs(last.aim - aim) < .005 && elapsed < heartbeatMs))) return false;
      const event = { aim, locked: Boolean(locked), sequence: ++sequence };
      send(event);
      last = { ...event, timeMs };
      return true;
    },
    reset() { last = null; },
  };
}

/** Small hand tremors get a short low-pass filter; deliberate changes catch up
 * within a couple of sensor samples. Time-based gain preserves phone-rate parity. */
export function createBowlingAimFilter() {
  let value = 0, previous = null;
  return {
    push(input, timeSeconds) {
      if (!Number.isFinite(input) || !Number.isFinite(timeSeconds)) return value;
      input = Math.max(-1, Math.min(1, input));
      if (previous !== null && timeSeconds <= previous) return value;
      const dt = previous === null ? Infinity : timeSeconds - previous;
      previous = timeSeconds;
      if (dt > .25) {value = input; return value;}
      const motion = Math.min(1, Math.abs(input - value) / .12);
      const timeConstant = .035 - .023 * motion;
      value += (input - value) * -Math.expm1(-dt / timeConstant);
      return value;
    },
    reset(input = 0, timeSeconds = null) {
      value = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0;
      previous = Number.isFinite(timeSeconds) ? timeSeconds : null;
    },
  };
}

/** Gravity anchors the absolute lane direction. Gyroscope samples fill the
 * gaps between gravity callbacks, rather than re-filtering the same old tilt.
 * Prediction is limited to 100 ms; it never invents motion through a dropout.
 */
export function createBowlingAimController() {
  const filter = createBowlingAimFilter();
  let previous = null, gravityAt = null, support = null, value = null;
  const vector = v => v && ['x', 'y', 'z'].every(axis => Number.isFinite(v[axis]));
  const gravity = v => {
    if (!vector(v) || bowlingTiltAim(v, 0) === null) return null;
    const scale = Math.sign(v.z) * 9.80665 / Math.hypot(v.x, v.y, v.z);
    return {x: v.x * scale, y: v.y * scale, z: v.z * scale};
  };
  return {
    push(sample, {gravityTimeSeconds = sample?.timeSeconds, sensitivity = 1} = {}) {
      const time = sample?.timeSeconds;
      if (!Number.isFinite(time) || previous !== null && time <= previous) return null;
      const dt = previous === null ? 0 : time - previous;
      previous = time;
      if (dt > .1) {support = null; gravityAt = null;}
      const measurement = gravity(sample.gravity ?? sample.accelerationIncludingGravity);
      const fresh = measurement && Number.isFinite(gravityTimeSeconds) && gravityTimeSeconds <= time &&
        time - gravityTimeSeconds <= .1 && (gravityAt === null || gravityTimeSeconds > gravityAt);
      if (fresh) {support = measurement; gravityAt = gravityTimeSeconds;}
      if (!support || gravityAt === null || time - gravityAt > .1) return null;
      // The gravity vector is expressed in the rotating phone frame, hence
      // the inverse rotation. Fresh, current gravity needs no extrapolation.
      const predict = fresh ? time - gravityTimeSeconds : dt;
      if (predict > 0 && vector(sample.angularVelocity)) {
        const omega = sample.angularVelocity;
        const speed = Math.hypot(omega.x, omega.y, omega.z);
        if (speed > 0 && speed <= 40) {
          const axis = {x: -omega.x / speed, y: -omega.y / speed, z: -omega.z / speed};
          const angle = speed * Math.min(predict, .1), c = Math.cos(angle), s = Math.sin(angle);
          const dot = axis.x * support.x + axis.y * support.y + axis.z * support.z;
          support = {
            x: support.x * c + (axis.y * support.z - axis.z * support.y) * s + axis.x * dot * (1 - c),
            y: support.y * c + (axis.z * support.x - axis.x * support.z) * s + axis.y * dot * (1 - c),
            z: support.z * c + (axis.x * support.y - axis.y * support.x) * s + axis.z * dot * (1 - c),
          };
        }
      }
      const tilt = bowlingTiltAim(support, 0);
      if (tilt !== null) value = filter.push(tilt * (Number.isFinite(sensitivity) ? sensitivity : 1), time);
      return value;
    },
    reset(initialAim = null) {
      previous = null; gravityAt = null; support = null; value = initialAim;
      filter.reset(initialAim ?? 0);
    },
  };
}
