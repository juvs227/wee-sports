const STROKES = ['Forehand', 'Backhand'];
const PER_STROKE = 3;
const MAX_DURATION_MS = 60_000;

/** Power adaptation only: it never changes the team's recognition thresholds. */
export function fitStrengthProfile(hand, samples) {
  if (!['Right', 'Left'].includes(hand) || samples.length !== PER_STROKE * 2) return null;
  const profile = { hand };
  for (const label of STROKES) {
    const peaks = samples.filter(sample => sample.label === label).map(sample => sample.peakRotation).sort((a, b) => a - b);
    if (peaks.length !== PER_STROKE || peaks.some(peak => !Number.isFinite(peak) || peak < 280 || peak > 1600) ||
        peaks.at(-1) / peaks[0] > 1.8) return null;
    // The median resists one unusual stroke. Bounds keep a short rehearsal
    // from turning very small motions into maximum-power shots.
    profile[label] = Math.max(0.75, Math.min(1.75, 740 / peaks[1]));
  }
  return profile;
}

/** A separate, completed-stroke rehearsal. No result is sent to the game. */
export function createStrengthRehearsal(hand, startedAt) {
  const samples = [];
  const seen = new Set();
  let state = 'collecting';
  let message = 'Make three relaxed forehands. Pause at rest between swings.';
  let profile = null;
  function snapshot(now) {
    if (state === 'collecting' && now - startedAt >= MAX_DURATION_MS) {
      state = 'failed'; message = 'Rehearsal timed out. Try again when ready, or keep the default strength.';
    }
    return { state, message, profile, count: samples.length,
      next: samples.length < PER_STROKE ? 'Forehand' : 'Backhand' };
  }
  return {
    read: snapshot,
    accept(swing, now) {
      if (snapshot(now).state !== 'collecting') return snapshot(now);
      const next = samples.length < PER_STROKE ? 'Forehand' : 'Backhand';
      if (!swing?.complete || swing.early || swing.fast || swing.simple || !STROKES.includes(swing.label) ||
          !Number.isFinite(swing.startMs) || !Number.isFinite(swing.endMs) ||
          swing.endMs - swing.startMs < 80 || swing.endMs - swing.startMs > 1500 ||
          !Number.isFinite(swing.peakRotation) || swing.peakRotation < 280 || swing.peakRotation > 1600) {
        message = `That motion was not a clear relaxed stroke. Try another ${next.toLowerCase()}, then rest.`;
        return snapshot(now);
      }
      if (seen.has(swing.startMs)) return snapshot(now);
      seen.add(swing.startMs);
      if (swing.label !== next) {
        message = `Recognized ${swing.label.toLowerCase()}. Try a ${next.toLowerCase()} for this step.`;
        return snapshot(now);
      }
      samples.push({ label: swing.label, peakRotation: swing.peakRotation });
      if (samples.length === PER_STROKE * 2) {
        profile = fitStrengthProfile(hand, samples);
        state = profile ? 'complete' : 'failed';
        message = profile ? 'Comfortable strength saved for this controller session. Your stroke detection stays the same.'
          : 'Those swings varied too much to tune safely. Repeat at a comfortable pace, or keep the default strength.';
      } else {
        const label = samples.length < PER_STROKE ? 'forehand' : 'backhand';
        const remaining = samples.length < PER_STROKE ? PER_STROKE - samples.length : PER_STROKE * 2 - samples.length;
        message = samples.length === PER_STROKE ? 'Forehands done. Now make three relaxed backhands, resting between swings.'
          : `${remaining} ${label}${remaining === 1 ? '' : 's'} left. Use a relaxed swing, then pause at rest.`;
      }
      return snapshot(now);
    },
  };
}
