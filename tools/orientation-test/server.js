#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath, URL} from 'node:url';
import {WebSocketServer, WebSocket} from 'ws';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILES = new Set(['/tools/orientation-test/index.html', '/src/controller/orientationCalibration.js',
  '/src/controller/androidCalibration.js', '/src/controller/iosCalibration.js']);

// This diagnostic server serves only its four public files, never repo data.
export function createOrientationTestServer() {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? '/tools/orientation-test/index.html' : pathname;
    if (!FILES.has(file) || !['GET', 'HEAD'].includes(req.method)) {res.writeHead(404); res.end(); return;}
    try {
      const bytes = await fs.readFile(path.join(ROOT, file));
      res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {res.writeHead(404); res.end();}
  });
  const relay = new WebSocketServer({server, maxPayload: 16384, verifyClient: ({origin, req}) => {
    try {return new URL(origin).host === req.headers.host;} catch {return false;}
  }});
  relay.on('connection', socket => {
    socket.on('error', () => {});
    socket.on('message', message => {
      for (const client of relay.clients) {
        if (client !== socket && client.readyState === WebSocket.OPEN && client.bufferedAmount < 16384) client.send(message.toString());
      }
    });
  });
  return {server, relay};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {server} = createOrientationTestServer();
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3737);
  server.listen(port, host, () => {
    process.stdout.write(`Orientation test: http://localhost:${server.address().port}?role=screen\nUse HOST=0.0.0.0 with a trusted LAN or HTTPS tunnel for a phone.\n`);
  });
}
