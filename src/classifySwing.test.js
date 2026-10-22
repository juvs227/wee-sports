import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifySwings } from './classifySwing.js'

function burst(alpha, beta, gamma, offset = 0) {
  return Array.from({ length: 20 }, (_, i) => ({ timeMs: offset + i * 20,
    rotationAlpha: i < 10 ? alpha : 0,
    rotationBeta: i < 10 ? beta : 0,
    rotationGamma: i < 10 ? gamma : 0 }))
}
test('positive alpha and beta pattern and integrated degrees', () => {
  const [result] = classifySwings(burst(300, 600, -100))
  assert.equal(result.label, 'Forehand')
  assert.ok(Math.abs(result.integratedDegrees.beta - 114) < 0.001)
})
test('both screenshot-inspired backhand patterns', () => {
  assert.equal(classifySwings(burst(-900, -500, 200))[0].label, 'Backhand')
  assert.equal(classifySwings(burst(200, 400, -900))[0].label, 'Backhand')
})
test('overlap, weak, and unsupported hand stay unknown', () => {
  assert.equal(classifySwings(burst(10, 600, -100))[0].label, 'Unknown')
  assert.deepEqual(classifySwings(burst(80, 260, 0)), [])
  assert.equal(classifySwings(burst(300, 600, 0), { hand: 'Left' })[0].label, 'Unknown')
  assert.deepEqual(classifySwings(burst(300, 600, 0), { sport: 'Bowling' }), [])
})
test('separates multiple bursts and does not predict an unfinished live burst', () => {
  assert.equal(classifySwings([...burst(300, 600, 0), ...burst(-900, -500, 200, 500)]).length, 2)
  const unfinished = burst(300, 600, 0).slice(0, 8)
  assert.deepEqual(classifySwings(unfinished, { final: false }), [])
  assert.equal(classifySwings(unfinished)[0].label, 'Unknown')
})
test('sensor gaps and missing axes cannot produce a confident result', () => {
  const samples = burst(300, 600, 0)
  samples[5].rotationBeta = null
  assert.equal(classifySwings(samples)[0].label, 'Unknown')
  const gap = burst(300, 600, 0).map((s, i) => ({ ...s, timeMs: s.timeMs + (i >= 5 ? 300 : 0) }))
  assert.equal(classifySwings(gap)[0].label, 'Unknown')
})

test('gentler forehand clears lower detection and direction thresholds', () => {
  const [result] = classifySwings(burst(140, 330, -40))
  assert.equal(result.label, 'Forehand')
  assert.ok(result.peakRotation < 500)
})
test('small motion below the new start threshold is ignored', () => {
  assert.deepEqual(classifySwings(burst(40, 150, 20)), [])
})

test('recorded two forehands then a backhand remain three separate swings', () => {
  const samples = JSON.parse(readFileSync(new URL('./fixtures/two-forehands-one-backhand.json', import.meta.url)))
  const results = classifySwings(samples)
  assert.deepEqual(results.map(result => result.label), ['Forehand', 'Forehand', 'Backhand'])
  assert.deepEqual(results.map(result => result.peakTimeMs), [1142, 2575, 4142])
  assert.ok(results.every(result => result.complete && result.endMs - result.startMs <= 1500))
  // Completed live results must match the final analysis.
  assert.deepEqual(classifySwings(samples, { final: false }), results)
})

test('four recorded backhands tolerate beta peaking before total rotation', () => {
  const samples = JSON.parse(readFileSync(new URL('./fixtures/four-backhands.json', import.meta.url)))
  const results = classifySwings(samples)
  assert.deepEqual(results.map(result => result.label), Array(4).fill('Backhand'))
  assert.deepEqual(results.map(result => result.peakTimeMs), [1360, 2443, 3510, 4527])
})
test('negative alpha alone and isolated beta spikes remain unknown', () => {
  assert.equal(classifySwings(burst(-900, 50, 20))[0].label, 'Unknown')
  const samples = burst(-900, 50, 20)
  // Preserve the total rotation peak at time zero, with just one negative-beta
  // sample nearby: insufficient temporal support for the relaxed rule.
  samples[0].rotationAlpha = -1200
  samples[1].rotationBeta = -250
  assert.equal(classifySwings(samples)[0].label, 'Unknown')
})

test('left mixed recording predicts forehand/backhand/forehand/backhand', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/left-mixed.json', import.meta.url)))
  assert.deepEqual(classifySwings(fixture.samples, { hand: 'Left' }).map(result => result.label), fixture.expectedStrokeSequence)
})
test('left forehand recording keeps reversed return movement unknown', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/left-four-forehands.json', import.meta.url)))
  assert.deepEqual(classifySwings(fixture.samples, { hand: 'Left' }).map(result => result.label),
    ['Forehand', 'Forehand', 'Forehand', 'Unknown', 'Forehand'])
})
test('representative peak rates from four reported left backhands', () => {
  // Synthetic constant-rate bursts using the previously inspected peak rates;
  // these check rule coverage, not the original recording's segmentation.
  for (const rates of [[-986, -117, 375], [-1215, -297, 110], [-1042, -19, -115], [-1509, -605, 499]]) {
    assert.equal(classifySwings(burst(...rates), { hand: 'Left' })[0].label, 'Backhand')
  }
})

test('new left-backhand recording permits variable beta and gamma signs', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/left-four-backhands-new.json', import.meta.url)))
  const results = classifySwings(fixture.samples, { hand: 'Left' })
  assert.deepEqual(results.map(result => result.label), fixture.expectedStrokeSequence)
  assert.deepEqual(results.map(result => result.peakTimeMs), [999, 1916, 2998, 3883])
})
test('one strong negative-alpha spike does not bypass return-motion guard', () => {
  const samples = burst(-400, 200, -100)
  samples[4].rotationAlpha = -1200
  assert.equal(classifySwings(samples, { hand: 'Left' })[0].label, 'Unknown')
})
