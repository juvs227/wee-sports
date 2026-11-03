import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGameServer } from './src/app.js';
import { attachRelay } from './relay.js';
import { phoneLinkHandler, securePhoneOrigin } from './phoneLink.js';
import { createStaticHandler } from './staticFiles.js';

const port = Number(process.env.PORT || 5173);
const builtPreview = process.argv.includes('--preview');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
let vite;
let pages;
if (production) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  pages = await createStaticHandler(resolve(root, process.env.WEE_BUILD_DIR || 'dist'));
} else {
  const { createServer: createViteServer, preview } = await import('vite');
  vite = builtPreview ? await preview({ preview: { port: 0 } }) : await createViteServer({
    server: { middlewareMode: true, hmr: false, allowedHosts: true },
  });
  // Only the combined server accepts traffic.
  if (builtPreview) await new Promise(resolve => vite.httpServer.close(resolve));
  pages = vite.middlewares;
}
const origins = (process.env.CLIENT_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean);
const publicOrigin = securePhoneOrigin(process.env.PUBLIC_GAME_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  process.env.VITE_PUBLIC_URL || (process.env.NGROK_HOST ? `https://${process.env.NGROK_HOST}` : ''));
const phoneLink = { origin: publicOrigin, status: process.env.PHONE_LINK_MANAGED === '1' ? 'connecting' : publicOrigin ? 'ready' : 'local' };
// Only the parent launcher can update tunnel health over this private IPC pipe.
if (process.env.PHONE_LINK_MANAGED === '1') process.on('message', message => {
  if (message?.type === 'phone-link-status' && ['ready', 'connecting', 'reconnecting', 'unavailable'].includes(message.status)) phoneLink.status = message.status;
});
const app = createGameServer({ origins, requestHandler: phoneLinkHandler(() => phoneLink, pages) });
const relay = attachRelay(app.http);
app.http.listen(port, '0.0.0.0', () => {
  const listeningPort = app.http.address().port;
  console.log(`Game: http://localhost:${listeningPort}`);
  console.log(`Homepage and lobby: http://localhost:${listeningPort}`);
  console.log(`Standalone tennis: http://localhost:${listeningPort}/game.html`);
  console.log(phoneLink.status === 'connecting' ? 'Checking the secure phone connection…' : publicOrigin ? `Phone motion link: ${publicOrigin}` : 'For phone motion, start the secure session with npm run dev:phone.');
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  for (const client of relay.clients) client.terminate();
  await new Promise(resolve => relay.close(resolve));
  await app.close();
  if (vite && !builtPreview) await vite.close();
  process.exit(0);
});
