import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: [
      'proamateur-unoptimistically-louella.ngrok-free.dev',
      'resolute-carpool-litigate.ngrok-free.dev',
    ],
  },
})
