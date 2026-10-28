/** Same stillness limits as the motion prototype, kept separate for testing. */
export function calibrationBias(samples, ageMs) {
  const axes = ['alpha', 'beta', 'gamma'];
  if (samples.length < 10 || ageMs >= 500 || ageMs < 0 ||
      !samples.every(sample => axes.every(axis => Number.isFinite(sample[axis])))) return null;
  const means = Object.fromEntries(axes.map(axis => [axis,
    samples.reduce((sum, sample) => sum + sample[axis], 0) / samples.length]));
  const variation = Math.sqrt(samples.reduce((sum, sample) => sum + axes.reduce((v, axis) =>
    v + (sample[axis] - means[axis]) ** 2, 0), 0) / samples.length);
  return Math.hypot(...Object.values(means)) <= 5 && variation <= 3 ? means : null;
}
