import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDir = resolve(fileURLToPath(new URL('../', import.meta.url)), process.env.WEE_BUILD_DIR || 'dist');

// A successful JS bundle alone doesn't guarantee that runtime-loaded GLBs ship.
for (const name of ['player', 'racket']) {
  const path = resolve(buildDir, `assets/${name}.glb`);
  const bytes = readFileSync(path);
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`Missing or invalid built model: ${path}`);
  }
  console.log(`Verified ${name}.glb (${bytes.length} bytes)`);
}

for (const page of ['index', 'game', 'controller', 'bowling']) {
  const html = readFileSync(resolve(buildDir, `${page}.html`), 'utf8');
  if (!html.includes('type="module"')) throw new Error(`Missing built entry point: ${page}`);
}
console.log('Verified all four built pages');
