import {createProfileService} from './profiles/service.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGameServer } from './src/app.js';
import { attachRelay } from './relay.js';
import { phoneLinkHandler } from './phoneLink.js';
import { createStaticHandler } from './staticFiles.js';
import { runtimeConfig } from './runtimeConfig.js';

const builtPreview = process.argv.includes('--preview');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const {port, publicOrigin, origins} = runtimeConfig(process.env, {production});
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
const managedPhoneLink = !production && process.env.PHONE_LINK_MANAGED === '1';
const phoneLink = { origin: publicOrigin, status: managedPhoneLink ? 'connecting' : publicOrigin ? 'ready' : 'local' };
// Only the parent launcher can update tunnel health over this private IPC pipe.
if (managedPhoneLink) process.on('message', message => {
  if (message?.type === 'phone-link-status' && ['ready', 'connecting', 'reconnecting', 'unavailable'].includes(message.status)) phoneLink.status = message.status;
});
let profiles;
try {profiles = createProfileService({secureCookies: production});} catch {console.warn('Profiles unavailable: check WEE_PROFILE_DB permissions and database compatibility. Guest play is available.');}
const app = createGameServer({ profiles, origins, requestHandler: phoneLinkHandler(() => phoneLink, pages) });
const relay = attachRelay(app.http, {origins});
app.http.listen(port, '0.0.0.0', () => {
  const listeningPort = app.http.address().port;
  console.log(`Game: http://localhost:${listeningPort}`);
  console.log(`Homepage and lobby: http://localhost:${listeningPort}`);
  console.log(`Standalone tennis: http://localhost:${listeningPort}/game.html`);
  console.log(`Profiles: ${profiles ? 'available' : 'unavailable (guest play only)'}`);
  console.log(phoneLink.status === 'connecting' ? 'Checking the secure phone connection…' : publicOrigin ? `Phone motion link: ${publicOrigin}` : production ? 'Phone links use the browser origin; configure PUBLIC_GAME_URL for a canonical HTTPS domain.' : 'For phone motion, start the secure session with npm run dev:phone.');
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal}); active rooms will expire.`);
  app.beginShutdown();
  // An incomplete request or transport must not outlive Railway's grace period.
  const deadline = setTimeout(() => {
    console.error('Shutdown exceeded 10 seconds; unfinished requests were interrupted.');
    app.http.closeAllConnections();
    process.exit(1);
  }, 10000);
  try {
    for (const client of relay.clients) client.terminate();
    await new Promise(resolve => relay.close(resolve));
    await app.close();
    await profiles?.close();
    if (vite && !builtPreview) await vite.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    console.error('Shutdown failed; check storage and transport availability.');
    process.exit(1);
  }
});
