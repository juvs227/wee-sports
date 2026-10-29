import { validAimX, validPower } from '../src/network/swingProtocol.js';
import { WebSocket, WebSocketServer } from 'ws';

export function attachRelay(server) {
  const relay = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/swings') { socket.destroy(); return; }
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
    client.on('error', () => {});
    client.on('pong', () => { client.alive = true; });
    client.on('message', (data, binary) => {
      try {
        const event = JSON.parse(data.toString());
        if (!validPower(event?.power) || !validAimX(event?.aimX) || !validAimX(event?.aimDepth) || binary || client.role !== 'phone' || event.type !== 'swing' ||
            !['Forehand', 'Backhand'].includes(event.label) ||
            !['Right', 'Left'].includes(event.hand) ||
            typeof event.id !== 'string' || event.id.length > 100) {
          throw new Error('Invalid swing message');
        }
        const message = JSON.stringify({ type: 'swing', id: event.id, label: event.label, hand: event.hand,
          ...(event.aimX === undefined ? {} : { aimX: event.aimX }),
          ...(event.aimDepth === undefined ? {} : { aimDepth: event.aimDepth }),
          ...(event.power === undefined ? {} : { power: event.power }) });
        let receivers = 0;
        for (const peer of relay.clients) {
          if (peer.role === 'game' && peer.room === client.room && peer.readyState === WebSocket.OPEN) {
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
