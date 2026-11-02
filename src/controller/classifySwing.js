// Provisional rules inferred from screenshots, not fitted to raw recordings.
export const classifierVersion = 'gyro-handed-responsive-v8'
export const SWING_LIMITS = Object.freeze({ start: 200, minPeak: 280 })
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
  // Axis peaks can be offset in time. Require repeated agreement near the
  // rotation peak rather than loosening the beta threshold for every motion.
  const backhandSupport = window.filter(sample =>
    Math.abs(sample.timeMs - peakSample.timeMs) <= 60 &&
    sample.rotationAlpha < -200 && sample.rotationBeta < -160)
  const sustainedBackhand = backhandSupport.length >= 2 &&
    backhandSupport.at(-1).timeMs - backhandSupport[0].timeMs >= 16
  const angles = { alpha: 0, beta: 0, gamma: 0 }
  for (let i = 1; i < window.length; i++) {
    const dt = (window[i].timeMs - window[i - 1].timeMs) / 1000
    for (const axis of axes) angles[axis.toLowerCase()] += (window[i - 1][`rotation${axis}`] + window[i][`rotation${axis}`]) / 2 * dt
  }
  const peak = speed(peakSample)
  const durationMs = window.at(-1).timeMs - window[0].timeMs
  let label = 'Unknown'
  let reason = 'Rotation directions overlap the screenshot examples.'
  if (!complete) reason = 'Motion window ended before a clear return to rest.'
  else if (window.length < 5 || durationMs < 80 || durationMs > 1500 || peak < SWING_LIMITS.minPeak) reason = 'Motion is too short, long, or weak for these rules.'
  else if (hand === 'Left') {
    const nearby = window.filter(sample => Math.abs(sample.timeMs - peakSample.timeMs) <= 60)
    const support = nearby.filter(sample => rates.alpha > 0
      ? sample.rotationAlpha > 200 && sample.rotationBeta < -120
      : sample.rotationAlpha < -200)
    const strongNegative = nearby.filter(sample => sample.rotationAlpha < -750)
    const sustainedStrongNegative = strongNegative.length >= 2 &&
      strongNegative.at(-1).timeMs - strongNegative[0].timeMs >= 16
    const sustained = support.length >= 2 && support.at(-1).timeMs - support[0].timeMs >= 16
    if (sustained && rates.alpha > 200 && rates.beta < -120 && rates.gamma < 100) {
      label = 'Forehand'
      reason = 'Left-hand positive alpha with sustained negative beta near peak.'
    } else if (sustained && rates.alpha < -200 && Math.abs(rates.alpha) / peak >= 0.75 &&
        (rates.beta <= 100 || rates.gamma >= 250 || sustainedStrongNegative)) {
      label = 'Backhand'
      reason = sustainedStrongNegative
        ? 'Left-hand dominant negative alpha with repeated rates below −750 °/s near peak.'
        : 'Left-hand dominant negative alpha with supporting beta/gamma directions.'
    } else {
      reason = 'Left-hand direction is ambiguous or resembles the observed return movement.'
    }
  }
  else if (hand !== 'Right') reason = 'Playing hand is unsupported.' 
  else if (rates.alpha < -200 && (rates.beta < -160 || sustainedBackhand)) {
    label = 'Backhand'
    reason = rates.beta < -160
      ? 'Alpha and beta are both strongly negative at peak rotation.'
      : 'Negative alpha at peak with repeated negative alpha/beta agreement within 60 ms.'
  } else if (rates.gamma < -360 && Math.abs(rates.gamma) > 1.2 * Math.max(Math.abs(rates.alpha), Math.abs(rates.beta))) {
    label = 'Backhand'
    reason = 'Negative gamma dominates, resembling the alternate backhand example.'
  } else if (rates.beta > 200 && rates.alpha > 80 && rates.gamma > -450) {
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
  function completeWindow(fastWindow = false) {
    const peakIndex = window.reduce((best, sample, i) => speed(sample) > speed(window[best]) ? i : best, 0)
    const peakSample = window[peakIndex]
    const approach = window.slice(0, peakIndex + 1).filter(sample => peakSample.timeMs - sample.timeMs <= 250)
    const active = window.filter(sample => speed(sample) >= Math.max(200, peak * 0.5))
    const sustained = active.length >= 3 && active.at(-1).timeMs - active[0].timeMs >= 40
    // Broad repositioning humps should not become extra swings. A peak at the
    // recording boundary is retained, since its approach was not captured.
    const distinctRise = peakIndex === 0 || Math.min(...approach.map(speed)) <= peak * 0.5
    const prediction = peak >= SWING_LIMITS.minPeak && distinctRise && sustained ? describe(window, true, hand) : null
    // Total angular travel cannot cancel when a real stroke returns to rest.
    const travel = window.reduce((total, sample, index) => index === 0 ? 0 : total +
      (speed(window[index - 1]) + speed(sample)) * 0.5 * (sample.timeMs - window[index - 1].timeMs) / 1000, 0)
    // An ambiguous shorter window must retain its later evidence.
    if (fastWindow && (!prediction || prediction.label === 'Unknown' || travel < 24)) return false
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
      if (!valid(sample)) continue
    }
    if (!window.length) {
      idleSince = speed(sample) < 120 ? idleSince ?? sample.timeMs : null
      if (idleSince !== null && sample.timeMs - idleSince >= 100) rested = true
    }
    if (!window.length && speed(sample) >= SWING_LIMITS.start) {
      window = [sample]
      gentleStart = rested
      rested = false
      idleSince = null
    }
    else if (window.length) window.push(sample)
    if (window.length) {
      peak = Math.max(peak, speed(sample))
      quietSince = speed(sample) < Math.max(120, peak * 0.35) ? quietSince ?? sample.timeMs : null
      fastQuietSince = speed(sample) < peak * 0.72 ? fastQuietSince ?? sample.timeMs : null
      // A weaker return to the starting grip can resemble the opposite shot.
      // Accelerate a gentle stroke only after observed stillness, not a gap.
      if (fast && peak >= (gentleStart ? SWING_LIMITS.minPeak : 800) &&
          fastQuietSince !== null && sample.timeMs - fastQuietSince >= 24) {
        const peakSample = window.reduce((best, value) => speed(value) > speed(best) ? value : best)
        if (sample.timeMs - peakSample.timeMs >= 40 && completeWindow(true)) return results
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
