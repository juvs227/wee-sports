import { useEffect, useRef } from 'react';

/** Keep the existing game/controller alive while the outer page owns the lobby session. */
export function PrototypeFrame({ code, controller = false, paused = false }) {
  const frame = useRef(null);
  const room = `lobby-${code}`;
  const src = `/${controller ? 'controller' : 'game'}.html?room=${encodeURIComponent(room)}`;
  function publishState() {
    frame.current?.contentWindow?.postMessage({ type: 'wee:lobby-state', paused }, window.location.origin);
  }
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'wee:lobby-state', paused }, window.location.origin);
  }, [paused, src]);
  return (
    <div className="prototype-frame">
      <iframe ref={frame} src={src} title={controller ? 'Tennis phone controller' : 'Tennis game'}
        allow="accelerometer; gyroscope" onLoad={publishState} />
      {paused ? <div className="prototype-frame__pause" role="status">Paused — waiting for everyone to reconnect.</div> : null}
    </div>
  );
}
