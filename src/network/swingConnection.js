import { connectLobbySwings } from './lobbyConnection.js';
import { createInputId } from './inputId.js';
import { isSwing } from '../../shared/protocol.js';

// Standalone prototypes retain their relay; embedded tennis uses its lobby.
export function connectSwings({ room, role, onSwing = () => {}, onStatus = () => {}, onAck = () => {}, onSent = () => {} }) {
  if (window.parent !== window && new URLSearchParams(location.search).has('lobby')) {
    return connectLobbySwings({ role, onSwing, onStatus, onAck, onSent });
  }
  let socket;
  let retry;
  let stopped = false;
  const seen = new Set();
  const sentAt = new Map();
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
        if (message.type === 'ack') {
          const start = sentAt.get(message.id);
          sentAt.delete(message.id);
          onAck({ ...message, ...(start === undefined ? {} : {
            roundTripMs: Math.round(performance.now() - start), timingScope: 'server',
          }) });
        }
        if (!isSwing(message) || seen.has(message.id)) return;
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
    sendSwing(label, hand, power = 0.5, placement = {}) {
      const event = { type: 'swing', id: createInputId(), label, hand, power,
        ...(placement.aim === undefined ? {} : {aim:placement.aim}), ...(placement.depth === undefined ? {} : {depth:placement.depth}) };
      if (!isSwing(event) || socket.readyState !== WebSocket.OPEN) return false;
      sentAt.set(event.id, performance.now());
      if (sentAt.size > 40) sentAt.delete(sentAt.keys().next().value);
      socket.send(JSON.stringify(event));
      onSent(event);
      return true;
    },
    close() { stopped = true; clearTimeout(retry); socket.close(); },
  };
}
