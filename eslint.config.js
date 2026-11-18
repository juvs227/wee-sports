// eslint.config.js
import gts from 'gts';
import customIgnores from './eslint.ignores.js';

export default [
  { ignores: customIgnores },
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        performance: 'readonly',
        WebSocket: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        ResizeObserver: 'readonly',
        DeviceMotionEvent: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
      }
    }
  },
  ...gts
];