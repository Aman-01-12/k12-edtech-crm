import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // One .env at the repository root serves both applications, so Vite is
  // pointed there rather than keeping a second copy in this directory.
  envDir: '..',

  server: {
    port: 5173,
    // Proxying /api makes development same-origin, matching production, where
    // the deployed frontend rewrites /api to the backend. Without this, local
    // cookies would be cross-site and behave differently from the real thing.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },

  build: {
    // Needed to read a production stack trace; the maps are not referenced by
    // the served bundle, so they cost nothing at runtime.
    sourcemap: true,
  },
});
