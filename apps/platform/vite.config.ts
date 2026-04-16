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
      // Conges API: /conges-api/* → /conges/api/*
      '/conges-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/conges-api/, '/conges/api'),
      },
      // Roadmap API: /roadmap-api/* → /roadmap/api/*
      '/roadmap-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/roadmap-api/, '/roadmap/api'),
      },
      // SuiViTess API: /suivitess-api/* → /suivitess/api/*
      '/suivitess-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/suivitess-api/, '/suivitess/api'),
      },
      // Delivery API: /delivery-api/* → /delivery/api/*
      '/delivery-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/delivery-api/, '/delivery/api'),
      },
      // Mon CV API: /mon-cv-api/* → /mon-cv/api/*
      '/mon-cv-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/mon-cv-api/, '/mon-cv/api'),
      },
      // RAG API: /rag-api/* → /rag/api/*
      '/rag-api': {
        target: UNIFIED_SERVER,
        rewrite: (path) => path.replace(/^\/rag-api/, '/rag/api'),
      },
      // AI Skills API (admin-only editor) : /ai-skills/api/*
      '/ai-skills/api': {
        target: UNIFIED_SERVER,
      },
      // Gateway APIs (auth, admin)
      '/api/auth': {
        target: UNIFIED_SERVER,
      },
      '/api/admin': {
        target: UNIFIED_SERVER,
      },
      '/api/connectors': {
        target: UNIFIED_SERVER,
      },
      '/api/platform': {
        target: UNIFIED_SERVER,
      },
      '/api/sharing': {
        target: UNIFIED_SERVER,
      },
      '/api/users': {
        target: UNIFIED_SERVER,
      },
      '/api/admin/credits': {
        target: UNIFIED_SERVER,
      },
      '/api/auth/fathom': {
        target: UNIFIED_SERVER,
      },
      '/api/auth/outlook': {
        target: UNIFIED_SERVER,
      },
      '/api/auth/gmail': {
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
