import fs from 'fs';
import path from 'path';
import gts from 'gts';

let customConfig = [];
const ignoresPath = path.resolve('./eslint.ignores.js');

// Check if eslint.ignores.js exists before loading it
if (fs.existsSync(ignoresPath)) {
  // Use dynamic import for ES modules instead of require()
  const ignoresModule = await import('./eslint.ignores.js');
  customConfig = [{ ignores: ignoresModule.default || ignoresModule }];
}

export default [...customConfig, ...gts];