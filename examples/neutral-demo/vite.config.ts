import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        frame: resolve(import.meta.dirname, 'frame.html'),
        inspector: resolve(import.meta.dirname, 'inspector.html'),
      },
    },
  },
});
