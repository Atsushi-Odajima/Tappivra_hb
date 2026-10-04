/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viewerRuntimePlugin } from './build/viewerRuntimePlugin';

// エディター（Tauri WebView / Web開発シェル）
export default defineConfig({
  plugins: [react(), viewerRuntimePlugin()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', target: ['es2021', 'chrome105'], sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
