import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// All API proxies point to the unified server on port 3010
const UNIFIED_SERVER = 'http://localhost:3010';

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5170,
    host: true,
    proxy: {
      // Products API: /products-api/* → /products/api/*
      '/products-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/products-api/, '/products/api'),
      },
      // Conges API: /conges-api/* → /conges/api/*
      '/conges-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/conges-api/, '/conges/api'),
      },
      // Gateway APIs (auth, admin)
      '/api/auth': {
        target: UNIFIED_SERVER,
      },
      '/api/admin': {
        target: UNIFIED_SERVER,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-shared': ['@boilerplate/shared'],
        },
      },
    },
  },
});
