import test from 'node:test'
import assert from 'node:assert/strict'
import { saveRecording, loadRecording, recordingKey } from './recordingStorage.js'

const recording = () => ({ sport: 'Tennis', hand: 'Right', stroke: 'Backhand',
  recordedAt: '2026-10-22T12:00:00Z', startOrientation: { alpha: 10, beta: 20, gamma: 30 },
  recordingCalibration: { rotationBiasDegreesPerSecond: { alpha: 1, beta: 0, gamma: 0 } },
  samples: [0, 20, 40].map(timeMs => ({ timeMs, rotationAlpha: -900,
    rotationBeta: -500, rotationGamma: 200, accelerationMagnitude: 10, rotationMagnitude: 1048 })) })
function memoryStorage() {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
}
test('reload recovers samples with the original labels and export metadata', () => {
  const storage = memoryStorage()
  const original = recording()
  assert.equal(saveRecording(storage, original), true)
  assert.deepEqual(loadRecording(storage), original)
})
test('checkpoint recovers partial progress and final save includes later samples', () => {
  const storage = memoryStorage()
  const current = recording()
  saveRecording(storage, current)
  current.samples.push({ ...current.samples[0], timeMs: 60 })
  assert.equal(loadRecording(storage).samples.length, 3)
  saveRecording(storage, current)
  assert.equal(loadRecording(storage).samples.length, 4)
})
test('corrupt and incompatible data safely falls back to no recording', () => {
  const storage = memoryStorage()
  assert.equal(loadRecording(storage), null)
  for (const value of ['{broken', 'null', JSON.stringify({ version: 99 }),
    JSON.stringify({ version: 1, ...recording(), samples: [null] })]) {
    storage.setItem(recordingKey, value)
    assert.equal(loadRecording(storage), null)
  }
})
test('storage restrictions and quota errors do not crash capture', () => {
  const storage = { getItem() { throw Error('denied') }, setItem() { throw Error('quota') } }
  assert.equal(saveRecording(storage, recording()), false)
  assert.equal(loadRecording(storage), null)
})
