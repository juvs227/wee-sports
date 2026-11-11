/**
 * Orientation calibration ported from swing-faster/orientation-phone.html.
 * Captures the screen's net-facing direction as a quaternion reference.
 *
 * State machine: waiting_still → calibrating → done
 * Stillness is measured as quaternion angular distance to avoid Euler wrapping.
 *
 * Sensor setup is delegated to the source objects in androidCalibration.js and
 * iosCalibration.js — this file contains only the calibration logic.
 */

import { createAndroidOrientationSource } from './androidCalibration.js';
import { createIOSOrientationSource }     from './iosCalibration.js';

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


// ── Source factory ────────────────────────────────────────────────────────────

/**
 * Returns the appropriate orientation source for the current platform.
 * Android: uses AbsoluteOrientationSensor.
 * iOS / fallback: uses Mahony filter over devicemotion + deviceorientationabsolute.
 *
 * @param {object} [opts]
 * @param {{ alpha: number, beta: number, gamma: number }} [opts.bias]
 * @returns source object with { onReading, start(), stop(), getNormal(), getQuaternion() }
 */
export function createOrientationSource({ bias } = {}) {
  if ('AbsoluteOrientationSensor' in window) {
    return createAndroidOrientationSource();
  }
  return createIOSOrientationSource(bias ?? { alpha: 0, beta: 0, gamma: 0 });
}

// ── Calibration session ───────────────────────────────────────────────────────

const STILL_REQUIRED_MS = 500;  // phone must be still before capture starts
const CAPTURE_MS        = 2000; // duration of the capture window
const STILL_THRESH_DEG  = 1.5;  // °/frame threshold for "still"

/**
 * @param {object} opts
 * @param {object} opts.source  orientation source from createOrientationSource (or custom)
 * @param {(progress: number, state: 'settling'|'moving'|'calibrating') => void} opts.onProgress
 * @param {(normal: number[], quat: number[]) => void} opts.onDone
 * @returns {{ start: () => Promise<void>, stop: () => void }}
 */
export function createOrientationCalibration({ source, onProgress, onDone }) {
  let calState   = 'waiting_still';
  let stillSince = null;
  let calStart   = null;
  let calSamples = [];
  let lastQuat   = null;
  let stopped    = false;

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
        source.onReading = null; // detach — source keeps running for live game
        onDone(refNormal, refQuat);
      }
    }
  }

  return {
    start() {
      if (stopped) return;
      source.onReading = tick; // source is already running — just hook in
    },
    stop() {
      stopped = true;
      source.onReading = null;
    },
  };
}
