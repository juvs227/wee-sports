import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

/** Serve only the production bundle. No development server or tunnel required. */
export async function createStaticHandler(directory) {
  const root = resolve(directory);
  for (const page of ['index', 'game', 'bowling', 'controller']) {
    if (!(await stat(resolve(root, `${page}.html`))).isFile()) throw new Error(`Missing build: ${page}.html`);
  }
  return async (request, response) => {
    const end = (status, body) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD'); end(405, 'Method not allowed'); return;
    }
    let path;
    try { path = decodeURIComponent(request.url.split('?')[0]); }
    catch { end(400, 'Invalid path'); return; }
    if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') ||
        path.split('/').some(part => part === '..' || part.startsWith('.'))) {
      end(404, 'Not found'); return;
    }
    const home = path === '/' || /^\/join\/?$/.test(path) || /^\/host\/[A-Z0-9]{4}\/?$/.test(path);
    const file = resolve(root, home ? 'index.html' : `.${path}`);
    if (!file.startsWith(`${root}${sep}`)) { end(404, 'Not found'); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) { end(404, 'Not found'); return; }
      response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'content-length': info.size, 'x-content-type-options': 'nosniff',
        // HTML revalidates on every load; assets can be reused briefly. GLB names
        // are not hashed, so do not mark the entire assets directory immutable.
        'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      end(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'File unavailable');
    }
  };
}
