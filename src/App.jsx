import { useState, useEffect } from 'react'

export default function App() {
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0 })
  const [permissionState, setPermissionState] = useState('unknown') // 'unknown' | 'granted' | 'denied' | 'n/a'

  console.log("app loaded")
  console.log("DeviceMotionEvent supported:", typeof DeviceMotionEvent !== 'undefined')
  console.log("isSecureContext:", window.isSecureContext)
  console.log("location:", window.location.href)

  useEffect(() => {
    // Non-iOS: no permission needed
    if (typeof DeviceMotionEvent?.requestPermission !== 'function') {
      setPermissionState('n/a')
    }
  }, [])

  async function requestPermission() {
    try {
      const result = await DeviceMotionEvent.requestPermission()
      setPermissionState(result)
    } catch (e) {
      setPermissionState('denied')
    }
  }

  useEffect(() => {
    if (permissionState !== 'granted' && permissionState !== 'n/a') return

    function handleMotion(event) {
      const a = event.accelerationIncludingGravity
      if (!a) return
      setCoords({
        x: a.x ?? 0,
        y: a.y ?? 0,
        z: a.z ?? 0,
      })
    }

    window.addEventListener('devicemotion', handleMotion)
    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [permissionState])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <h2>Phone Orientation</h2>
      <p>Secure Context: {window.isSecureContext ? 'true' : 'false'}</p>
      <p>DeviceMotionEvent supported: {typeof DeviceMotionEvent !== 'undefined' ? 'true' : 'false'}</p>
      {permissionState === 'unknown' && (
        <button onClick={requestPermission} style={{ padding: '12px 24px', fontSize: '16px', marginBottom: '16px' }}>
          Enable Motion
        </button>
      )}
      {permissionState === 'denied' && <p style={{ color: 'red' }}>Motion permission denied</p>}
      <p>X: {coords.x.toFixed(2)}</p>
      <p>Y: {coords.y.toFixed(2)}</p>
      <p>Z: {coords.z.toFixed(2)}</p>
    </div>
  )
}
