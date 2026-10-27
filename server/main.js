import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { attachRelay } from './relay.js';

const port = Number(process.env.PORT || 5173);
const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: false,
    allowedHosts: process.env.NGROK_HOST ? [process.env.NGROK_HOST] : [],
  },
});
const server = createServer((request, response) => vite.middlewares(request, response));
attachRelay(server);
server.listen(port, '0.0.0.0', () => {
  const listeningPort = server.address().port;
  console.log(`Game: http://localhost:${listeningPort}`);
  console.log(`Tunnel this port for iPhone: ngrok http ${listeningPort}`);
});
