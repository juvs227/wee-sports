/**
 * iosCalibration.js — iOS sensor fusion for stable yaw tracking
 *
 * Recreates what AbsoluteOrientationSensor does on Android Chrome, using only
 * APIs available on iOS:
 *   - devicemotion.rotationRate          → gyroscope (fast, stable, no magnetic noise)
 *   - devicemotion.accelerationIncludingGravity → corrects pitch/roll drift
 *   - deviceorientation.alpha            → compass heading, corrects yaw drift only
 *
 * The Mahony filter integrates gyroscope continuously and uses the accelerometer
 * and compass as slow corrections — so magnetometer spikes and 180° flips have
 * minimal influence, same as AbsoluteOrientationSensor's internal Kalman filter.
 *
 * Coordinate convention throughout:
 *   Quaternion: [x, y, z, w]  (matches orientationCalibration.js)
 *   World frame: ENU — x=East, y=North, z=Up
 *   Gravity reference: [0, 0, 1] in world frame (up)
 *
 * Not wired into anything yet. Entry point: createIOSOrientationTracker.
 */

// ── Quaternion helpers ────────────────────────────────────────────────────────

function qnorm([x, y, z, w]) {
  const l = Math.hypot(x, y, z, w);
  return [x/l, y/l, z/l, w/l];
}

/** Rotate vector v by quaternion q = [x, y, z, w]. */
function qrot([qx, qy, qz, qw], [vx, vy, vz]) {
  const tx = 2*(qy*vz - qz*vy);
  const ty = 2*(qz*vx - qx*vz);
  const tz = 2*(qx*vy - qy*vx);
  return [
    vx + qw*tx + qy*tz - qz*ty,
    vy + qw*ty + qz*tx - qx*tz,
    vz + qw*tz + qx*ty - qy*tx,
  ];
}

/** Yaw angle (radians) from quaternion [x, y, z, w] in ENU frame. */
function quatToYaw([x, y, z, w]) {
  return Math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z));
}

/** Wrap angle to [-π, π]. */
function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

// ── 1. Gyroscope bias calibration ─────────────────────────────────────────────

/**
 * Measures gyroscope resting offset while the phone is held still.
 * Without this, integrating rotationRate would drift even at rest.
 *
 * Usage:
 *   const cal = createGyroBiasCalibration({ onDone: bias => ... });
 *   // feed it devicemotion events:
 *   window.addEventListener('devicemotion', e => cal.push(e));
 *
 * @param {object} opts
 * @param {number} [opts.durationMs=1500]  how long to collect while still
 * @param {number} [opts.stillThreshold=1] max deg/s variance to consider still
 * @param {(bias: {alpha:number, beta:number, gamma:number}) => void} opts.onDone
 */
export function createGyroBiasCalibration({ durationMs = 1500, stillThreshold = 1, onProgress, onDone }) {
  const samples = [];
  let startedAt = null;
  let done = false;

  function push(event) {
    if (done) return;
    const r = event.rotationRate;
    if (!r || !['alpha','beta','gamma'].every(k => Number.isFinite(r[k]))) return;

    const now = performance.now();

    const mag = Math.hypot(r.alpha, r.beta, r.gamma);
    if (mag > stillThreshold) {
      samples.length = 0;
      startedAt = null;
      onProgress?.(0, 'moving');
      return;
    }

    if (startedAt === null) startedAt = now;
    samples.push({ alpha: r.alpha, beta: r.beta, gamma: r.gamma });

    const progress = Math.min(1, (now - startedAt) / durationMs);
    onProgress?.(progress, 'calibrating');

    if (progress >= 1) {
      done = true;
      const n = samples.length;
      const bias = {
        alpha: samples.reduce((s, v) => s + v.alpha, 0) / n,
        beta:  samples.reduce((s, v) => s + v.beta,  0) / n,
        gamma: samples.reduce((s, v) => s + v.gamma, 0) / n,
      };
      onDone(bias);
    }
  }

  return { push, isDone: () => done };
}

// ── 2. Mahony filter ───────────────────────────────────────────────────────────

