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

/** Wait for the phone to settle, then require a continuous window of still data.
 * Permission alone is never a successful calibration. Times are monotonic ms.
 */
export function createCalibrationSession(startedAt, { settleMs = 800, windowMs = 1200, timeoutMs = 10000 } = {}) {
  let samples = [];
  let lastReading = null;
  let result = null;
  let sawReadings = false;
  return {
    push(rate, timeMs) {
      if (result || !Number.isFinite(timeMs) || timeMs < startedAt ||
          !['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(rate?.[axis]))) return;
      sawReadings = true;
      if (lastReading !== null && (timeMs <= lastReading || timeMs - lastReading > 250)) samples = [];
      lastReading = timeMs;
      if (timeMs - startedAt < settleMs) return;
      samples.push({ alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma, timeMs });
      // Keep one sample at or before the edge, so duration does not depend on Hz.
      while (samples.length > 1 && samples[1].timeMs <= timeMs - windowMs) samples.shift();
      if (samples.length > 1000) samples.shift();
    },
    read(now) {
      if (result) return { state: 'done', bias: result, progress: 1 };
      const age = lastReading === null ? Infinity : now - lastReading;
      const duration = samples.length ? samples.at(-1).timeMs - samples[0].timeMs : 0;
      const candidate = calibrationBias(samples, age);
      if (duration >= windowMs && candidate) {
        result = candidate;
        return { state: 'done', bias: result, progress: 1 };
      }
      const reason = !sawReadings ? 'no-readings' : age >= 500 ? 'stale' :
        samples.length >= 10 && !candidate ? 'moving' : 'collecting';
      if (now - startedAt >= timeoutMs) return { state: 'failed', reason, progress: 0 };
      if (now - startedAt < settleMs) return { state: 'settling', progress: 0 };
      return { state: reason, progress: candidate ? Math.min(1, duration / windowMs) : 0 };
    },
  };
}
