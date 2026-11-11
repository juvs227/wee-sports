import { WebSocket, WebSocketServer } from 'ws';
import {EVENTS, isSwing} from '../shared/protocol.js';
import {isAllowedOrigin} from './origins.js';
import {createEventLimiter} from './src/eventLimits.js';

export function attachRelay(server, {origins = []} = {}) {
  const relay = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (request, socket, head) => {
    let url;
    try {url = new URL(request.url, 'http://localhost');} catch {socket.destroy(); return;}
    // The platform's Socket.io server also uses this HTTP server.
    if (url.pathname.startsWith('/socket.io/')) return;
    if (url.pathname !== '/swings') { socket.destroy(); return; }
    if (!isAllowedOrigin(request, origins)) {socket.destroy(); return;}
    const room = url.searchParams.get('room');
    const role = url.searchParams.get('role');
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room ?? '') || !['phone', 'game'].includes(role)) {
      socket.destroy(); return;
    }
    relay.handleUpgrade(request, socket, head, client => {
      client.room = room;
      client.role = role;
      client.alive = true;
      relay.emit('connection', client);
    });
  });
  relay.on('connection', client => {
    const admitEvent = createEventLimiter();
    client.on('error', () => {});
    client.on('pong', () => { client.alive = true; });
    client.on('message', (data, binary) => {
      try {
        if (!admitEvent(EVENTS.PLAYER_SWING)) {
          client.send(JSON.stringify({type:'error', message:'Too many swing messages'})); return;
        }
        const event = JSON.parse(data.toString());
        if (binary || client.role !== 'phone' || !isSwing(event)) {
          throw new Error('Invalid swing message');
        }
        const message = JSON.stringify({ type: 'swing', id: event.id, label: event.label, hand: event.hand,
          ...(event.power === undefined ? {} : { power: event.power }),
          ...(event.aim === undefined ? {} : {aim:event.aim}), ...(event.depth === undefined ? {} : {depth:event.depth}) });
        let receivers = 0;
        for (const peer of relay.clients) {
          if (peer.role === 'game' && peer.room === client.room && peer.readyState === WebSocket.OPEN && peer.bufferedAmount < 8192) {
            peer.send(message); receivers++;
          }
        }
        client.send(JSON.stringify({ type: 'ack', id: event.id, receivers }));
      } catch {
        client.send(JSON.stringify({ type: 'error', message: 'Invalid swing message' }));
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of relay.clients) {
      if (!client.alive) { client.terminate(); continue; }
      client.alive = false;
      client.ping();
    }
  }, 30000);
  heartbeat.unref();
  relay.on('close', () => clearInterval(heartbeat));
  return relay;
}