/**
 * Mahony complementary filter — integrates gyroscope and corrects drift using
 * accelerometer (pitch/roll) and compass heading (yaw only).
 *
 * Tuning parameters:
 *   Kp     — how strongly accelerometer corrects pitch/roll each step.
 *             Higher = faster correction but more susceptible to accel noise.
 *   Ki     — integral term that slowly removes gyro bias that survived calibration.
 *             Keep small.
 *   KpYaw  — how strongly compass heading corrects yaw each step.
 *             Lower than Kp so magnetometer spikes have little influence.
 *
 * @param {object} [opts]
 * @param {number} [opts.Kp=2.0]
 * @param {number} [opts.Ki=0.005]
 * @param {number} [opts.KpYaw=0.2]
 */
export function createMahonyFilter({ Kp = 2.0, Ki = 0.005, KpYaw = 0.2 } = {}) {
  // Quaternion state [x, y, z, w], starts as identity (no rotation)
  let q = [0, 0, 0, 1];
  // Accumulated integral error for gyro bias trimming
  let eInt = [0, 0, 0];

  /**
   * Update the filter with one sensor frame.
   *
   * @param {object} opts
   * @param {[number,number,number]} opts.gyro   rotationRate [alpha,beta,gamma] in deg/s
   * @param {[number,number,number]} opts.accel  accelerationIncludingGravity [x,y,z] in m/s²
   * @param {number|null}            opts.compassDeg  deviceorientation alpha (0–360), or null
   * @param {number}                 opts.dt     seconds since last call
   * @returns {[number,number,number,number]} quaternion [x, y, z, w]
   */
  function update({ gyro, accel, compassDeg, dt }) {
    // Convert gyro from deg/s → rad/s and subtract any residual bias via integral
    let gx = gyro[0] * Math.PI / 180;
    let gy = gyro[1] * Math.PI / 180;
    let gz = gyro[2] * Math.PI / 180;

    const [qx, qy, qz, qw] = q;
    let ex = 0, ey = 0, ez = 0;

    // ── Accelerometer correction (pitch + roll) ──────────────────────────────
    // Only trust it when the phone isn't accelerating hard (near 1g = no swing)
    const aMag = Math.hypot(...accel);
    if (aMag > 0.5 && aMag < 19.6) { // 0.5–2g range: trust accel
      const [ax, ay, az] = accel.map(v => v / aMag);

      // Estimated gravity direction in body frame from current quaternion.
      // World gravity = [0, 0, 1] rotated into body frame by q_conjugate.
      const vx = 2*(qx*qz - qw*qy);
      const vy = 2*(qw*qx + qy*qz);
      const vz = qw*qw - qx*qx - qy*qy + qz*qz;

      // Cross product between measured and estimated gravity → pitch/roll error
      ex += ay*vz - az*vy;
      ey += az*vx - ax*vz;
      ez += ax*vy - ay*vx;
    }

    // ── Compass yaw correction ───────────────────────────────────────────────
    // Apply only to Z (yaw) axis. The Kalman filter insight: use a small KpYaw
    // so a sudden 180° flip barely moves the output — gyro wins short-term.
    if (compassDeg != null) {
      // alpha is degrees clockwise from north in W3C frame.
      // ENU yaw = 0 facing north, positive counter-clockwise.
      // Convert: ENU yaw = -alpha (clockwise → counter-clockwise)
      const measuredYaw = -compassDeg * Math.PI / 180;
      const estimatedYaw = quatToYaw(q);
      ez += KpYaw * wrapPi(measuredYaw - estimatedYaw);
    }

    // ── Integral feedback (trims residual gyro bias) ─────────────────────────
    eInt[0] += ex * Ki * dt;
    eInt[1] += ey * Ki * dt;
    eInt[2] += ez * Ki * dt;

    // ── Apply corrections ────────────────────────────────────────────────────
    gx += Kp * ex + eInt[0];
    gy += Kp * ey + eInt[1];
    gz += Kp * ez + eInt[2];

    // ── Integrate quaternion: q += 0.5 * dt * q ⊗ [gx, gy, gz, 0] ──────────
    const h = 0.5 * dt;
    q = qnorm([
      qx + h*( qw*gx + qy*gz - qz*gy),
      qy + h*( qw*gy - qx*gz + qz*gx),
      qz + h*( qw*gz + qx*gy - qy*gx),
      qw + h*(-qx*gx - qy*gy - qz*gz),
    ]);

    return [...q];
  }

  /** Screen normal vector in world frame: where the phone screen is pointing. */
  function getNormal() {
    return qrot(q, [0, 0, 1]);
  }

  /** Reset to identity — call after recalibrating. */
  function reset() {
    q = [0, 0, 0, 1];
    eInt = [0, 0, 0];
  }

  return { update, getNormal, getQuaternion: () => [...q], reset };
}

