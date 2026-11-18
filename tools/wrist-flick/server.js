import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT  = 3003;

function localIP() {
  for (const ifaces of Object.values(networkInterfaces()))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}

const http = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(join(__dir, 'index.html')));
});

const ip = localIP();
http.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPhone: http://${ip}:${PORT}\n`);
});
