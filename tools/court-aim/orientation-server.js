import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { networkInterfaces } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = 3002;

function localIP() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

const http = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/phone') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dir, 'orientation-phone.html')));
  } else if (url === '/ios-fusion.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(readFileSync(join(__dir, 'ios-fusion.js')));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dir, 'orientation-viewer.html')));
  }
});

const io = new Server(http, { cors: { origin: '*' } });

io.on('connection', socket => {
  socket.onAny((event, data) => socket.broadcast.emit(event, data));
});

const ip = localIP();
http.listen(PORT, '0.0.0.0', () => {
  console.log(`\nComputer viewer: http://localhost:${PORT}`);
  console.log(`Phone:           http://${ip}:${PORT}/phone\n`);
});
