import { isVector3 } from '../../../shared/motion.js';

const axes = ['x', 'y', 'z'];
const copy = vector => Object.fromEntries(axes.map(axis => [axis, vector[axis]]));

/** Expo 58 returns gravity-down on both platforms. iOS adds CoreMotion.gravity
 * to userAcceleration; Android subtracts twice TYPE_GRAVITY from its raw
 * accelerometer. Keep that physical direction in canonical native samples.
 * Native DeviceMotion rotationRate is deliberately unused: its iOS and Android
 * implementations name the angular axes differently. Gyroscope supplies XYZ.
 */
export function nativeDeviceMotionFields(reading) {
  const result = {};
  if (isVector3(reading?.acceleration)) result.acceleration = copy(reading.acceleration);
  if (isVector3(reading?.accelerationIncludingGravity)) result.accelerationIncludingGravity = copy(reading.accelerationIncludingGravity);
  if (result.acceleration && result.accelerationIncludingGravity) {
    result.gravity = Object.fromEntries(axes.map(axis => [axis,
      result.accelerationIncludingGravity[axis] - result.acceleration[axis]]));
  }
  return result;
}

/** Raw Accelerometer is present on phones without Android's optional fused
 * sensors. Expo returns g units (iOS gravity-down, Android support/up). Keep
 * that total separate: it cannot honestly supply gravity-free shot power.
 */
export function nativeAccelerometerFields(reading) {
  return isVector3(reading) ? {accelerationIncludingGravity:Object.fromEntries(axes.map(axis => [axis,reading[axis] * 9.80665]))} : {};
}

/** Native timestamps use device uptime, while JS uses its own monotonic clock.
 * Map capture intervals onto receipt time and reject duplicate sensor frames.
 */
export function createNativeSensorClock() {
  let previous = null, offset = null;
  return {
    read(timestamp, receivedMs) {
      if (!Number.isFinite(timestamp)) return receivedMs;
      if (previous !== null && timestamp <= previous) return null;
      previous = timestamp;
      offset = Math.min(offset ?? Infinity, receivedMs - timestamp * 1000);
      return Math.min(receivedMs, timestamp * 1000 + offset);
    },
    reset() {previous = offset = null;},
  };
}

/** Bowling's established screen-up aim consumes a support/up vector. This is
 * an explicit adapter conversion, not a claim that all browser totals agree.
 */
export function nativeBowlingSupportVector(gravity) {
  return isVector3(gravity) ? Object.fromEntries(axes.map(axis => [axis, -gravity[axis] || 0])) : undefined;
}
