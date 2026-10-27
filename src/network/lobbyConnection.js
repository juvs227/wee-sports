import { isSwing } from '../../shared/protocol.js';

/** Embedded tennis uses the outer page's lobby session and reconnect handling. */
export function connectLobbySwings({ role, onSwing, onStatus, onAck }) {
  let connected = false;
  let paused = true;
  const seen = new Set();
  const post = message => window.parent.postMessage(message, location.origin);
  const receive = event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'wee:lobby-state') {
      connected = message.connected === true;
      paused = message.paused !== false;
      onStatus(connected ? 'Connected to homepage lobby' : 'Reconnecting to homepage lobby…');
    } else if (message?.type === 'wee:swing-ack' && role === 'phone') {
      onAck(message.result);
    } else if (message?.type === 'wee:game-swing' && role === 'game' &&
      connected && !paused && isSwing(message.event) && !seen.has(message.event.id)) {
      seen.add(message.event.id);
      if (seen.size > 200) seen.delete(seen.values().next().value);
      onSwing(message.event);
    }
  };
  window.addEventListener('message', receive);
  onStatus('Connecting to homepage lobby…');
  post({ type: 'wee:bridge-ready' });
  return {
    sendSwing(label, hand) {
      const event = { type: 'swing', id: crypto.randomUUID(), label, hand };
      if (role !== 'phone' || !connected || paused || !isSwing(event)) return false;
      post({ type: 'wee:player-swing', event });
      return true;
    },
    close() { connected = false; window.removeEventListener('message', receive); },
  };
}
