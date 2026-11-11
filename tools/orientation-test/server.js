#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const PORT = 3737;
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/tools/orientation-test/index.html';
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(String(err)); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('message', msg => {
    const str = msg.toString();
    for (const c of clients) if (c !== ws && c.readyState === 1) c.send(str);
  });
  ws.on('close', () => clients.delete(ws));
});

const lan = Object.values(os.networkInterfaces()).flat()
  .find(i => i.family === 'IPv4' && !i.internal)?.address ?? 'YOUR_LAN_IP';

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nLaptop: http://localhost:${PORT}?role=screen`);
  console.log(`Phone:  http://${lan}:${PORT}?role=phone\n`);
});
