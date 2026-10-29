import { defineConfig } from 'astro/config';

// Static multi-page build. Set BASE (e.g. "/ai-discover/") when hosting under a sub-path.
export default defineConfig({
  base: process.env.BASE || '/',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  vite: {
    // pdf.js ships modern syntax (top-level await, private fields).
    build: { target: 'es2022' },
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  },
});
