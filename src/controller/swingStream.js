import { classifySwings, predictEarlySwing } from './classifySwing.js';

// Consume finished windows instead of repeatedly classifying session history.
export function createSwingStream(hand, { early = false, suppressReturns = true } = {}) {
  const createDetector = () => createDetectorStream(hand, early);
  let detector = createDetector();
  let recoveryStarted = null;
  let quietSince = null;
  let lastTime = null;
  let recoverySamples = [];
  return {
    push(sample) {
      const valid = Number.isFinite(sample.timeMs) &&
        [sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma].every(Number.isFinite);
      if (recoveryStarted !== null) {
        if (!valid) { quietSince = null; lastTime = null; return; }
        // A sensor gap is not evidence that the phone was still.
        if (lastTime === null || sample.timeMs <= lastTime || sample.timeMs - lastTime > 100) quietSince = null;
        lastTime = sample.timeMs;
        recoverySamples.push(sample);
        if (recoverySamples.length > 150) recoverySamples.shift();
        const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
        quietSince = speed < 120 ? quietSince ?? sample.timeMs : null;
        if (sample.timeMs - recoveryStarted >= 400 && quietSince !== null && sample.timeMs - quietSince >= 250) {
          recoveryStarted = null;
          quietSince = null;
          detector = createDetector();
        }
        return;
      }
      if (valid) lastTime = sample.timeMs;
      detector.push(sample);
    },
    analyze(final = false) {
      if (recoveryStarted !== null) return [];
      const results = detector.analyze(final);
      if (!suppressReturns) return results;
      const index = results.findIndex(result => result.label !== 'Unknown' && (result.complete || result.early));
      if (index !== -1) {
        recoveryStarted = lastTime;
        quietSince = null;
        recoverySamples = [];
        // Discard queued follow-through after the first actionable prediction.
        detector = createDetector();
        return results.slice(0, index + 1);
      }
      return results;
    },
    get phase() { return recoveryStarted === null ? 'ready' : 'recovering'; },
    get size() { return detector.size + recoverySamples.length; },
    get recoverySamples() { return [...recoverySamples]; },
  };
}

function createDetectorStream(hand, early) {
  if (early) return createEarlySwingStream(hand);
  let samples = [];
  let waitingForRest = false;
  let quietSince = null;
  return {
    push(sample) {
      if (waitingForRest) {
        const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
        quietSince = speed < 120 ? quietSince ?? sample.timeMs : null;
        if (quietSince !== null && sample.timeMs - quietSince >= 100) waitingForRest = false;
        return;
      }
      samples.push(sample);
      // Abnormally long continuous movement cannot be a valid <=1.5 s swing.
      // Wait for rest before starting again rather than slicing it into strokes.
      if (samples.length > 3000) {
        samples = [];
        waitingForRest = true;
        quietSince = null;
      }
    },
    analyze(final = false) {
      const results = classifySwings(samples, { hand, final });
      if (results.length) {
        const consumed = results.at(-1).endMs;
        samples = samples.filter(sample => sample.timeMs > consumed);
      } else if (samples.length && samples.at(-1).timeMs - samples[0].timeMs > 5000) {
        // Don't turn the tail of a long movement into a new, shorter stroke.
        samples = [];
        waitingForRest = true;
        quietSince = null;
      }
      return results;
    },
    get size() { return samples.length; },
  };
}

function createEarlySwingStream(hand) {
  let samples = [];
  let peak = 0;
  let quietSince = null;
  let fired = false;
  let candidateLabel = null;
  let candidateSince = 0;
  let previousTime = null;
  let waitingForRest = false;
  const pending = [];
  function reset() {
    samples = []; peak = 0; quietSince = null; fired = false;
    candidateLabel = null; waitingForRest = false;
  }
  return {
    push(sample) {
      const values = [sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma];
      if (!Number.isFinite(sample.timeMs) || !values.every(Number.isFinite)) {
        reset(); previousTime = null; return;
      }
      if (previousTime !== null && (sample.timeMs <= previousTime || sample.timeMs - previousTime > 100)) reset();
      previousTime = sample.timeMs;
      const speed = Math.hypot(...values);
      if (!samples.length && !waitingForRest && speed < 250) return;
      peak = Math.max(peak, speed);
      quietSince = speed < Math.max(120, peak * 0.35) ? quietSince ?? sample.timeMs : null;
      if (quietSince !== null && sample.timeMs - quietSince >= 100) { reset(); return; }
      if (waitingForRest) return;
      samples.push(sample);
      if (samples.length > 3000 || sample.timeMs - samples[0].timeMs > 1500) {
        samples = []; waitingForRest = true; return;
      }
      if (fired) return;
      const prediction = predictEarlySwing(samples, hand);
      if (!prediction) { candidateLabel = null; return; }
      if (candidateLabel !== prediction.label) {
        candidateLabel = prediction.label;
        candidateSince = sample.timeMs;
      }
      // Require repeated agreement for 30 ms after the classifier's minimum
      // 80 ms window, then latch until the motion drops back toward rest.
      if (sample.timeMs - candidateSince >= 30) {
        fired = true;
        pending.push({ ...prediction, detectedAtMs: sample.timeMs,
          detectionDelayMs: sample.timeMs - samples[0].timeMs });
        if (pending.length > 20) pending.shift();
      }
    },
    analyze(final = false) {
      const results = pending.splice(0);
      if (final) reset();
      return results;
    },
    get size() { return samples.length; },
  };
}
