export const recordingKey = 'wee-sports:last-recording:v1'
export const maxSamples = 3000

export function saveRecording(storage, session) {
  try {
    storage.setItem(recordingKey, JSON.stringify({
      version: 1, samples: session.samples.slice(-maxSamples),
      sport: session.sport, stroke: session.stroke, hand: session.hand,
      recordedAt: session.recordedAt, startOrientation: session.startOrientation,
      recordingCalibration: session.recordingCalibration,
    }))
    return true
  } catch {
    return false
  }
}

export function loadRecording(storage) {
  try {
    const data = JSON.parse(storage.getItem(recordingKey))
    const fields = ['accelerationMagnitude', 'rotationMagnitude', 'rotationAlpha', 'rotationBeta', 'rotationGamma']
    if (data?.version !== 1 || !Array.isArray(data.samples) || data.samples.length > maxSamples ||
        !['Tennis', 'Bowling'].includes(data.sport) || !['Right', 'Left'].includes(data.hand) ||
        !data.samples.every((sample, i) => sample && Number.isFinite(sample.timeMs) && sample.timeMs >= 0 &&
          (!i || sample.timeMs > data.samples[i - 1].timeMs) &&
          fields.every(field => sample[field] === null || Number.isFinite(sample[field])))) return null
    return { samples: data.samples, sport: data.sport, hand: data.hand,
      stroke: ['Forehand', 'Backhand', 'Unknown'].includes(data.stroke) ? data.stroke : 'Unknown',
      recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : null,
      startOrientation: data.startOrientation ?? null,
      recordingCalibration: data.recordingCalibration ?? null }
  } catch {
    return null
  }
}
