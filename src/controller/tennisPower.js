/** A comfortable game-strength estimate from calibrated gyro speed (degrees/s).
 * This is not physical force. Saturation means swinging harder has no benefit
 * beyond the useful range; low sensor noise never creates a stroke by itself.
 */
export function tennisPower(peakRotation, profile = null, label = 'Forehand') {
  if (!Number.isFinite(peakRotation)) return 0.5;
  const multiplier = Number.isFinite(profile?.[label]) ? Math.max(0.75, Math.min(1.75, profile[label])) : 1;
  const amount = Math.max(0, Math.min(1, (peakRotation * multiplier - 280) / 920));
  return 0.2 + 0.8 * amount * amount * (3 - 2 * amount);
}

export function tennisStrength(power) {
  return power < 0.4 ? 'Gentle' : power > 0.75 ? 'Strong' : 'Medium';
}
