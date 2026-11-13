// Directional rules are covered by recorded mixed-hand strokes and negative
// recovery cases. Strength/travel gates remain separate from shot direction.
export const classifierVersion = 'gyro-handed-responsive-v11'
export const SWING_LIMITS = Object.freeze({ start: 200, minPeak: 280 })
// Keep the real peak and at least 40 ms of post-peak direction evidence. A
// sustained 12% drop is sufficient deceleration once that evidence exists.
// Requiring a larger slowdown added sensor frames to broad, valid swings.
// The hold spans at least two readings at 60 Hz; a one-sample dip cannot fire.
const FAST_DROP_RATIO = .88
const FAST_DROP_HOLD_MS = 16
const FAST_POST_PEAK_MS = 40
// Two 60 Hz readings can arrive a few milliseconds closer together than their
// nominal 16.7 ms interval. Require repeated directional evidence, allowing
// ordinary scheduling jitter without accepting a single sample or a burst.
const DIRECTION_SUPPORT_MS = 12
const axes = ['Alpha', 'Beta', 'Gamma']
const valid = sample => Number.isFinite(sample.timeMs) && axes.every(axis => Number.isFinite(sample[`rotation${axis}`]))
const speed = sample => Math.hypot(...axes.map(axis => sample[`rotation${axis}`]))

// Experimental: reuse directional rules before the window has finished.
// Other size/strength checks still apply, but this cannot validate the final stroke.
export function predictEarlySwing(samples, hand) {
  if (!samples.length || !samples.every(valid)) return null
  const prediction = describe(samples, true, hand)
  return prediction.label === 'Unknown' ? null : {
    ...prediction, complete: false, early: true,
    reason: `Early prediction: ${prediction.reason}`,
  }
}

