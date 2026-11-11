/**
 * Orientation calibration ported from swing-faster/orientation-phone.html.
 * Captures the screen's net-facing direction as a quaternion reference.
 *
 * Uses AbsoluteOrientationSensor (Android Chrome) when available, falls back
 * to deviceorientationabsolute, then deviceorientation.
 *
 * State machine: waiting_still → calibrating → done
 * Stillness is measured as quaternion angular distance to avoid Euler wrapping.
 */

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Rotate vector v by quaternion q = [x,y,z,w]. */
function qrot(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

function qdot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }

/** Angular distance between two quaternions in degrees. */
function qdeg(a, b) { return 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b)))) * 180 / Math.PI; }

function qnorm(q) { const l = Math.hypot(...q); return q.map(v => v / l); }

/**
 * W3C deviceorientation Euler → screen normal vector in ENU world space.
 * Column 3 of the W3C rotation matrix is the screen's outward normal.
 */
export function eulerToNormal(alpha, beta, gamma) {
  const a = alpha * Math.PI / 180;
  const b = beta  * Math.PI / 180;
  const g = gamma * Math.PI / 180;
  return [
    -Math.cos(a) * Math.sin(g) + Math.cos(g) * Math.sin(a) * Math.sin(b),
     Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.cos(g) * Math.sin(b),
     Math.cos(b) * Math.cos(g),
  ];
}

/** Approximate quaternion from W3C Euler angles (ZXY convention). */
function eulerToQuat(alpha, beta, gamma) {
  const a = alpha * Math.PI / 180;
  const b = beta  * Math.PI / 180;
  const g = gamma * Math.PI / 180;
  return [
    Math.sin(b/2)*Math.cos(g/2)*Math.cos(a/2) - Math.cos(b/2)*Math.sin(g/2)*Math.sin(a/2),
    Math.cos(b/2)*Math.sin(g/2)*Math.cos(a/2) + Math.sin(b/2)*Math.cos(g/2)*Math.sin(a/2),
    Math.cos(b/2)*Math.cos(g/2)*Math.sin(a/2) - Math.sin(b/2)*Math.sin(g/2)*Math.cos(a/2),
    Math.cos(b/2)*Math.cos(g/2)*Math.cos(a/2) + Math.sin(b/2)*Math.sin(g/2)*Math.sin(a/2),
  ];
}

// ── Calibration session ───────────────────────────────────────────────────────

const STILL_REQUIRED_MS = 500;  // phone must be still before capture starts
const CAPTURE_MS        = 2000; // duration of the capture window
const STILL_THRESH_DEG  = 1.5;  // °/frame threshold for "still"

/**
 * @param {object} opts
 * @param {(progress: number, state: 'settling'|'moving'|'calibrating') => void} opts.onProgress
 * @param {(normal: number[], quat: number[]) => void} opts.onDone
 * @returns {{ start: () => Promise<void>, stop: () => void }}
 */
export function createOrientationCalibration({ onProgress, onDone }) {
  let calState  = 'waiting_still';
  let stillSince = null;
  let calStart   = null;
  let calSamples = [];
  let lastQuat   = null;
  let stopped    = false;
  let cleanup    = () => {};

  function tick(quat, _normal) {
    if (stopped) return;
    const now = performance.now();

    const moving = lastQuat !== null && qdeg(lastQuat, quat) > STILL_THRESH_DEG;
    lastQuat = quat;

    if (calState === 'waiting_still') {
      if (moving) {
        stillSince = null;
        onProgress(0, 'moving');
      } else {
        if (stillSince === null) stillSince = now;
        if (now - stillSince >= STILL_REQUIRED_MS) {
          calState   = 'calibrating';
          calStart   = now;
          calSamples = [quat];
          onProgress(0, 'calibrating');
        } else {
          onProgress(0, 'settling');
        }
      }
      return;
    }

    if (calState === 'calibrating') {
      if (moving) {
        calState   = 'waiting_still';
        stillSince = null;
        calSamples = [];
        onProgress(0, 'moving');
        return;
      }

      // Sign-normalise relative to first sample to avoid quaternion double-cover.
      const q0 = calSamples[0];
      calSamples.push(qdot(q0, quat) >= 0 ? quat : quat.map(v => -v));

      const progress = Math.min(1, (now - calStart) / CAPTURE_MS);
      onProgress(progress, 'calibrating');

      if (progress >= 1) {
        // Average collected quaternions then normalise.
        const avg = [0, 0, 0, 0];
        for (const q of calSamples) { avg[0] += q[0]; avg[1] += q[1]; avg[2] += q[2]; avg[3] += q[3]; }
        const refQuat   = qnorm(avg);
        const refNormal = qrot(refQuat, [0, 0, 1]);
        calState = 'done';
        stopped  = true;
        cleanup();
        onDone(refNormal, refQuat);
      }
    }
  }

  async function start() {
    if (stopped) return;

    // ── AbsoluteOrientationSensor (Android Chrome — quaternion natively) ───
    if ('AbsoluteOrientationSensor' in window) {
      try {
        if (navigator.permissions) {
          await Promise.all([
            navigator.permissions.query({ name: 'accelerometer' }),
            navigator.permissions.query({ name: 'gyroscope' }),
            navigator.permissions.query({ name: 'magnetometer' }),
          ]);
        }
        const sensor = new window.AbsoluteOrientationSensor({ frequency: 30 });
        sensor.addEventListener('reading', () => {
          const q = [...sensor.quaternion];
          tick(q, qrot(q, [0, 0, 1]));
        });
        sensor.addEventListener('error', () => {
          // Sensor failed after start — don't throw, just let the fallback below handle it
          // (we can't switch mid-session, but at least we don't crash)
        });
        sensor.start();
        cleanup = () => sensor.stop();
        return;
      } catch {
        // Fall through to Euler fallback.
      }
    }

    // ── Euler fallback (iOS + older Android) ─────────────────────────────
    function handler(e) {
      if (e.alpha == null) return;
      tick(eulerToQuat(e.alpha, e.beta, e.gamma), eulerToNormal(e.alpha, e.beta, e.gamma));
    }
    // deviceorientationabsolute gives compass-referenced angles; prefer it.
    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation',         handler, true);
    cleanup = () => {
      window.removeEventListener('deviceorientationabsolute', handler, true);
      window.removeEventListener('deviceorientation',         handler, true);
    };
  }

  return {
    start,
    stop() { stopped = true; cleanup(); },
  };
}
