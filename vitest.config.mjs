import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const sharedPackage = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  resolve: {
    alias: {
      '@wee/shared': sharedPackage,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'server/*.test.js'],
  },
});
