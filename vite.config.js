import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import react from '@vitejs/plugin-react';

const addresses = Object.values(os.networkInterfaces()).flat()
  .filter(address => address?.family === 'IPv4' && !address.internal).map(address => address.address);
const lanHost = addresses.find(ip => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) ?? addresses[0] ?? null;

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const publicOrigin = env.VITE_PUBLIC_URL || (env.NGROK_HOST ? `https://${env.NGROK_HOST}` : '');
  return {
    plugins: [react()],
    define: {
      '__LAN_HOST__': JSON.stringify(lanHost),
      'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicOrigin),
      '__PUBLIC_ORIGIN__': JSON.stringify(publicOrigin),
      'import.meta.env.PUBLIC_ORIGIN': JSON.stringify(publicOrigin),
    },
    server: {
      allowedHosts: true, // Allows your ngrok tunnel and other external hosts during development
    },
    build: {
      rollupOptions: {
        input: {
          home: fileURLToPath(new URL('./index.html', import.meta.url)),
          game: fileURLToPath(new URL('./game.html', import.meta.url)),
          controller: fileURLToPath(new URL('./controller.html', import.meta.url)),
        },
      },
    },
  };
});
