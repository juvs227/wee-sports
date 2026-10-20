// eslint.config.js
import fs from 'fs';
import path from 'path';
import gts from 'gts';

let customConfig = [];
const ignoresPath = path.resolve('./eslint.ignores.js');

if (fs.existsSync(ignoresPath)) {
  const ignoresModule = await import('./eslint.ignores.js');
  customConfig = [{ ignores: ignoresModule.default || ignoresModule }];
}

export default [...customConfig, ...gts];