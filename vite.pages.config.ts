import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
if (basePath && !/^\/[a-zA-Z0-9._-]+$/.test(basePath))
  throw new Error('NEXT_PUBLIC_BASE_PATH must be empty or a repository path.');

// GitHub Pages serves static files. Reuse the exact same application and scene.
export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(basePath) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'next/image': fileURLToPath(
        new URL('./app/static-image.tsx', import.meta.url),
      ),
    },
  },
  build: { outDir: 'dist/pages', manifest: true },
});
