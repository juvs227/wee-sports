/** PR 14's gyro/gravity orientation estimate for browsers without a native
 * quaternion sensor. This is a relative reference, not measured court position.
 * DeviceMotion uses alpha=X, beta=Y, gamma=Z and degrees/second.
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
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1 ||
        !Array.isArray(gyro) || gyro.length !== 3 || !gyro.every(Number.isFinite) ||
        !Array.isArray(accel) || accel.length !== 3 || !accel.every(Number.isFinite)) return [...q];
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
    if (Number.isFinite(compassDeg)) {
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

/** The legacy tracker delegates to the same lifecycle as the source. */
export function createIOSOrientationTracker({bias, onNormal, filterOpts = {}, ...options}) {
  const source = createIOSOrientationSource(bias, {...options, filterOpts});
  source.onReading = (_quaternion, normal) => onNormal(normal);
  return {start: source.start, stop: source.stop, getQuaternion: source.getQuaternion};
}

export function createIOSOrientationSource(bias = {}, {target = globalThis.window,
  clock = () => performance.now(), filterOpts = {}} = {}) {
  const filter = createMahonyFilter(filterOpts);
  const offsets = ['alpha', 'beta', 'gamma'].map(key => Number.isFinite(bias[key]) ? bias[key] : 0);
  let lastTime = null, compassDeg = null, compassAt = null, active = false, hasReading = false;
  const source = {
    onReading: null,
    start() {
      source.stop(); active = true; filter.reset();
      target.addEventListener('devicemotion', motion);
      target.addEventListener('deviceorientationabsolute', orientation, true);
      target.addEventListener('deviceorientation', orientation, true);
    },
    stop() {
      active = false; lastTime = null; compassDeg = null; compassAt = null; hasReading = false;
      target?.removeEventListener?.('devicemotion', motion);
      target?.removeEventListener?.('deviceorientationabsolute', orientation, true);
      target?.removeEventListener?.('deviceorientation', orientation, true);
    },
    getNormal: () => hasReading ? filter.getNormal() : null,
    getQuaternion: () => hasReading ? filter.getQuaternion() : null,
  };
  function motion(event) {
    if (!active || target.document?.hidden) {lastTime = null; return;}
    const rate = event.rotationRate, accel = event.accelerationIncludingGravity;
    if (!rate || !accel || !['alpha', 'beta', 'gamma'].every(key => Number.isFinite(rate[key])) ||
        !['x', 'y', 'z'].every(key => Number.isFinite(accel[key]))) {lastTime = null; return;}
    const now = clock();
    const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    if (dt <= 0 || dt > .1) return;
    const freshCompass = compassAt !== null && now >= compassAt && now - compassAt <= 250 ? compassDeg : null;
    const quaternion = filter.update({gyro: [rate.alpha - offsets[0], rate.beta - offsets[1], rate.gamma - offsets[2]],
      accel: [accel.x, accel.y, accel.z], compassDeg: freshCompass, dt});
    hasReading = true;
    source.onReading?.(quaternion, filter.getNormal());
  }
  function orientation(event) {
    if (!active || target.document?.hidden || !Number.isFinite(event.alpha) ||
        !(event.absolute === true || event.type === 'deviceorientationabsolute')) return;
    compassDeg = event.alpha; compassAt = clock();
  }
  return source;
}
