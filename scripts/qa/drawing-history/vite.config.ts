import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, '../../../public'),
  resolve: { alias: { '@': resolve(__dirname, '../../../src') } },
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  server: { host: '127.0.0.1', port: 4175, fs: { allow: [resolve(__dirname, '../../..')] } },
});
