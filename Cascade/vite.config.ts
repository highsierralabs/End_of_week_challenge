import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  preview: { host: '127.0.0.1', port: 5191, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: 'index.html',
        validation: 'validation.html',
      },
    },
  },
});
