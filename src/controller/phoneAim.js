export const AIM_MAX_AGE_MS = 250;
export const AIM_FULL_TILT_DEGREES = 65;
const DEAD_ZONE = 3;

// Orientation history uses the phone's monotonic clock, just like gyro samples.
// Use the most recent angle at/before the detected peak, not follow-through.
export function aimAtTime(history, neutral, timeMs, invert = false) {
  if (!neutral || !Number.isFinite(neutral.gamma) || !Number.isFinite(timeMs)) return null;
  let sample;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timeMs <= timeMs) { sample = history[i]; break; }
  }
  if (!sample || !Number.isFinite(sample.gamma) || timeMs - sample.timeMs > AIM_MAX_AGE_MS ||
      sample.screenAngle !== neutral.screenAngle) return null;
  const tiltDegrees = ((sample.gamma - neutral.gamma + 540) % 360) - 180;
  const magnitude = Math.max(0, Math.abs(tiltDegrees) - DEAD_ZONE) / (AIM_FULL_TILT_DEGREES - DEAD_ZONE);
  const aimX = Math.sign(tiltDegrees) * Math.min(1, magnitude) * (invert ? -1 : 1);
  const depthTiltDegrees = Number.isFinite(sample.beta) && Number.isFinite(neutral.beta)
    ? ((sample.beta - neutral.beta + 540) % 360) - 180 : undefined;
  const aimDepth = depthTiltDegrees === undefined ? undefined
    : Math.sign(depthTiltDegrees) * Math.min(1, Math.max(0, Math.abs(depthTiltDegrees) - DEAD_ZONE) / 42);
  return { aimX, tiltDegrees, aimDepth, depthTiltDegrees };
}
