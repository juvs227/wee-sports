import { validAimX, validPower } from './swingProtocol.js';
// Both browser clients use the page's origin, so HTTPS automatically uses WSS.
export function connectSwings({ room, role, onSwing = () => {}, onStatus = () => {}, onAck = () => {} }) {
  let socket;
  let retry;
  let stopped = false;
  const seen = new Set();
  function connect() {
    const url = new URL('/swings', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('room', room);
    url.searchParams.set('role', role);
    socket = new WebSocket(url);
    onStatus('Connecting…');
    socket.onopen = () => onStatus('Connected');
    socket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'ack') onAck(message);
        if (message.type !== 'swing' || seen.has(message.id) ||
            !validPower(message.power) || !validAimX(message.aimX) || !validAimX(message.aimDepth) || !['Forehand', 'Backhand'].includes(message.label) || !['Left', 'Right'].includes(message.hand)) return;
        seen.add(message.id);
        if (seen.size > 200) seen.delete(seen.values().next().value);
        onSwing(message);
      } catch { /* Ignore malformed messages. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (stopped) return;
      onStatus('Disconnected; reconnecting…');
      retry = setTimeout(connect, 1500);
    };
  }
  connect();
  return {
    sendSwing(label, hand, aimX, aimDepth, power) {
      if (!validPower(power) || !validAimX(aimX) || !validAimX(aimDepth) || !['Forehand', 'Backhand'].includes(label) || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: 'swing', id: crypto.randomUUID(), label, hand, ...(aimX === undefined ? {} : { aimX }), ...(aimDepth === undefined ? {} : { aimDepth }), ...(power === undefined ? {} : { power }) }));
      return true;
    },
    close() { stopped = true; clearTimeout(retry); socket.close(); },
  };
}