function describe(window, complete, hand) {
  const peakSample = window.reduce((best, sample) => speed(sample) > speed(best) ? sample : best)
  // Direction at the same instant matters; unrelated global extrema can mislead.
  const rates = Object.fromEntries(axes.map(axis => [axis.toLowerCase(), peakSample[`rotation${axis}`]]))
  const peak = speed(peakSample)
  // An axis need not reach a hard-swing magnitude to supply clear direction.
  // Cap these floors for strong strokes; scale them for compact valid strokes.
  const alphaFloor = Math.min(200, peak * .4)
  const backhandBetaFloor = Math.min(160, peak * .2)
  // Axis peaks can be offset in time. Require repeated agreement near the
  // rotation peak rather than loosening the beta threshold for every motion.
  const backhandSupport = window.filter(sample =>
    Math.abs(sample.timeMs - peakSample.timeMs) <= 60 &&
    sample.rotationAlpha < -alphaFloor && sample.rotationBeta < -backhandBetaFloor)
  const sustainedBackhand = backhandSupport.length >= 2 &&
    backhandSupport.at(-1).timeMs - backhandSupport[0].timeMs >= DIRECTION_SUPPORT_MS
  const angles = { alpha: 0, beta: 0, gamma: 0 }
  for (let i = 1; i < window.length; i++) {
    const dt = (window[i].timeMs - window[i - 1].timeMs) / 1000
    for (const axis of axes) angles[axis.toLowerCase()] += (window[i - 1][`rotation${axis}`] + window[i][`rotation${axis}`]) / 2 * dt
  }
  const durationMs = window.at(-1).timeMs - window[0].timeMs
  let label = 'Unknown'
  let reason = 'Rotation directions overlap the screenshot examples.'
  if (!complete) reason = 'Motion window ended before a clear return to rest.'
  else if (window.length < 5 || durationMs < 80 || durationMs > 1500 || peak < SWING_LIMITS.minPeak) reason = 'Motion is too short, long, or weak for these rules.'
  else if (hand === 'Left') {
    const nearby = window.filter(sample => Math.abs(sample.timeMs - peakSample.timeMs) <= 60)
    const support = nearby.filter(sample => rates.alpha > 0
      ? sample.rotationAlpha > alphaFloor && sample.rotationBeta < -Math.min(120, peak * .2)
      : sample.rotationAlpha < -alphaFloor)
    const strongNegative = nearby.filter(sample => sample.rotationAlpha < -750)
    const sustainedStrongNegative = strongNegative.length >= 2 &&
      strongNegative.at(-1).timeMs - strongNegative[0].timeMs >= DIRECTION_SUPPORT_MS
    const sustained = support.length >= 2 && support.at(-1).timeMs - support[0].timeMs >= DIRECTION_SUPPORT_MS
    if (sustained && rates.alpha > alphaFloor && rates.beta < -Math.min(120, peak * .2) && rates.gamma < 100) {
      label = 'Forehand'
      reason = 'Left-hand positive alpha with sustained negative beta near peak.'
    } else if (sustained && rates.alpha < -alphaFloor && Math.abs(rates.alpha) / peak >= 0.75 &&
        (rates.beta <= Math.max(100, peak * .2) || rates.gamma >= 250 || sustainedStrongNegative ||
          rates.gamma < 0 && rates.beta / peak < .65)) {
      label = 'Backhand'
      reason = sustainedStrongNegative
        ? 'Left-hand dominant negative alpha with repeated rates below −750 °/s near peak.'
        : 'Left-hand dominant negative alpha with supporting beta/gamma directions.'
    } else {
      reason = 'Left-hand direction is ambiguous or resembles the observed return movement.'
    }
  }
  else if (hand !== 'Right') reason = 'Playing hand is unsupported.'
  else if (rates.alpha < -alphaFloor && (rates.beta < -backhandBetaFloor || sustainedBackhand)) {
    label = 'Backhand'
    reason = rates.beta < -backhandBetaFloor
      ? 'Alpha and beta are both strongly negative at peak rotation.'
      : 'Negative alpha at peak with repeated negative alpha/beta agreement within 60 ms.'
  } else if (rates.gamma < -Math.min(360, peak * .65) && Math.abs(rates.gamma) > 1.2 * Math.max(Math.abs(rates.alpha), Math.abs(rates.beta))) {
    label = 'Backhand'
    reason = 'Negative gamma dominates, resembling the alternate backhand example.'
  } else if (rates.beta > Math.min(200, peak * .4) && rates.alpha > Math.min(80, peak * .15) && rates.gamma > -450) {
    label = 'Forehand'
    reason = 'Positive beta and alpha coincide without dominant negative gamma.'
  }
  return { label, reason, startMs: window[0].timeMs, endMs: window.at(-1).timeMs,
    peakTimeMs: peakSample.timeMs, peakRotation: peak, peakRates: rates,
    backhandSupportSamples: backhandSupport.length,
    integratedDegrees: angles, complete }
}

