import { isSwing } from '../../shared/protocol.js';
import { createInputId } from './inputId.js';

/** Embedded tennis uses the outer page's lobby session and reconnect handling. */
export function connectLobbySwings({ role, onSwing, onStatus, onAck, onSent = () => {} }) {
  let connected = false;
  let paused = true;
  const seen = new Set();
  const sentAt = new Map();
  const post = message => window.parent.postMessage(message, location.origin);
  const receive = event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'wee:lobby-state') {
      connected = message.connected === true;
      paused = message.paused !== false;
      onStatus(connected ? 'Connected to homepage lobby' : 'Reconnecting to homepage lobby…');
    } else if (message?.type === 'wee:swing-ack' && role === 'phone') {
      const start = sentAt.get(message.result?.id);
      sentAt.delete(message.result?.id);
      onAck({ ...message.result, ...(start === undefined ? {} : {
        roundTripMs: Math.round(performance.now() - start), timingScope: 'game',
      }) });
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
    sendSwing(label, hand, power = 0.5) {
      const event = { type: 'swing', id: createInputId(), label, hand, power };
      if (role !== 'phone' || !connected || paused || !isSwing(event)) return false;
      sentAt.set(event.id, performance.now());
      if (sentAt.size > 40) sentAt.delete(sentAt.keys().next().value);
      post({ type: 'wee:player-swing', event });
      onSent(event);
      return true;
    },
    close() { connected = false; window.removeEventListener('message', receive); },
  };
}
