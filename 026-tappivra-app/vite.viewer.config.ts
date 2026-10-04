import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { pwaPlugin } from './build/pwaPlugin';

// 閲覧PWA（/viewer/ に静的配備する）。編集機能は含めない。
export default defineConfig({
  root: fileURLToPath(new URL('./src/pwa', import.meta.url)),
  base: '/viewer/',
  publicDir: false,
  plugins: [react(), pwaPlugin()],
  build: {
    outDir: fileURLToPath(new URL('./dist-viewer/viewer', import.meta.url)),
    emptyOutDir: true,
    target: ['es2020', 'safari15'],
    sourcemap: false,
  },
  server: { port: 5174, strictPort: true },
});
