import { createServer as createViteServer, preview } from 'vite';
import { createGameServer } from './src/app.js';
import { attachRelay } from './relay.js';
import { phoneLinkHandler, securePhoneOrigin } from './phoneLink.js';

const port = Number(process.env.PORT || 5173);
const builtPreview = process.argv.includes('--preview');
const vite = builtPreview ? await preview({ preview: { port: 0 } }) : await createViteServer({
  server: {
    middlewareMode: true,
    hmr: false,
    allowedHosts: true,
  },
});
// preview supplies the same built pages; only the combined server accepts traffic.
if (builtPreview) await new Promise(resolve => vite.httpServer.close(resolve));
const origins = (process.env.CLIENT_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean);
const publicOrigin = securePhoneOrigin(process.env.PUBLIC_GAME_URL || process.env.VITE_PUBLIC_URL || (process.env.NGROK_HOST ? `https://${process.env.NGROK_HOST}` : ''));
const app = createGameServer({ origins, requestHandler: phoneLinkHandler(publicOrigin, vite.middlewares) });
const relay = attachRelay(app.http);
app.http.listen(port, '0.0.0.0', () => {
  const listeningPort = app.http.address().port;
  console.log(`Game: http://localhost:${listeningPort}`);
  console.log(`Homepage and lobby: http://localhost:${listeningPort}`);
  console.log(`Standalone tennis: http://localhost:${listeningPort}/game.html`);
  console.log(publicOrigin ? `Phone motion link: ${publicOrigin}` : 'For phone motion, start the secure session with npm run dev:phone.');
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  for (const client of relay.clients) client.terminate();
  await new Promise(resolve => relay.close(resolve));
  await app.close();
  if (!builtPreview) await vite.close();
  process.exit(0);
});