// Keep the team's peak-direction rules, but confirm on a sustained drop from
// the peak instead of waiting for half-speed/rest. Minimum strength, duration,
// travel and a distinct approach still reject taps and small grip changes.
export function classifySwings(samples, { hand = 'Right', sport = 'Tennis', final = true, fast = false } = {}) {
  if (sport !== 'Tennis') return []
  const results = []
  let window = []
  let quietSince = null
  let previous = null
  let peak = 0
  let fastQuietSince = null
  let idleSince = null
  let rested = false
  let gentleStart = false
  let approachFrom = null
  function completeWindow(fastWindow = false) {
    const peakIndex = window.reduce((best, sample, i) => speed(sample) > speed(window[best]) ? i : best, 0)
    const peakSample = window[peakIndex]
    const approach = window.slice(0, peakIndex + 1).filter(sample => peakSample.timeMs - sample.timeMs <= 250)
    const active = window.filter(sample => speed(sample) >= Math.max(200, peak * 0.5))
    const sustained = active.length >= 3 && active.at(-1).timeMs - active[0].timeMs >= 40
    // Broad repositioning humps should not become extra swings. A peak at the
    // recording boundary is retained, since its approach was not captured.
    const distinctRise = peakIndex === 0 || Math.min(...approach.map(speed)) <= peak * 0.5 ||
      (gentleStart && approachFrom && peakSample.timeMs - approachFrom.timeMs <= 250 && speed(approachFrom) <= peak * 0.5)
    const prediction = peak >= SWING_LIMITS.minPeak && distinctRise && sustained ? describe(window, true, hand) : null
    // Total angular travel cannot cancel when a real stroke returns to rest.
    const travel = window.reduce((total, sample, index) => index === 0 ? 0 : total +
      (speed(window[index - 1]) + speed(sample)) * 0.5 * (sample.timeMs - window[index - 1].timeMs) / 1000, 0)
    // An ambiguous shorter window must retain its later evidence.
    if (fastWindow && (!prediction || prediction.label === 'Unknown' || travel < 24)) return false
    // In the recorded left-hand backhand preparation, alpha/beta initially
    // resemble a forehand but gamma stays near zero, then reverses. Keep that
    // ambiguous preparation open; don't commit a forehand and swallow the hit.
    // A completed forehand can still classify without this early-only evidence.
    if (fastWindow && hand === 'Left' && prediction.label === 'Forehand' &&
        prediction.peakRates.gamma > -peak * .1) return false
    // A slow left-hand wind-up can also resemble the positive-beta backhand
    // variant. Without a quiet start, retain that ambiguous window until the
    // real strike supplies stronger evidence; never turn it into an early hit.
    if (fastWindow && hand === 'Left' && prediction.label === 'Backhand' && !gentleStart &&
        peak < 800 && prediction.peakRates.beta > Math.max(100, peak * .2)) return false
    if (prediction && travel >= 24) results.push(fastWindow ? { ...prediction, complete: false, fast: true,
      detectedAtMs: window.at(-1).timeMs,
      detectionDelayMs: window.at(-1).timeMs - window[0].timeMs } : prediction)
    window = []
    quietSince = null
    peak = 0
    fastQuietSince = null
    return true
  }
  for (const sample of samples) {
    if (!valid(sample) || (previous && (sample.timeMs <= previous.timeMs || sample.timeMs - previous.timeMs > 100))) {
      if (window.length) results.push(describe(window, false, hand))
      window = []
      quietSince = null
      previous = null
      peak = 0
      fastQuietSince = null
      idleSince = null
      rested = false
      approachFrom = null
      if (!valid(sample)) continue
    }
    if (!window.length) {
      idleSince = speed(sample) < 120 ? idleSince ?? sample.timeMs : null
      if (idleSince !== null && sample.timeMs - idleSince >= 100) rested = true
    }
    if (!window.length && speed(sample) >= SWING_LIMITS.start) {
      window = [sample]
      // The threshold-crossing sample can already be above half of a compact
      // stroke's peak. Its preceding live reading is still approach evidence.
      // Dropping it rejected a real rise from rest as an ambiguous movement.
      approachFrom = previous
      gentleStart = rested
      rested = false
      idleSince = null
    }
    else if (window.length) window.push(sample)
    if (window.length) {
      peak = Math.max(peak, speed(sample))
      quietSince = speed(sample) < Math.max(120, peak * 0.35) ? quietSince ?? sample.timeMs : null
      fastQuietSince = speed(sample) < peak * FAST_DROP_RATIO ? fastQuietSince ?? sample.timeMs : null
      // Strength is already gated above; it must not add a wait-for-rest mode
      // to a valid compact stroke. Approach, direction, travel and the stream's
      // one-window latch continue to reject preparation and recovery motion.
      if (fast && peak >= SWING_LIMITS.minPeak &&
          fastQuietSince !== null && sample.timeMs - fastQuietSince >= FAST_DROP_HOLD_MS) {
        const peakSample = window.reduce((best, value) => speed(value) > speed(best) ? value : best)
        if (sample.timeMs - peakSample.timeMs >= FAST_POST_PEAK_MS && completeWindow(true)) return results
      }
      if (quietSince !== null && sample.timeMs - quietSince >= 100) {
        completeWindow()
      }
    }
    previous = sample
  }
  if (window.length && final) results.push(describe(window, false, hand))
  return results
}
