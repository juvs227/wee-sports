import { memo, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { loadRecording, saveRecording, maxSamples } from './recordingStorage'
import { classifySwings, classifierVersion } from './classifySwing'

const magnitude = value => value ? Math.hypot(...Object.values(value)) : null
const vector = (value, keys) => value && keys.every(key => Number.isFinite(value[key]))
  ? Object.fromEntries(keys.map(key => [key, value[key]])) : null
const display = value => value == null ? '—' : value.toFixed(2)

const Graph = memo(function Graph({ samples, field, label, unit, color, signed = false }) {
  const values = samples.map(sample => sample[field]).filter(Number.isFinite)
  const max = Math.max(1, ...values.map(Math.abs))
  const y = value => signed ? 78 - value / max * 60 : 140 - value / max * 120
  const duration = samples.at(-1)?.timeMs || 1
  const points = samples.filter(sample => Number.isFinite(sample[field])).map(sample =>
    `${10 + sample.timeMs / duration * 580},${y(sample[field])}`).join(' ')
  return <section className="graph"><h3>{label} <small>{signed ? 'range' : 'peak'} {signed && values.length ? `${display(Math.min(...values))} to ` : ''}{display(values.length ? Math.max(...values) : null)} {unit}</small></h3>
    <svg viewBox="0 0 600 165" role="img" aria-label={`${label} over time in ${unit}`}>
      <path d="M10 15V140H590" fill="none" stroke="#cbd5e1" />
      <path d={`M10 ${y(0)}H590`} stroke="#94a3b8" strokeDasharray="4 4" /><text x="12" y={y(0) - 4}>0</text>
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" />
      <text x="10" y="160">0 s</text><text x="530" y="160">{(duration / 1000).toFixed(1)} s</text>
    </svg>{!values.length && <p>No {label.toLowerCase()} samples yet.</p>}</section>
})

export default function App() {
  const [recovered] = useState(() => {
    try { return loadRecording(window.localStorage) } catch { return null }
  })
  const [storageWarning, setStorageWarning] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState(recovered?.samples.length ? 'Recovered your last recording. Download it below. Enable motion and recalibrate before recording again.' : 'Enable motion on your phone to begin.')
  const [phase, setPhase] = useState('idle')
  const [sport, setSport] = useState(recovered?.sport ?? 'Tennis')
  const [stroke, setStroke] = useState(recovered?.stroke ?? 'Forehand')
  const [hand, setHand] = useState(recovered?.hand ?? 'Right')
  const [orientationStatus, setOrientationStatus] = useState('Not enabled')
  const [live, setLive] = useState(null)
  const [samples, setSamples] = useState(recovered?.samples ?? [])
  const [calibration, setCalibration] = useState(null)
  const [age, setAge] = useState(null)
  const session = useRef({ ...recovered, phase: 'idle', samples: recovered?.samples ?? [], calibrationSamples: [], lastEvent: 0 })
  const supported = typeof window.DeviceMotionEvent !== 'undefined'

  function checkpoint() {
    try {
      if (saveRecording(window.localStorage, session.current)) {
        setStorageWarning('')
      } else {
        setStorageWarning('Local backup failed. Download JSON before leaving this page.')
      }
    } catch {
      setStorageWarning('Local storage is unavailable. Download JSON before leaving this page.')
    }
  }

  useEffect(() => {
    const save = () => { if (session.current.samples.length) checkpoint() }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])

  function finish(message = 'Recording complete. Review the graphs or download your samples.') {
    const current = session.current
    current.phase = 'idle'
    setPhase('idle')
    setSamples([...current.samples])
    setStatus(message)
    checkpoint()
  }

  useEffect(() => {
    if (!enabled) return
    function handleOrientation(event) {
      const orientation = vector(event, ['alpha', 'beta', 'gamma'])
      session.current.orientation = orientation ? { ...orientation, absolute: event.absolute, receivedAt: performance.now() } : null
    }
    window.addEventListener('deviceorientation', handleOrientation)
    function handleMotion(event) {
      const current = session.current
      const now = performance.now()
      const acceleration = vector(event.acceleration, ['x', 'y', 'z'])
      const accelerationIncludingGravity = vector(event.accelerationIncludingGravity, ['x', 'y', 'z'])
      const rotationRate = vector(event.rotationRate, ['alpha', 'beta', 'gamma'])
      current.lastEvent = now
      const orientation = current.orientation && now - current.orientation.receivedAt < 500 ? current.orientation : null
      const reading = { acceleration, accelerationIncludingGravity, rotationRate, orientation: orientation ? { alpha: orientation.alpha, beta: orientation.beta, gamma: orientation.gamma, absolute: orientation.absolute } : null }
      if (current.phase === 'recording' && !current.startOrientation && orientation) current.startOrientation = reading.orientation
      // Wrapped Euler differences describe each axis, not a full 3D relative rotation.
      const relativeOrientation = reading.orientation && current.startOrientation ? Object.fromEntries(['alpha', 'beta', 'gamma'].map(key => [key, ((reading.orientation[key] - current.startOrientation[key] + 540) % 360) - 180])) : null
      if (current.phase === 'calibrating' && rotationRate) current.calibrationSamples.push(rotationRate)
      const correctedRotation = rotationRate && current.bias ? Object.fromEntries(
        Object.keys(rotationRate).map(key => [key, rotationRate[key] - current.bias[key]])) : rotationRate
      const sample = { ...reading, relativeOrientation, correctedRotationRate: correctedRotation, rotationAlpha: correctedRotation?.alpha ?? null, rotationBeta: correctedRotation?.beta ?? null, rotationGamma: correctedRotation?.gamma ?? null, timeMs: now - (current.started || now), accelerationMagnitude: magnitude(acceleration), rotationMagnitude: magnitude(correctedRotation), intervalMs: event.interval }
      if (current.phase === 'recording') {
        current.samples.push(sample)
        if (!current.lastSaved || now - current.lastSaved >= 500) {
          current.lastSaved = now
          checkpoint()
        }
        if (current.samples.length >= maxSamples) finish('Stopped at the sample limit. Recording saved.')
      }
      if (!current.lastPaint || now - current.lastPaint > 100) {
        current.lastPaint = now
        setLive(sample)
        if (current.phase === 'recording') setSamples([...current.samples])
      }
    }
    window.addEventListener('devicemotion', handleMotion)
    const timer = setInterval(() => {
      const current = session.current
      const now = performance.now()
      setAge(current.lastEvent ? (now - current.lastEvent) / 1000 : Infinity)
      if (current.phase === 'calibrating' && now - current.calibrationStarted >= 2000) {
        const readings = current.calibrationSamples
        current.phase = 'idle'
        setPhase('idle')
        if (readings.length < 10) { setStatus('Calibration needs more gyroscope readings. Keep this page visible and try again.'); return }
        const means = Object.fromEntries(['alpha', 'beta', 'gamma'].map(key => [key, readings.reduce((sum, value) => sum + value[key], 0) / readings.length]))
        const variation = Math.sqrt(readings.reduce((sum, value) => sum + ['alpha', 'beta', 'gamma'].reduce((total, key) => total + (value[key] - means[key]) ** 2, 0), 0) / readings.length)
        if (magnitude(means) > 5 || variation > 3) { setStatus('Phone moved during calibration. Set it down and try again.'); return }
        current.bias = means
        const result = { rotationBiasDegreesPerSecond: means, sampleCount: readings.length, calibratedAt: new Date().toISOString() }
        setCalibration(result)
        setStatus('Calibrated. Pick up your phone and record a swing.')
      }
      if (current.phase === 'recording' && now - current.started >= 10000) finish('Stopped at the 10-second limit. Your samples are ready.')
      else if (current.phase === 'recording' && now - current.lastEvent > 1500) finish('Sensor stream stopped. Saved the samples received so far; keep the page visible and retry.')
    }, 250)
    const visibility = () => { if (document.hidden && session.current.phase === 'recording') finish('Recording stopped because the page became hidden.') }
    document.addEventListener('visibilitychange', visibility)
    return () => { clearInterval(timer); window.removeEventListener('deviceorientation', handleOrientation); window.removeEventListener('devicemotion', handleMotion); document.removeEventListener('visibilitychange', visibility) }
  }, [enabled])

  async function enable() {
    try {
      // Request both during the same user gesture (required by iOS).
      const motionRequest = typeof window.DeviceMotionEvent.requestPermission === 'function'
        ? window.DeviceMotionEvent.requestPermission() : Promise.resolve('granted')
      const orientationRequest = typeof window.DeviceOrientationEvent?.requestPermission === 'function'
        ? window.DeviceOrientationEvent.requestPermission() : Promise.resolve('granted')
      const [motion, orientation] = await Promise.allSettled([motionRequest, orientationRequest])
      setOrientationStatus(orientation.status === 'fulfilled' && orientation.value === 'granted'
        ? 'Enabled; waiting for angles' : 'Access denied or unavailable; motion recording still works')
      if (motion.status !== 'fulfilled' || motion.value !== 'granted') {
        setStatus('Motion access was denied. Allow motion access in your browser settings and try again.')
        return
      }
      setEnabled(true)
      setStatus('Waiting for sensor readings. Keep this page open on your phone.')
    } catch (error) { setStatus(`Could not enable motion: ${error.message}`) }
  }

  function calibrate() {
    session.current.phase = 'calibrating'
    session.current.calibrationStarted = performance.now()
    session.current.calibrationSamples = []
    session.current.bias = null
    setCalibration(null)
    setPhase('calibrating')
    setStatus('Keep your phone completely still for two seconds…')
  }

  function record() {
    session.current.samples = []
    session.current.started = performance.now()
    session.current.recordedAt = new Date().toISOString()
    session.current.sport = sport
    session.current.stroke = sport === 'Tennis' ? stroke : null
    session.current.hand = hand
    session.current.startOrientation = null
    session.current.recordingCalibration = calibration
    session.current.lastSaved = 0
    session.current.phase = 'recording'
    checkpoint()
    setSamples([])
    setPhase('recording')
    setStatus('Recording. Make one controlled swing, then tap Stop. Maximum 10 seconds.')
  }

  function download() {
    const predictions = classifySwings(samples, { hand: session.current.hand, sport: session.current.sport })
    const data = { version: 3, classifier: { version: classifierVersion, source: 'Provisional gyro rules tuned on example recordings; accuracy unvalidated', predictions }, sport: session.current.sport, strokeLabel: session.current.stroke, playingHand: session.current.hand, startOrientation: session.current.startOrientation, recordedAt: session.current.recordedAt, calibration: session.current.recordingCalibration, units: { orientation: 'degrees, browser Euler angles', relativeOrientation: 'degrees, wrapped per-axis change from first available recording orientation; not a full 3D rotation', correctedRotationRate: 'degrees/second, bias corrected', timeMs: 'milliseconds', acceleration: 'm/s²', accelerationIncludingGravity: 'm/s²', rotationRate: 'degrees/second', rotationMagnitude: 'degrees/second, bias corrected' }, samples }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `swing-${data.sport.toLowerCase()}-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const ready = enabled && live && age < 1.5
  const duration = samples.length > 1 ? (samples.at(-1).timeMs - samples[0].timeMs) / 1000 : 0
  const rate = duration ? (samples.length - 1) / duration : null
  const recordedHand = session.current.hand
  const recordedSport = session.current.sport
  const predictions = useMemo(() => classifySwings(samples, { hand: recordedHand, sport: recordedSport, final: phase !== 'recording' }), [samples, recordedHand, recordedSport, phase])
  const latest = predictions.at(-1)
  return <main>
    <header className="app-header"><div><span className="eyebrow">WEE SPORTS</span><h1>Swing studio<span>.</span></h1></div><span className={ready ? 'badge ready' : 'badge'}>{ready ? '● Sensors live' : '○ Sensors offline'}</span></header>
    <section className="hero panel" aria-label="Latest swing">
      <div className="heading"><span className="eyebrow">{phase === 'recording' ? 'RECORDING LIVE' : 'LATEST SWING'}</span><span className="badge">{predictions.length} detected</span></div>
      <div className="swing-result" data-type={latest?.label ?? 'Waiting'} role="status">
        <span className="swing-number">{latest ? `SWING ${predictions.length}` : 'READY WHEN YOU ARE'}</span>
        <h2>{latest?.label ?? (phase === 'recording' ? 'Listening…' : 'Let’s swing.')}</h2>
        <p>{latest ? `${(latest.peakTimeMs / 1000).toFixed(2)} s into your recording` : 'Enable motion, calibrate, then record.'}</p>
      </div>
      <div className="action-bar">
        <button onClick={enable} disabled={enabled || !supported || !window.isSecureContext}>{enabled ? '✓ Motion on' : '1. Enable motion'}</button>
        <button onClick={calibrate} disabled={!ready || phase !== 'idle'}>{phase === 'calibrating' ? 'Hold still…' : calibration ? '✓ Recalibrate' : '2. Calibrate'}</button>
        {phase === 'recording' ? <button className="stop" onClick={() => finish()}>■ Stop recording</button> : <button className="primary" onClick={record} disabled={!ready || !calibration || phase !== 'idle'}>● Record swings</button>}
      </div>
      <p role="status" className="status">{status}</p>
      {storageWarning && <p role="alert" className="warning">{storageWarning}</p>}
      {!window.isSecureContext && <p className="warning">Open your HTTPS link to access phone sensors.</p>}
      {!supported && <p className="warning">Motion sensors are unavailable in this browser.</p>}
      {enabled && age > 1.5 && <p className="warning">No recent readings. Keep the phone unlocked and this page visible.</p>}
      <p className="safety">Hold your phone securely, use a wrist strap, and keep your swing area clear.</p>
    </section>

    <details className="panel disclosure settings"><summary><span>Session setup</span><span className="summary-meta">{sport} · {hand} hand</span></summary>
      <div className="controls">
        <label>Sport<select value={sport} onChange={event => setSport(event.target.value)} disabled={phase !== 'idle'}><option>Tennis</option><option>Bowling</option></select></label>
        <label>Playing hand<select value={hand} onChange={event => setHand(event.target.value)} disabled={phase !== 'idle'}><option>Right</option><option>Left</option></select></label>
        {sport === 'Tennis' && <label>Actual stroke · optional<select value={stroke} onChange={event => setStroke(event.target.value)} disabled={phase !== 'idle'}><option>Forehand</option><option>Backhand</option><option>Unknown</option></select></label>}
      </div><p className="note">Setup applies to your next recording. Actual stroke is your reference label and does not affect predictions. Set the phone down for two seconds to calibrate. Bowling classification is not available.</p>
    </details>

    <section className="panel history"><div className="heading"><h2>Your swings</h2><span className="summary-meta">{duration.toFixed(1)} s recorded</span></div>
      {!predictions.length && <p className="empty">{recordedSport === 'Bowling' ? 'Bowling samples are saved, but stroke classification is available for Tennis only.' : 'Your detected swings will appear here. Return toward rest between swings.'}</p>}
      <div className="swing-list">{predictions.map((prediction, index) => <details className="swing-card" data-type={prediction.label} key={`${prediction.startMs}-${index}`}>
        <summary><span className="index">{String(index + 1).padStart(2, '0')}</span><span className="stroke-name">{prediction.label}</span><span className="swing-time">{(prediction.peakTimeMs / 1000).toFixed(2)} s</span></summary>
        <div className="swing-context"><p>{prediction.reason}</p>
          <dl><div><dt>Recorded context</dt><dd>{recordedSport} · {recordedHand} hand · reference {session.current.stroke ?? 'None'}</dd></div>
            <div><dt>Window</dt><dd>{(prediction.startMs / 1000).toFixed(2)}–{(prediction.endMs / 1000).toFixed(2)} s</dd></div>
            <div><dt>Peak rotation</dt><dd>{display(prediction.peakRotation)} °/s</dd></div>
            <div><dt>Rates at peak · °/s</dt><dd>α {display(prediction.peakRates.alpha)} · β {display(prediction.peakRates.beta)} · γ {display(prediction.peakRates.gamma)}</dd></div>
            <div><dt>Approximate integrated rotation · °</dt><dd>α {display(prediction.integratedDegrees.alpha)} · β {display(prediction.integratedDegrees.beta)} · γ {display(prediction.integratedDegrees.gamma)}</dd></div>
          </dl>
        </div>
      </details>)}</div>
      <div className="export-row"><span className="note">{samples.length} samples · {display(rate)} Hz</span><button onClick={download} disabled={!samples.length || phase !== 'idle'}>Download JSON ↓</button></div>
    </section>

    <details className="panel disclosure"><summary>Live sensors & graphs</summary>
      <div className="metrics"><div><small>Live acceleration</small><strong>{display(live?.accelerationMagnitude)} <em>m/s²</em></strong></div><div><small>Live rotation</small><strong>{display(live?.rotationMagnitude)} <em>°/s</em></strong></div><div><small>Calibration</small><strong>{calibration ? 'Ready' : 'Needed'}</strong></div></div>
      <p>Phone angles: α {display(live?.orientation?.alpha)}° · β {display(live?.orientation?.beta)}° · γ {display(live?.orientation?.gamma)}°</p>
      <p className="note">{live?.orientation ? 'Orientation readings live.' : orientationStatus}</p>
      {live && !live.acceleration && <p className="note">Gravity-free acceleration is unavailable. Gravity-inclusive samples are saved when provided.</p>}
      <Graph samples={samples} field="accelerationMagnitude" label="Acceleration" unit="m/s²" color="#087e8b" />
      <Graph samples={samples} field="rotationMagnitude" label="Rotation rate" unit="°/s" color="#7c3aed" />
      {['Alpha', 'Beta', 'Gamma'].map((axis, index) => <Graph key={axis} samples={samples} field={`rotation${axis}`} label={`${axis} signed rotation rate`} unit="°/s" color={['#087e8b', '#7c3aed', '#c2410c'][index]} signed />)}
    </details>
    <details className="panel disclosure"><summary>About predictions & saved recordings</summary>
      <p className="note">Experimental rules use your example recordings. Keep the same grip and starting pose. Unknown means the motion is ambiguous or incomplete. Rotation degrees are approximate per-axis gyro integrals, not a 3D trajectory.</p>
      <p className="note">The latest recording is backed up locally every half-second and when stopped. Reloading restores it at the same site address. Starting a new recording replaces it; download JSON for a permanent copy.</p>
    </details>
  </main>
}
