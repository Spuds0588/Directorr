import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project sites are served from /<repo>/, so the base is injected
// at build time by the deploy workflow. Locally (dev + Playwright) it stays "/".
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5181,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
