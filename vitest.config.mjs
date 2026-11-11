import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const serverPackage = fileURLToPath(new URL('./server', import.meta.url));
const clientPackage = fileURLToPath(new URL('./client/src', import.meta.url));
const sharedPackage = fileURLToPath(new URL('./shared', import.meta.url));
const srcPackage = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  resolve: {
    alias: {
      '@server': serverPackage,
      '@client': clientPackage,
      '@wee/shared': sharedPackage,
      '@wee/src': srcPackage,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'server/tests/*.test.js'],
  },
});
