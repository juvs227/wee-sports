import { useEffect, useRef, useState } from 'react'
import './App.css'

const magnitude = value => value ? Math.hypot(...Object.values(value)) : null
const vector = (value, keys) => value && keys.every(key => Number.isFinite(value[key]))
  ? Object.fromEntries(keys.map(key => [key, value[key]])) : null
const display = value => value == null ? '—' : value.toFixed(2)

function Graph({ samples, field, label, unit, color, signed = false }) {
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
}

export default function App() {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState('Enable motion on your phone to begin.')
  const [phase, setPhase] = useState('idle')
  const [sport, setSport] = useState('Tennis')
  const [stroke, setStroke] = useState('Forehand')
  const [hand, setHand] = useState('Right')
  const [orientationStatus, setOrientationStatus] = useState('Not enabled')
  const [live, setLive] = useState(null)
  const [samples, setSamples] = useState([])
  const [calibration, setCalibration] = useState(null)
  const [age, setAge] = useState(null)
  const session = useRef({ phase: 'idle', samples: [], calibrationSamples: [], lastEvent: 0 })
  const supported = typeof window.DeviceMotionEvent !== 'undefined'

  function finish(message = 'Recording complete. Review the graphs or download your samples.') {
    const current = session.current
    current.phase = 'idle'
    setPhase('idle')
    setSamples([...current.samples])
    setStatus(message)
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
      if (current.phase === 'recording') current.samples.push(sample)
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
    session.current.phase = 'recording'
    setSamples([])
    setPhase('recording')
    setStatus('Recording. Make one controlled swing, then tap Stop. Maximum 10 seconds.')
  }

  function download() {
    const data = { version: 2, sport: session.current.sport, strokeLabel: session.current.stroke, playingHand: session.current.hand, startOrientation: session.current.startOrientation, recordedAt: session.current.recordedAt, calibration: session.current.recordingCalibration, units: { orientation: 'degrees, browser Euler angles', relativeOrientation: 'degrees, wrapped per-axis change from first available recording orientation; not a full 3D rotation', correctedRotationRate: 'degrees/second, bias corrected', timeMs: 'milliseconds', acceleration: 'm/s²', accelerationIncludingGravity: 'm/s²', rotationRate: 'degrees/second', rotationMagnitude: 'degrees/second, bias corrected' }, samples }
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
  return <main>
    <header><span className="eyebrow">WEE SPORTS · SENSOR PROTOTYPE</span><h1>Capture your swing.</h1><p>Record the motion. Explore the rhythm.</p></header>
    <section className="panel">
      <div className="heading"><h2>Phone controller</h2><span className={ready ? 'badge ready' : 'badge'}>{ready ? 'Sensors live' : 'Waiting for sensors'}</span></div>
      <p>Use your iPhone over HTTPS. Set it down to calibrate, then hold it securely for a controlled swing.</p>
      {!window.isSecureContext && <p className="warning">HTTPS is required for phone sensor access. Open your ngrok HTTPS link.</p>}
      {!supported && <p className="warning">Motion events are unavailable in this browser. Try your iPhone’s browser over HTTPS.</p>}
      <div className="controls"><label>Sport <select value={sport} onChange={event => setSport(event.target.value)} disabled={phase !== 'idle'}><option>Tennis</option><option>Bowling</option></select></label>
        {sport === 'Tennis' && <label>Stroke label <select value={stroke} onChange={event => setStroke(event.target.value)} disabled={phase !== 'idle'}><option>Forehand</option><option>Backhand</option><option>Unknown</option></select></label>}
        <label>Playing hand <select value={hand} onChange={event => setHand(event.target.value)} disabled={phase !== 'idle'}><option>Right</option><option>Left</option></select></label>
        <button onClick={enable} disabled={enabled || !supported || !window.isSecureContext}>{enabled ? 'Motion enabled' : 'Enable motion'}</button>
        <button onClick={calibrate} disabled={!ready || phase !== 'idle'}>Calibrate · 2 sec</button>
        {phase === 'recording' ? <button className="stop" onClick={() => finish()}>Stop recording</button> : <button className="primary" onClick={record} disabled={!ready || !calibration || phase !== 'idle'}>Record swing</button>}
      </div>
      <p role="status" className="status">{status}</p>
      {enabled && age > 1.5 && <p className="warning">No recent sensor readings. Keep the phone unlocked with this page visible.</p>}
      <div className="metrics"><div><small>Live acceleration · without gravity</small><strong>{display(live?.accelerationMagnitude)} <em>m/s²</em></strong></div><div><small>Live rotation · bias corrected</small><strong>{display(live?.rotationMagnitude)} <em>°/s</em></strong></div><div><small>Calibration</small><strong>{phase === 'calibrating' ? 'Hold still…' : calibration ? 'Ready' : 'Needed'}</strong></div></div>
      <p>Phone angles: α {display(live?.orientation?.alpha)}° · β {display(live?.orientation?.beta)}° · γ {display(live?.orientation?.gamma)}°</p>
      <p className="note">{live?.orientation ? 'Orientation readings live.' : orientationStatus} Keep the same grip and starting pose when comparing swings. Stroke labels are entered by you, not predicted.</p>
      {live && !live.acceleration && <p>Gravity-free acceleration is unavailable. Raw gravity-inclusive readings are still saved when provided.</p>}
    </section>
    <section className="panel"><div className="heading"><h2>{phase === 'recording' ? 'Recording…' : 'Swing recording'}</h2><button onClick={download} disabled={!samples.length || phase !== 'idle'}>Download JSON</button></div>
      <p>{samples.length} samples · {duration.toFixed(2)} seconds captured · {display(rate)} Hz observed</p>
      <Graph samples={samples} field="accelerationMagnitude" label="Acceleration" unit="m/s²" color="#087e8b" />
      <Graph samples={samples} field="rotationMagnitude" label="Rotation rate" unit="°/s" color="#7c3aed" />
      {['Alpha', 'Beta', 'Gamma'].map((axis, index) => <Graph key={axis} samples={samples} field={`rotation${axis}`} label={`${axis} signed rotation rate`} unit="°/s" color={['#087e8b', '#7c3aed', '#c2410c'][index]} signed />)}
      <p className="note">Signed graphs preserve rotation direction. Angle changes in the export use the first available recording orientation as a reference; they are wrapped per-axis differences, not a 3D trajectory.</p>
      <p className="note">Graphs show measured magnitudes over time, not a spatial trajectory. Calibration estimates gyroscope bias; it does not locate the phone. Sport selection labels the recording; swing phase detection and 3D replay are future steps.</p>
      <p className="note">Recordings stay in this tab until downloaded. Refreshing clears them. Use a wrist strap and keep hold of the phone during bowling’s simulated release.</p>
    </section>
  </main>
}
