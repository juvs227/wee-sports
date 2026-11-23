/**
 * Platform-agnostic orientation source.
 *
 * Tries RelativeOrientationSensor first (Android Chrome). Falls back to the
 * Mahony accel+gyro fusion (iOS Safari and anywhere the Sensor API fails).
 * Both paths produce the same (quaternion, normal) output via onReading.
 *
 * Yaw is relative to wherever the phone was when start() was called.
 * Pitch/roll are gravity-anchored on both paths.
 */

import {createIOSFusion} from './iosFusion.js';

function qrot([qx, qy, qz, qw], [vx, vy, vz]) {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

export function createOrientationSource({
  onReading = () => {},
  target = globalThis.window,
} = {}) {
  let sensor = null;
  let fusion = null;
  let active = false;

  function startFusion() {
    fusion = createIOSFusion({onReading, target});
    fusion.start();
  }

  return {
    start() {
      if (active) return;
      active = true;

      if (typeof target?.RelativeOrientationSensor === 'function') {
        try {
          sensor = new target.RelativeOrientationSensor({frequency: 60});
          sensor.addEventListener('reading', () => {
            const q = sensor.quaternion;
            if (!q || q.length !== 4) return;
            const arr = [...q];
            onReading(arr, qrot(arr, [0, 0, 1]));
          });
          sensor.addEventListener('error', () => {
            try { sensor.stop(); } catch {}
            sensor = null;
            if (active) startFusion();
          });
          sensor.start();
          return;
        } catch {
          sensor = null;
        }
      }

      startFusion();
    },
    stop() {
      active = false;
      try { sensor?.stop(); } catch {}
      sensor = null;
      fusion?.stop();
      fusion = null;
    },
  };
}
