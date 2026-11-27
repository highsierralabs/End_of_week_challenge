import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5196, strictPort: true },
  preview: { host: '127.0.0.1', port: 5197, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', validation: 'validation.html' } },
  },
});
