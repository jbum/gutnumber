import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [preact()],
  resolve: {
    alias: [
      { find: /^@gut\/shared\/(.*)$/, replacement: r('../shared/src/$1') },
      { find: '@gut/shared', replacement: r('../shared/src/index.ts') },
    ],
  },
  build: { outDir: r('../../dist/client'), emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3100', '/bookmarklet/picker.js': 'http://127.0.0.1:3100' },
  },
});
