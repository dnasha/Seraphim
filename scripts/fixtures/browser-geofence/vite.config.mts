import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