// ── 3. High-level tracker ─────────────────────────────────────────────────────

/**
 * Full iOS orientation tracker. Wires devicemotion + deviceorientation into
 * the Mahony filter and calls onNormal with the stable screen normal each frame.
 *
 * NOT connected to anything yet — call start() / stop() when ready to wire up.
 *
 * @param {object} opts
 * @param {{ alpha, beta, gamma }} opts.bias   gyro bias from createGyroBiasCalibration
 * @param {(normal: number[]) => void} opts.onNormal  called each frame with [x,y,z]
 * @param {object} [opts.filterOpts]  passed to createMahonyFilter
 */
export function createIOSOrientationTracker({ bias, onNormal, filterOpts = {} }) {
  const filter = createMahonyFilter(filterOpts);
  let lastTime = null;
  let compassDeg = null;
  let stopped = false;

  function onMotion(event) {
    if (stopped) return;
    const r = event.rotationRate;
    const a = event.accelerationIncludingGravity;
    if (!r || !a) return;

    const now = performance.now();
    const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    if (dt <= 0 || dt > 0.1) return; // skip first frame and big gaps

    // Subtract gyro bias captured during still calibration
    const gyro = [
      r.alpha - bias.alpha,
      r.beta  - bias.beta,
      r.gamma - bias.gamma,
    ];

    filter.update({
      gyro,
      accel: [a.x ?? 0, a.y ?? 0, a.z ?? 0],
      compassDeg,
      dt,
    });

    onNormal(filter.getNormal());
  }

  function onOrientation(event) {
    if (stopped || event.alpha == null) return;
    compassDeg = event.alpha;
  }

  function start() {
    stopped = false;
    filter.reset();
    lastTime = null;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
  }

  function stop() {
    stopped = true;
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  }

  return { start, stop, getQuaternion: () => filter.getQuaternion() };
}

// ── 4. iOS orientation source (source interface) ──────────────────────────────

/**
 * Creates an orientation source backed by iOS sensors (Mahony filter).
 * Implements the same interface as createAndroidOrientationSource:
 *   { onReading, start(), stop(), getNormal(), getQuaternion() }
 *
 * @param {{ alpha: number, beta: number, gamma: number }} bias  gyro bias from createGyroBiasCalibration
 * @returns {{ onReading: null|function, start: function, stop: function, getNormal: function, getQuaternion: function }}
 */
export function createIOSOrientationSource(bias) {
  const filter    = createMahonyFilter();
  let lastTime    = null;
  let compassDeg  = null;
  let stopped     = false;

  const source = {
    onReading: null,

    start() {
      stopped  = false;
      lastTime = null;
      filter.reset();
      window.addEventListener('devicemotion',              onMotion);
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
    },

    stop() {
      stopped = true;
      window.removeEventListener('devicemotion',              onMotion);
      window.removeEventListener('deviceorientationabsolute', onOrientation, true);
    },

    getNormal()     { return filter.getNormal(); },
    getQuaternion() { return filter.getQuaternion(); },
  };

  function onMotion(event) {
    if (stopped) return;
    const r = event.rotationRate;
    const a = event.accelerationIncludingGravity;
    if (!r || !a) return;

    const now = performance.now();
    const dt  = lastTime === null ? 0 : (now - lastTime) / 1000;
    lastTime  = now;
    if (dt <= 0 || dt > 0.1) return;

    const gyro = [
      r.alpha - bias.alpha,
      r.beta  - bias.beta,
      r.gamma - bias.gamma,
    ];

    const quat = filter.update({
      gyro,
      accel: [a.x ?? 0, a.y ?? 0, a.z ?? 0],
      compassDeg,
      dt,
    });

    const normal = filter.getNormal();
    if (source.onReading) source.onReading(quat, normal);
  }

  function onOrientation(event) {
    if (stopped || event.alpha == null) return;
    compassDeg = event.alpha;
  }

  return source;
}
