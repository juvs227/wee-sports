import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

/** Serve only the production bundle. No development server or tunnel required. */
export async function createStaticHandler(directory) {
  const root = await realpath(resolve(directory));
  for (const page of ['index', 'game', 'bowling', 'controller']) {
    if (!(await stat(resolve(root, `${page}.html`))).isFile()) throw new Error(`Missing build: ${page}.html`);
  }
  return async (request, response) => {
    const end = (status, body) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
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
    const home = path === '/' || /^\/(home|join|profile)\/?$/.test(path) || /^\/host\/[A-Z0-9]{4}\/?$/.test(path);
    const file = resolve(root, home ? 'index.html' : `.${path}`);
    if (!file.startsWith(`${root}${sep}`)) { end(404, 'Not found'); return; }
    try {
      const canonicalFile = await realpath(file);
      if (!canonicalFile.startsWith(`${root}${sep}`)) { end(404, 'Not found'); return; }
      const info = await stat(canonicalFile);
      if (!info.isFile()) { end(404, 'Not found'); return; }
      const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff', etag,
        // Only Vite's content-hashed JS/CSS can live indefinitely. Public model,
        // sound and artwork filenames can change content during a deployment.
        'cache-control': /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache' };
      const validators = request.headers?.['if-none-match']?.split(',').map(value => value.trim().replace(/^W\//, ''));
      if (validators?.some(value => value === '*' || value === etag.slice(2))) {
        response.writeHead(304, headers); response.end(); return;
      }
      response.writeHead(200, {...headers, 'content-length': info.size});
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(canonicalFile);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      end(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'File unavailable');
    }
  };
}
