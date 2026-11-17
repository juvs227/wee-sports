/**
 * androidCalibration.js — AbsoluteOrientationSensor source for Android Chrome.
 *
 * Returns a source object compatible with createOrientationCalibration:
 *   { onReading, start(), stop(), getNormal(), getQuaternion() }
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

function qnorm(q) { const l = Math.hypot(...q); return q.map(v => v / l); }

// ── Source factory ────────────────────────────────────────────────────────────

/**
 * Creates an orientation source backed by AbsoluteOrientationSensor (Android Chrome).
 *
 * @returns {{ onReading: null|function, start: function, stop: function, getNormal: function, getQuaternion: function }}
 */
export function createAndroidOrientationSource() {
  let currentQuat   = null;
  let currentNormal = null;
  let sensor        = null;

  const source = {
    onReading: null,

    async start() {
      if (navigator.permissions) {
        await Promise.all([
          navigator.permissions.query({ name: 'accelerometer' }),
          navigator.permissions.query({ name: 'gyroscope' }),
          navigator.permissions.query({ name: 'magnetometer' }),
        ]);
      }

      sensor = new window.AbsoluteOrientationSensor({ frequency: 30 });

      sensor.addEventListener('reading', () => {
        const quat   = [...sensor.quaternion];
        const normal = qrot(quat, [0, 0, 1]);
        currentQuat   = quat;
        currentNormal = normal;
        if (source.onReading) source.onReading(quat, normal);
      });

      sensor.addEventListener('error', () => {
        // Sensor errors after start — nothing to do, let caller handle silence.
      });

      sensor.start();
    },

    stop() {
      if (sensor) {
        sensor.stop();
        sensor = null;
      }
    },

    getNormal()     { return currentNormal ? [...currentNormal] : null; },
    getQuaternion() { return currentQuat   ? [...currentQuat]   : null; },
  };

  return source;
}
