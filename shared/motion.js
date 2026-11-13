/** Portable motion math. Phone frame: X right, Y top, Z out of the screen.
 * Quaternion order is x,y,z,w; Hamilton product, right-handed active rotations.
 * Samples use monotonic seconds, radians/second, and metres/second squared.
 * Screen rotation is metadata until a sport explicitly maps into the grip frame.
 */
export const MOTION_SCHEMA_VERSION = 1;
export const DEG_TO_RAD = Math.PI / 180;
const axes = ['x', 'y', 'z'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isVector3 = value => record(value) && axes.every(axis => Number.isFinite(value[axis]));
const vector = value => isVector3(value) ? Object.fromEntries(axes.map(axis => [axis, value[axis]])) : undefined;
export const identityQuaternion = () => ({x: 0, y: 0, z: 0, w: 1});
export function normalizeQuaternion(value) {
  if (!record(value) || !['x', 'y', 'z', 'w'].every(axis => Number.isFinite(value[axis]))) return null;
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (length < 1e-8) return null;
  const hemisphere = value.w < 0 ? -1 : 1;
  return Object.fromEntries(['x', 'y', 'z', 'w'].map(axis => [axis, value[axis] * hemisphere / length]));
}
export function multiplyQuaternions(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export const inverseQuaternion = q => ({x: -q.x, y: -q.y, z: -q.z, w: q.w});
export function rotateVectorToScreen(value, angle = 0) {
  const radians = angle * DEG_TO_RAD;
  return {x: value.x * Math.cos(radians) + value.y * Math.sin(radians),
    y: -value.x * Math.sin(radians) + value.y * Math.cos(radians), z: value.z};
}
/** DeviceOrientation uses intrinsic Z(alpha), X(beta), Y(gamma), in degrees. */
export function orientationFromWebEvent(event) {
  if (!['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(event?.[axis]))) return undefined;
  const a = event.alpha * DEG_TO_RAD / 2, b = event.beta * DEG_TO_RAD / 2, g = event.gamma * DEG_TO_RAD / 2;
  return normalizeQuaternion(multiplyQuaternions(
    multiplyQuaternions({x: 0, y: 0, z: Math.sin(a), w: Math.cos(a)},
      {x: Math.sin(b), y: 0, z: 0, w: Math.cos(b)}),
    {x: 0, y: Math.sin(g), z: 0, w: Math.cos(g)}));
}
function sampleBase({timeSeconds, sequence, screenAngle = 0, calibrationRevision = 0, orientation, orientationTimeSeconds} = {}) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isSafeInteger(calibrationRevision) || calibrationRevision < 0 || !Number.isFinite(screenAngle)) return null;
  const sample = {schemaVersion: MOTION_SCHEMA_VERSION, timeSeconds, sequence, calibrationRevision,
    screenAngle: ((screenAngle % 360) + 360) % 360, timestampSource: 'receipt'};
  const normalized = normalizeQuaternion(orientation);
  if (normalized) {
    sample.orientation = normalized;
    if (Number.isFinite(orientationTimeSeconds) && orientationTimeSeconds >= 0 && orientationTimeSeconds <= timeSeconds) sample.orientationTimeSeconds = orientationTimeSeconds;
  }
  return sample;
}
/** Browser rotationRate follows alpha=X, beta=Y, gamma=Z (W3C + Chromium/WebKit).
 * DeviceOrientation Euler angles use a different Z/X/Y naming convention.
 * Missing axes remain absent; missing sensor data is never a zero measurement.
 */
export function normalizeWebMotion(event, options) {
  const sample = sampleBase(options);
  if (!sample) return null;
  const rate = event?.rotationRate;
  if (rate && ['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(rate[axis]))) {
    sample.angularVelocity = {x: rate.alpha * DEG_TO_RAD, y: rate.beta * DEG_TO_RAD, z: rate.gamma * DEG_TO_RAD};
  }
  const acceleration = vector(event?.acceleration), total = vector(event?.accelerationIncludingGravity);
  if (acceleration) sample.acceleration = acceleration;
  if (total) sample.accelerationIncludingGravity = total;
  // Total acceleration alone cannot distinguish gravity from a moving phone.
  if (acceleration && total) sample.gravity = Object.fromEntries(axes.map(axis => [axis, total[axis] - acceleration[axis]]));
  return isMotionSample(sample) ? sample : null;
}
/** Expo Gyroscope is already rad/s. Do not run it through a degree converter. */
export function normalizeNativeGyroscope(reading, options) {
  const sample = sampleBase(options);
  if (!sample || !isVector3(reading)) return null;
  sample.angularVelocity = vector(reading);
  return isMotionSample(sample) ? sample : null;
}
export function isMotionSample(sample) {
  if (!record(sample) || sample.schemaVersion !== MOTION_SCHEMA_VERSION ||
      !Number.isFinite(sample.timeSeconds) || sample.timeSeconds < 0 ||
      !Number.isSafeInteger(sample.sequence) || sample.sequence < 0 ||
      !Number.isSafeInteger(sample.calibrationRevision) || sample.calibrationRevision < 0 ||
      !Number.isFinite(sample.screenAngle) || sample.screenAngle < 0 || sample.screenAngle >= 360) return false;
  for (const field of ['angularVelocity', 'acceleration', 'accelerationIncludingGravity', 'gravity']) {
    if (sample[field] !== undefined && (!isVector3(sample[field]) || axes.some(axis => Math.abs(sample[field][axis]) > 2000))) return false;
  }
  if (sample.orientation !== undefined) {
    const q = sample.orientation;
    if (!normalizeQuaternion(q) || Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-3) return false;
  }
  if (sample.orientationTimeSeconds !== undefined && (!sample.orientation || !Number.isFinite(sample.orientationTimeSeconds) ||
      sample.orientationTimeSeconds < 0 || sample.orientationTimeSeconds > sample.timeSeconds)) return false;
  return ['angularVelocity', 'acceleration', 'accelerationIncludingGravity', 'gravity', 'orientation'].some(key => sample[key] !== undefined);
}
/** Inverse browser mapping retains every legacy degree-based threshold.
 * `timeOriginSeconds` allows recognizers to keep their existing session clock.
 */
export function toLegacyMotionSample(sample, {timeOriginSeconds = 0, bias} = {}) {
  if (!isMotionSample(sample) || !sample.angularVelocity || !Number.isFinite(timeOriginSeconds) ||
      (bias && !['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(bias[axis])))) return null;
  const rate = sample.angularVelocity;
  const legacy = {timeMs: (sample.timeSeconds - timeOriginSeconds) * 1000,
    rotationAlpha: rate.x / DEG_TO_RAD - (bias?.alpha ?? 0),
    rotationBeta: rate.y / DEG_TO_RAD - (bias?.beta ?? 0),
    rotationGamma: rate.z / DEG_TO_RAD - (bias?.gamma ?? 0)};
  if (sample.acceleration) legacy.acceleration = {...sample.acceleration};
  return legacy;
}
/** Exact first-order response over elapsed time; cadence does not alter tuning. */
export function createTimeConstantFilter({timeConstantSeconds = .084, maxGapSeconds = .5} = {}) {
  if (!(timeConstantSeconds > 0) || !Number.isFinite(timeConstantSeconds) || !(maxGapSeconds > 0) || !Number.isFinite(maxGapSeconds)) throw new RangeError('Invalid filter timing');
  let value = null, previous = null;
  return {
    push(next, timeSeconds) {
      if (!Number.isFinite(next) || !Number.isFinite(timeSeconds)) return value;
      if (value === null || previous === null) {value = next; previous = timeSeconds; return value;}
      const dt = timeSeconds - previous;
      if (dt <= 0) return value;
      previous = timeSeconds;
      if (dt > maxGapSeconds) {value = next; return value;}
      value += (next - value) * -Math.expm1(-dt / timeConstantSeconds);
      return value;
    },
    reset(next, timeSeconds) {
      value = Number.isFinite(next) ? next : null;
      previous = Number.isFinite(timeSeconds) ? timeSeconds : null;
      return value;
    },
    get value() { return value; },
  };
}
/** Stillness uses SI units and a continuous time window, never sample count alone. */
export function createMotionCalibration({durationSeconds = 1.2, minimumSamples = 10, maxGapSeconds = .25,
  maximumBias = 5 * DEG_TO_RAD, maximumDeviation = 3 * DEG_TO_RAD, revision = 1} = {}) {
  let samples = [], result = null;
  return {
    push(sample) {
      if (result) return {state: 'done', calibration: result, progress: 1};
      if (!isMotionSample(sample) || !sample.angularVelocity) {samples = []; return {state: 'no-readings', progress: 0};}
      const last = samples.at(-1);
      if (last && (sample.timeSeconds <= last.timeSeconds || sample.timeSeconds - last.timeSeconds > maxGapSeconds ||
          sample.screenAngle !== last.screenAngle)) samples = [];
      samples.push(sample);
      while (samples.length > 1 && samples[1].timeSeconds <= sample.timeSeconds - durationSeconds) samples.shift();
      if (samples.length > 1000) samples.shift();
      const duration = sample.timeSeconds - samples[0].timeSeconds;
      const bias = Object.fromEntries(axes.map(axis => [axis, samples.reduce((sum, s) => sum + s.angularVelocity[axis], 0) / samples.length]));
      const deviation = Math.sqrt(samples.reduce((sum, s) => sum + axes.reduce((part, axis) =>
        part + (s.angularVelocity[axis] - bias[axis]) ** 2, 0), 0) / samples.length);
      const still = Math.hypot(bias.x, bias.y, bias.z) <= maximumBias && deviation <= maximumDeviation;
      if (still && duration >= durationSeconds - 1e-9 && samples.length >= minimumSamples) {
        result = {revision, bias, screenAngle: sample.screenAngle};
        if (sample.orientation) result.neutralOrientation = {...sample.orientation};
        return {state: 'done', calibration: result, progress: 1};
      }
      return {state: still ? 'collecting' : 'moving', progress: still ? Math.min(1, duration / durationSeconds) : 0};
    },
    reset() {samples = []; result = null;},
  };
}
export function applyMotionCalibration(sample, calibration) {
  if (!isMotionSample(sample) || !isVector3(calibration?.bias) || !Number.isSafeInteger(calibration.revision) || calibration.revision < 0) return null;
  if (sample.screenAngle !== calibration.screenAngle) return null;
  const result = {...sample, calibrationRevision: calibration.revision};
  if (sample.angularVelocity) result.angularVelocity = Object.fromEntries(axes.map(axis => [axis, sample.angularVelocity[axis] - calibration.bias[axis]]));
  const neutral = normalizeQuaternion(calibration.neutralOrientation);
  if (sample.orientation && neutral) result.orientation = normalizeQuaternion(multiplyQuaternions(inverseQuaternion(neutral), sample.orientation));
  return result;
}
function gyroStep(angularVelocity, dt) {
  const speed = Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z);
  if (!speed) return identityQuaternion();
  const scale = Math.sin(speed * dt / 2) / speed;
  return {x: angularVelocity.x * scale, y: angularVelocity.y * scale, z: angularVelocity.z * scale, w: Math.cos(speed * dt / 2)};
}
/** Bounded game intent, not a claim to measure the position of a player's hand.
 * A gap, rotation or revision change cancels the current stroke. First resumed
 * input has zero angular velocity, avoiding a synthetic recenter hit.
 */
export function createRelativeAimController({sensitivity = 1, maxGapSeconds = .15} = {}) {
  let previous = null, neutral = null, orientation = identityQuaternion(), attitudeAt = null;
  const gain = clamp(Number.isFinite(sensitivity) ? sensitivity : 1, .25, 2);
  const reset = sample => {previous = null; neutral = sample?.orientation ? {...sample.orientation} : null; orientation = identityQuaternion(); attitudeAt = null;};
  return {
    recenter(sample) {reset(isMotionSample(sample) ? sample : undefined);},
    reset() {reset();},
    push(sample) {
      if (!isMotionSample(sample) || !sample.angularVelocity) {reset(); return null;}
      if (previous && (sample.sequence <= previous.sequence || sample.timeSeconds <= previous.timeSeconds)) return null;
      const continuity = previous && sample.timeSeconds - previous.timeSeconds <= maxGapSeconds &&
        sample.calibrationRevision === previous.calibrationRevision && sample.screenAngle === previous.screenAngle;
      const sampleAttitudeAt = sample.orientation ? sample.orientationTimeSeconds ?? sample.timeSeconds : null;
      if (!continuity) {neutral = sample.orientation ? {...sample.orientation} : null; orientation = identityQuaternion(); attitudeAt = sampleAttitudeAt;}
      const angularVelocity = continuity ? rotateVectorToScreen(sample.angularVelocity, sample.screenAngle) : {x: 0, y: 0, z: 0};
      if (continuity) {
        orientation = normalizeQuaternion(multiplyQuaternions(orientation, gyroStep(angularVelocity, sample.timeSeconds - previous.timeSeconds)));
      }
      // DeviceOrientation can arrive more slowly than the gyro. Reapplying
      // its cached quaternion on every sample freezes aim between updates.
      // Consume each attitude once; fresh gyro carries the pose in between.
      if (continuity && sample.orientation && (attitudeAt === null || sampleAttitudeAt > attitudeAt)) {
        const halfAngle = -sample.screenAngle * DEG_TO_RAD / 2;
        const screen = {x: 0, y: 0, z: Math.sin(halfAngle), w: Math.cos(halfAngle)};
        if (!neutral) {
          // Attitude may become available after gyro setup. Anchor it to the
          // existing pose instead of jumping back to the middle of the table.
          const relative = multiplyQuaternions(multiplyQuaternions(inverseQuaternion(screen), orientation), screen);
          neutral = normalizeQuaternion(multiplyQuaternions(sample.orientation, inverseQuaternion(relative)));
        } else {
          const relative = multiplyQuaternions(inverseQuaternion(neutral), sample.orientation);
          orientation = normalizeQuaternion(multiplyQuaternions(multiplyQuaternions(screen, relative), inverseQuaternion(screen)));
        }
        attitudeAt = sampleAttitudeAt;
      }
      previous = sample;
      // Roll/tilt supply bounded virtual reach. A hand preference does not
      // change the phone's coordinate frame. No acceleration integration.
      const reach = {x: clamp(orientation.y * 2 * gain, -1, 1),
        y: clamp(-orientation.x * 2 * gain, -1, 1)};
      return {orientation: [orientation.x, orientation.y, orientation.z, orientation.w],
        angularVelocity: Object.fromEntries(axes.map(axis => [axis, clamp(angularVelocity[axis] * gain, -30, 30)])),
        reach, sequence: sample.sequence, sampleTime: sample.timeSeconds, calibrationRevision: sample.calibrationRevision};
    },
  };
}
/** Local, explicit recorder. Only canonical sample fields can be retained. */
export function createMotionRecorder({maxSamples = 6000, sport = 'tennis', adapterVersion = '1'} = {}) {
  const samples = [];
  const limit = Math.min(30000, Math.max(1, Number.isSafeInteger(maxSamples) ? maxSamples : 6000));
  return {
    record(sample) {
      if (!isMotionSample(sample)) return false;
      const safe = {schemaVersion: 1, timeSeconds: sample.timeSeconds, sequence: sample.sequence,
        screenAngle: sample.screenAngle, calibrationRevision: sample.calibrationRevision};
      if (sample.orientationTimeSeconds !== undefined) safe.orientationTimeSeconds = sample.orientationTimeSeconds;
      for (const key of ['angularVelocity', 'acceleration', 'accelerationIncludingGravity', 'gravity', 'orientation']) {
        if (sample[key]) safe[key] = key === 'orientation' ? normalizeQuaternion(sample[key]) : vector(sample[key]);
      }
      samples.push(safe);
      if (samples.length > limit) samples.shift();
      return true;
    },
    export() {return {schemaVersion: 1, adapterVersion: String(adapterVersion).slice(0, 50),
      sport: ['tennis', 'bowling'].includes(sport) ? sport : 'unknown', samples: JSON.parse(JSON.stringify(samples))};},
    clear() {samples.length = 0;},
  };
}

/** Automatic readiness is separate from a verified stationary gyro estimate.
 * A short continuous stream can play with provisional zero bias; it never has
 * to finish a hold-still checklist. Quiet refinement is allowed only at a
 * caller-declared safe boundary, never during a delivery or rally.
 */
export function createAutomaticMotionSetup({warmupSeconds = .15, minimumSamples = 5,
  maxGapSeconds = .25, quietWindowSeconds = .6} = {}) {
  if (![warmupSeconds, maxGapSeconds, quietWindowSeconds].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isSafeInteger(minimumSamples) || minimumSamples < 2) throw new RangeError('Invalid automatic motion timing');
  let first = null, previous = null, count = 0, calibration = null, revision = 0;
  let bias = {x: 0, y: 0, z: 0}, biasSource = 'provisional', quiet = [], centeredAtBoundary = false;
  const clear = () => {first = null; previous = null; count = 0; calibration = null; quiet = []; centeredAtBoundary = false;};
  const status = (sample, justReady = false) => ({state: calibration ? 'ready' : 'warming', ready: Boolean(calibration),
    justReady, calibration: calibration ? {...calibration, bias: {...calibration.bias},
      ...(calibration.neutralOrientation ? {neutralOrientation: {...calibration.neutralOrientation}} : {})} : null,
    sample: calibration ? applyMotionCalibration(sample, calibration) : null, biasSource});
  return {
    push(sample, {safeBoundary = false, recenter = false} = {}) {
      if (!isMotionSample(sample) || !sample.angularVelocity) {
        clear(); return {...status(null), state: 'no-readings'};
      }
      if (previous && (sample.timeSeconds <= previous.timeSeconds || sample.sequence <= previous.sequence ||
          sample.timeSeconds - previous.timeSeconds > maxGapSeconds || sample.screenAngle !== previous.screenAngle)) clear();
      first ??= sample.timeSeconds;
      previous = sample; count++;
      let justReady = false;
      if (!calibration && count >= minimumSamples && sample.timeSeconds - first >= warmupSeconds - 1e-9) {
        calibration = {revision: ++revision, bias: {...bias}, screenAngle: sample.screenAngle};
        if (sample.orientation) calibration.neutralOrientation = {...sample.orientation};
        justReady = true;
      }
      if (!safeBoundary) {quiet = []; centeredAtBoundary = false; return status(sample, justReady);}
      const rate = sample.angularVelocity;
      const lowRate = Math.hypot(rate.x, rate.y, rate.z) <= 5 * DEG_TO_RAD;
      // A large linear acceleration or non-gravity total rejects bias fitting.
      const linearQuiet = !sample.acceleration || Math.hypot(...axes.map(axis => sample.acceleration[axis])) <= 1;
      const total = sample.accelerationIncludingGravity;
      const totalQuiet = !total || Math.abs(Math.hypot(total.x, total.y, total.z) - 9.80665) <= 1.5;
      if (!lowRate || !linearQuiet || !totalQuiet) {quiet = []; return status(sample, justReady);}
      quiet.push(sample);
      while (quiet.length > 1 && quiet[1].timeSeconds <= sample.timeSeconds - quietWindowSeconds) quiet.shift();
      if (quiet.length > 1000) quiet.shift();
      if (!calibration || quiet.length < minimumSamples || sample.timeSeconds - quiet[0].timeSeconds < quietWindowSeconds - 1e-9) return status(sample, justReady);
      const candidate = Object.fromEntries(axes.map(axis => [axis, quiet.reduce((sum, s) => sum + s.angularVelocity[axis], 0) / quiet.length]));
      const variation = Math.sqrt(quiet.reduce((sum, s) => sum + axes.reduce((total, axis) => total +
        (s.angularVelocity[axis] - candidate[axis]) ** 2, 0), 0) / quiet.length);
      if (variation > 3 * DEG_TO_RAD) return status(sample, justReady);
      const changedBias = axes.some(axis => Math.abs(candidate[axis] - bias[axis]) > 1e-5);
      const changeNeutral = recenter && !centeredAtBoundary;
      if (changedBias || biasSource === 'provisional' || changeNeutral) {
        bias = candidate; biasSource = 'stationary';
        calibration = {...calibration, revision: ++revision, bias: {...bias}};
        if (changeNeutral) {
          if (sample.orientation) calibration.neutralOrientation = {...sample.orientation};
          else delete calibration.neutralOrientation;
          centeredAtBoundary = true;
        }
      }
      return status(sample, justReady);
    },
    /** Watchdog for a silent sensor stream. Reading status never replays input. */
    read(timeSeconds) {
      if (!Number.isFinite(timeSeconds) || !previous || timeSeconds < previous.timeSeconds ||
          timeSeconds - previous.timeSeconds > maxGapSeconds) clear();
      return {...status(null), sample: null};
    },
    /** Interruptions discard partial movement but retain a bounded bias estimate. */
    reset() {clear();},
    get ready() {return Boolean(calibration);},
  };
}
