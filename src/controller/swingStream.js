import { classifySwings, predictEarlySwing, SWING_LIMITS } from './classifySwing.js';

// Keep each physical motion window intact until the team's relative-to-peak
// rest boundary. Fast confirmation can emit sooner, but never opens a second
// window in the same follow-through. Return filtering uses observed peak times,
// rather than requiring 250 ms of near-zero rotation between every stroke.
export function createSwingStream(hand, { early = false, fast = false, suppressReturns = true } = {}) {
  const detector = early ? createEarlySwingStream(hand) : createDetectorStream(hand, fast);
  let lastAcceptedPeak = null;
  let lastTime = null;
  let recoverySamples = [];
  return {
    push(sample) {
      if (Number.isFinite(sample.timeMs)) lastTime = sample.timeMs;
      detector.push(sample);
      if (lastAcceptedPeak !== null) {
        recoverySamples.push(sample);
        if (recoverySamples.length > 150) recoverySamples.shift();
      }
    },
    analyze(final = false) {
      const results = detector.analyze(final);
      if (!suppressReturns) return results;
      return results.filter(result => {
        if (result.label === 'Unknown' || !(result.complete || result.early || result.fast)) return true;
        if (lastAcceptedPeak !== null && result.peakTimeMs - lastAcceptedPeak < 400) return false;
        lastAcceptedPeak = result.peakTimeMs;
        recoverySamples = [];
        return true;
      });
    },
    get phase() {
      return detector.phase === 'recovering' || (suppressReturns && lastAcceptedPeak !== null &&
        lastTime - lastAcceptedPeak < 400) ? 'recovering' : detector.phase;
    },
    get size() { return detector.size + recoverySamples.length; },
    get recoverySamples() { return [...recoverySamples]; },
  };
}

function createDetectorStream(hand, fast) {
  let samples = [];
  let latchedStart = null;
  let waitingForRest = false;
  let quietSince = null;
  let previousTime = null;
  function waitForRest() {
    samples = []; latchedStart = null;
    waitingForRest = true; quietSince = null;
  }
  return {
    push(sample) {
      const valid = Number.isFinite(sample.timeMs) &&
        [sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma].every(Number.isFinite);
      const gap = previousTime !== null && (sample.timeMs <= previousTime || sample.timeMs - previousTime > 100);
      // Missing readings must not masquerade as a rest boundary after delivery.
      if ((!valid || gap) && latchedStart !== null) waitForRest();
      if (!valid || gap) quietSince = null;
      previousTime = valid ? sample.timeMs : null;
      if (waitingForRest) {
        if (!valid) return;
        const speed = Math.hypot(sample.rotationAlpha, sample.rotationBeta, sample.rotationGamma);
        quietSince = speed < 120 ? quietSince ?? sample.timeMs : null;
        if (quietSince !== null && sample.timeMs - quietSince >= 100) waitingForRest = false;
        return;
      }
      samples.push(sample);
      // Abnormally long movement cannot be a valid <=1.5 s swing. Do not
      // slice its tail into a new stroke just to cap memory.
      if (samples.length > 2800) waitForRest();
    },
    analyze(final = false) {
      const completed = classifySwings(samples, { hand, final });
      const results = completed.filter(result => result.startMs !== latchedStart);
      if (completed.length) {
        const consumed = completed.at(-1).endMs;
        if (latchedStart !== null && completed.some(result => result.startMs === latchedStart)) latchedStart = null;
        samples = samples.filter(sample => sample.timeMs > consumed);
      }
      if (fast && latchedStart === null && samples.length) {
        const prediction = classifySwings(samples, { hand, final: false, fast: true }).find(result => result.fast);
        if (prediction) {
          latchedStart = prediction.startMs;
          results.push(prediction);
        }
      }
      if (samples.length && samples.at(-1).timeMs - samples[0].timeMs > 5000) waitForRest();
      return results;
    },
    get size() { return samples.length; },
    get phase() { return waitingForRest ? 'waiting-for-rest' : latchedStart !== null ? 'recovering' : 'ready'; },
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
        const needsRest = fired || waitingForRest;
        reset(); waitingForRest = needsRest; previousTime = null; return;
      }
      if (previousTime !== null && (sample.timeMs <= previousTime || sample.timeMs - previousTime > 100)) {
        const needsRest = fired || waitingForRest;
        reset(); waitingForRest = needsRest;
      }
      previousTime = sample.timeMs;
      const speed = Math.hypot(...values);
      if (!samples.length && !waitingForRest && speed < SWING_LIMITS.start) return;
      peak = Math.max(peak, speed);
      quietSince = speed < (waitingForRest ? 120 : Math.max(120, peak * 0.35)) ? quietSince ?? sample.timeMs : null;
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
    get phase() { return waitingForRest ? 'waiting-for-rest' : fired ? 'recovering' : 'ready'; },
  };
}
