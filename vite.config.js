import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define: {
    'import.meta.env.PUBLIC_ORIGIN': JSON.stringify(
      process.env.NGROK_HOST ? `https://${process.env.NGROK_HOST}` : '',
    ),
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
