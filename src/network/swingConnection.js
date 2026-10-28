import { connectLobbySwings } from './lobbyConnection.js';
import { createInputId } from './inputId.js';

// Standalone prototypes retain their relay; embedded tennis uses its lobby.
export function connectSwings({ room, role, onSwing = () => {}, onStatus = () => {}, onAck = () => {} }) {
  if (window.parent !== window && new URLSearchParams(location.search).has('lobby')) {
    return connectLobbySwings({ role, onSwing, onStatus, onAck });
  }
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
            !['Forehand', 'Backhand'].includes(message.label) || !['Left', 'Right'].includes(message.hand)) return;
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
    sendSwing(label, hand) {
      if (!['Forehand', 'Backhand'].includes(label) || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: 'swing', id: createInputId(), label, hand }));
      return true;
    },
    close() { stopped = true; clearTimeout(retry); socket.close(); },
  };
}
