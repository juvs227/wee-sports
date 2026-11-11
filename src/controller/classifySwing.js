export const classifierVersion = 'acceleration-threshold-v1'
export const SWING_LIMITS = Object.freeze({ start: 25 })
const COOLDOWN_MS = 1000

export function createSwingDetector() {
  let above = false
  let lastSwing = -Infinity
  return {
    push(sample) {
      if (!Number.isFinite(sample.timeMs) || !Number.isFinite(sample.accelMag)) return null
      const { timeMs, accelMag } = sample
      if (accelMag >= SWING_LIMITS.start) {
        if (!above && timeMs - lastSwing >= COOLDOWN_MS) {
          above = true
          lastSwing = timeMs
          let label = 'Forehand';
          if (sample.netOrientation && sample.currentNormal) {
            const n = sample.netOrientation.normal;
            const c = sample.currentNormal;
            const dot = c[0]*n[0] + c[1]*n[1] + c[2]*n[2];
            label = dot >= 0 ? 'Forehand' : 'Backhand';
          }
          return { label, complete: true, peakRotation: 500, startMs: timeMs, peakTimeMs: timeMs }
        }
      } else {
        above = false
      }
      return null
    },
  }
}
