import { useState, useEffect, useRef } from 'react'

const WINDOW_MS = 15000
const SAMPLE_EVERY_MS = 50 // 20Hz

export default function App() {
  const [permissionState, setPermissionState] = useState('unknown')
  const [magnitude, setMagnitude] = useState(0)
  const [recording, setRecording] = useState(null) // null | 'swing' | 'not_swing'
  const [sessions, setSessions] = useState([]) // [{ id, label, samples: [{t_offset, mag}] }]

  const samplesRef = useRef([]) // rolling 15s for 3D viz
  const recordingRef = useRef(null) // { label, startT, samples }
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const rotRef = useRef({ azimuth: 0.4, elevation: 0.3 })
  const dragRef = useRef(null)
  const lastSampleRef = useRef(0)
  const rafRef = useRef(null)
  const aboveThresholdRef = useRef(false)

  const audioCtxRef = useRef(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (typeof DeviceMotionEvent?.requestPermission !== 'function') setPermissionState('n/a')
  }, [])

  async function requestPermission() {
    try {
      const result = await DeviceMotionEvent.requestPermission()
      setPermissionState(result)
    } catch { setPermissionState('denied') }
  }

  // Motion sampling
  useEffect(() => {
    if (permissionState !== 'granted' && permissionState !== 'n/a') return

    function handleMotion(e) {
      const a = e.accelerationIncludingGravity
      if (!a) return
      const now = Date.now()
      if (now - lastSampleRef.current < SAMPLE_EVERY_MS) return
      lastSampleRef.current = now

      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2)
      setMagnitude(mag)

      // Beep + vibrate on rising edge above threshold (once per crossing, 1s cooldown)
      const THRESHOLD = 25
      if (mag >= THRESHOLD && !aboveThresholdRef.current) {
try {
          if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
          const ctx = audioCtxRef.current
          if (ctx.state === 'suspended') ctx.resume()
          console.log('AudioContext state:', ctx.state)
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = 880
          gain.gain.setValueAtTime(0.4, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
          osc.start()
          osc.stop(ctx.currentTime + 0.15)
        } catch (e) {
          console.error('Beep failed:', e)
        }
      }
      aboveThresholdRef.current = mag >= THRESHOLD

      // Rolling 3D buffer
      const samples = samplesRef.current
      samples.push({ x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0, t: now })
      const cutoff = now - WINDOW_MS
      let i = 0
      while (i < samples.length && samples[i].t < cutoff) i++
      if (i > 0) samples.splice(0, i)

      // Active recording
      if (recordingRef.current) {
        recordingRef.current.samples.push({
          t_offset: now - recordingRef.current.startT,
          mag: parseFloat(mag.toFixed(4)),
        })
      }
    }

    window.addEventListener('devicemotion', handleMotion)
    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [permissionState])

  function startSwing() {
    recordingRef.current = { label: 'swing', startT: Date.now(), samples: [] }
    setRecording('swing')
  }

  function endSwing() {
    const rec = recordingRef.current
    recordingRef.current = null
    setRecording(null)
    if (!rec || rec.samples.length === 0) return
    setSessions(s => [...s, { id: Date.now(), label: 'swing', samples: rec.samples }])
  }

  function startNotSwing() {
    recordingRef.current = { label: 'not_swing', startT: Date.now(), samples: [] }
    setRecording('not_swing')
  }

  function endNotSwing() {
    const rec = recordingRef.current
    recordingRef.current = null
    setRecording(null)
    if (!rec || rec.samples.length === 0) return
    setSessions(s => [...s, { id: Date.now(), label: 'not_swing', samples: rec.samples }])
  }

  function downloadCSV() {
    const rows = ['session_id,label,t_offset_ms,magnitude']
    for (const session of sessions) {
      for (const s of session.samples) {
        rows.push(`${session.id},${session.label},${s.t_offset},${s.mag}`)
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'swing_data.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Draw loop
  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const samples = samplesRef.current
      if (samples.length < 2) {
        ctx.fillStyle = '#555'
        ctx.font = '14px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('waiting for motion...', W / 2, H / 2)
        return
      }

      let minV = Infinity, maxV = -Infinity
      for (const s of samples) {
        minV = Math.min(minV, s.x, s.y, s.z)
        maxV = Math.max(maxV, s.x, s.y, s.z)
      }
      const range = maxV - minV || 1
      const norm = v => ((v - minV) / range) * 2 - 1

      const { azimuth, elevation } = rotRef.current
      const cosA = Math.cos(azimuth), sinA = Math.sin(azimuth)
      const cosE = Math.cos(elevation), sinE = Math.sin(elevation)
      const scale = Math.min(W, H) * 0.42
      const cx = W / 2, cy = H / 2

      function project(nx, ny, nz) {
        const rx = nx * cosA + nz * sinA
        const ry = ny
        const rz = -nx * sinA + nz * cosA
        const ex = rx
        const ey = ry * cosE - rz * sinE
        const ez = ry * sinE + rz * cosE
        const d = ez + 1.5
        return { sx: cx + (ex / d) * scale, sy: cy - (ey / d) * scale }
      }

      const axisLabels = [
        { vec: [1,0,0], label: 'X', color: '#f66' },
        { vec: [0,1,0], label: 'Y', color: '#6f6' },
        { vec: [0,0,1], label: 'Z', color: '#66f' },
      ]
      const origin = project(0, 0, 0)
      for (const { vec, label, color } of axisLabels) {
        const tip = project(...vec)
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(origin.sx, origin.sy)
        ctx.lineTo(tip.sx, tip.sy)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = color
        ctx.font = 'bold 12px monospace'
        ctx.fillText(label, tip.sx + 4, tip.sy)
      }

      const now = Date.now()
      ctx.lineWidth = 1.5
      for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1]
        const curr = samples[i]
        const age = (now - curr.t) / WINDOW_MS
        const alpha = 1 - age * 0.85
        const p0 = project(norm(prev.x), norm(prev.y), norm(prev.z))
        const p1 = project(norm(curr.x), norm(curr.y), norm(curr.z))
        ctx.strokeStyle = `rgba(255, 200, 80, ${alpha})`
        ctx.beginPath()
        ctx.moveTo(p0.sx, p0.sy)
        ctx.lineTo(p1.sx, p1.sy)
        ctx.stroke()
      }

      const last = samples[samples.length - 1]
      const pt = project(norm(last.x), norm(last.y), norm(last.z))
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(pt.sx, pt.sy, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  function onPointerDown(e) {
    dragRef.current = { x: e.clientX, y: e.clientY, ...rotRef.current }
  }
  function onPointerMove(e) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    rotRef.current = {
      azimuth: dragRef.current.azimuth + dx * 0.01,
      elevation: Math.max(-1.4, Math.min(1.4, dragRef.current.elevation + dy * 0.01)),
    }
  }
  function onPointerUp() { dragRef.current = null }

  const swingCount = sessions.filter(s => s.label === 'swing').length
  const notSwingCount = sessions.filter(s => s.label === 'not_swing').length
  const PANEL_H = 220

  return (
    <div style={{ background: '#111', height: '100dvh', display: 'flex', flexDirection: 'column', userSelect: 'none', overflow: 'hidden' }}>
      {permissionState === 'unknown' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={requestPermission} style={{ padding: '14px 32px', fontSize: '18px', borderRadius: 10, border: 'none', background: '#f90', color: '#111', fontWeight: 'bold' }}>
            Enable Motion
          </button>
        </div>
      )}
      {permissionState === 'denied' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#f66', fontFamily: 'monospace' }}>Motion permission denied</p>
        </div>
      )}
      {(permissionState === 'granted' || permissionState === 'n/a') && (<>
        {/* 3D canvas */}
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h - PANEL_H}
          style={{ touchAction: 'none', cursor: 'grab', display: 'block', flexShrink: 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />

        {/* Control panel */}
        <div style={{ height: PANEL_H, background: '#1a1a1a', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around', padding: '12px 20px', boxSizing: 'border-box', gap: 10 }}>

          {/* Live magnitude */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: recording ? '#f90' : '#fff', fontFamily: 'monospace', fontSize: 36, fontWeight: 'bold', minWidth: 80, textAlign: 'right' }}>
              {magnitude.toFixed(1)}
            </span>
            <span style={{ color: '#555', fontFamily: 'monospace', fontSize: 13 }}>m/s²  {recording && <span style={{ color: '#f90' }}>● REC</span>}</span>
          </div>

          {/* Swing buttons */}
          <div style={{ display: 'flex', gap: 12, width: '100%' }}>
            {recording !== 'swing' ? (
              <button
                onClick={startSwing}
                disabled={recording === 'not_swing'}
                style={{ flex: 1, padding: '14px 0', fontSize: 16, fontWeight: 'bold', borderRadius: 10, border: 'none', background: recording ? '#333' : '#2a7', color: recording ? '#555' : '#fff', cursor: recording ? 'default' : 'pointer' }}
              >
                START SWING
              </button>
            ) : (
              <button
                onClick={endSwing}
                style={{ flex: 1, padding: '14px 0', fontSize: 16, fontWeight: 'bold', borderRadius: 10, border: 'none', background: '#e33', color: '#fff', cursor: 'pointer' }}
              >
                END SWING
              </button>
            )}
            {recording !== 'not_swing' ? (
              <button
                onClick={startNotSwing}
                disabled={recording === 'swing'}
                style={{ flex: 1, padding: '14px 0', fontSize: 16, fontWeight: 'bold', borderRadius: 10, border: 'none', background: recording ? '#333' : '#27a', color: recording ? '#555' : '#fff', cursor: recording ? 'default' : 'pointer' }}
              >
                NOT A SWING
              </button>
            ) : (
              <button
                onClick={endNotSwing}
                style={{ flex: 1, padding: '14px 0', fontSize: 16, fontWeight: 'bold', borderRadius: 10, border: 'none', background: '#e33', color: '#fff', cursor: 'pointer' }}
              >
                END NOT-SWING
              </button>
            )}
          </div>

          {/* Download row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%' }}>
            <span style={{ color: '#555', fontFamily: 'monospace', fontSize: 12, flex: 1 }}>
              {swingCount} swings · {notSwingCount} not-swings
            </span>
            <button
              onClick={downloadCSV}
              disabled={sessions.length === 0}
              style={{ padding: '8px 18px', fontSize: 13, borderRadius: 8, border: '1px solid #444', background: sessions.length ? '#222' : '#1a1a1a', color: sessions.length ? '#aaa' : '#444', cursor: sessions.length ? 'pointer' : 'default' }}
            >
              Download CSV
            </button>
          </div>
        </div>
      </>)}
    </div>
  )
}
