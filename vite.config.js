import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const allowedHosts = process.env.NGROK_HOST ? [process.env.NGROK_HOST] : [];

export default defineConfig({
  define: {
    '__PUBLIC_ORIGIN__': JSON.stringify(
      process.env.NGROK_HOST ? `https://${process.env.NGROK_HOST}` : '',
    ),
    'import.meta.env.PUBLIC_ORIGIN': JSON.stringify(
      process.env.NGROK_HOST ? `https://${process.env.NGROK_HOST}` : '',
    ),
  },
  server: {
    allowedHosts,
  },
  build: {
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        controller: fileURLToPath(new URL('./controller.html', import.meta.url)),
      },
    },
  },
});
