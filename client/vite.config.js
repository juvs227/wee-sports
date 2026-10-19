import os from 'node:os';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The laptop's Wi-Fi address. Phones can't open "localhost", so when the TV
 * page runs on localhost the QR code points here instead. Prefers private
 * ranges so a VPN or Docker bridge doesn't win.
 */
function lanHost() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return candidates.find(isPrivate) ?? candidates[0] ?? null;
}

export default defineConfig({
  plugins: [react()],
  define: {
    __LAN_HOST__: JSON.stringify(lanHost()),
  },
  server: {
    // Listen on the network so phones on the same Wi-Fi can load the page.
    host: true,
    port: 5173,
    // Phones and the TV both reach the game server through Vite, so there is
    // one origin to think about in development.
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
