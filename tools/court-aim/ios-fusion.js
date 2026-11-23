/**
 * ios-fusion.js — accel + gyro fusion (no magnetometer)
 *
 * Mahony complementary filter that replicates what RelativeOrientationSensor
 * does on Android, using only devicemotion (available on iOS and everywhere).
 *
 * No compass. Yaw is relative to wherever the phone was when start() was called,
 * same as RelativeOrientationSensor. Pitch/roll are gravity-anchored.
 *
 * Usage:
 *   const fusion = createIOSFusion({ onReading: (quat, normal) => {} });
 *   fusion.start();   // begins listening to devicemotion
 *   fusion.stop();    // removes listeners
 */

function qnorm([x, y, z, w]) {
  const l = Math.hypot(x, y, z, w);
  return [x/l, y/l, z/l, w/l];
}

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

/**
 * @param {object} opts
 * @param {(quat: number[], normal: number[]) => void} opts.onReading
 * @param {number} [opts.Kp=2.0]   accelerometer correction strength
 * @param {number} [opts.Ki=0.005] integral bias trim
 */
export function createIOSFusion({ onReading, Kp = 2.0, Ki = 0.005 }) {
  let q = [0, 0, 0, 1];
  let eInt = [0, 0, 0];
  let lastTime = null;
  let stopped = true;

  function onMotion(event) {
    if (stopped) return;
    const r = event.rotationRate;
    const a = event.accelerationIncludingGravity;
    if (!r || !a) return;

    const now = performance.now();
    const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    if (dt <= 0 || dt > 0.1) return;

    let gx = r.alpha * Math.PI / 180;
    let gy = r.beta  * Math.PI / 180;
    let gz = r.gamma * Math.PI / 180;

    const [qx, qy, qz, qw] = q;
    let ex = 0, ey = 0, ez = 0;

    // Accelerometer correction for pitch/roll — only when not in a hard swing
    const aMag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (aMag > 0.5 && aMag < 19.6) {
      const ax = (a.x ?? 0) / aMag;
      const ay = (a.y ?? 0) / aMag;
      const az = (a.z ?? 0) / aMag;

      // Estimated gravity in body frame from quaternion
      const vx = 2*(qx*qz - qw*qy);
      const vy = 2*(qw*qx + qy*qz);
      const vz = qw*qw - qx*qx - qy*qy + qz*qz;

      ex = ay*vz - az*vy;
      ey = az*vx - ax*vz;
      ez = ax*vy - ay*vx;
    }

    eInt[0] += ex * Ki * dt;
    eInt[1] += ey * Ki * dt;
    eInt[2] += ez * Ki * dt;

    gx += Kp * ex + eInt[0];
    gy += Kp * ey + eInt[1];
    gz += Kp * ez + eInt[2];

    const h = 0.5 * dt;
    q = qnorm([
      qx + h*( qw*gx + qy*gz - qz*gy),
      qy + h*( qw*gy - qx*gz + qz*gx),
      qz + h*( qw*gz + qx*gy - qy*gx),
      qw + h*(-qx*gx - qy*gy - qz*gz),
    ]);

    onReading([...q], qrot(q, [0, 0, 1]));
  }

  return {
    start() {
      q = [0, 0, 0, 1];
      eInt = [0, 0, 0];
      lastTime = null;
      stopped = false;
      window.addEventListener('devicemotion', onMotion);
    },
    stop() {
      stopped = true;
      window.removeEventListener('devicemotion', onMotion);
    },
  };
}
