import { readFileSync } from 'node:fs';

// A successful JS bundle alone doesn't guarantee that runtime-loaded GLBs ship.
for (const name of ['player', 'racket']) {
  const path = new URL(`../dist/assets/${name}.glb`, import.meta.url);
  const bytes = readFileSync(path);
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`Missing or invalid built model: ${path.pathname}`);
  }
  console.log(`Verified dist/assets/${name}.glb (${bytes.length} bytes)`);
}
