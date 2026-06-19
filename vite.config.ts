import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Stage 1 (C.3): real Vite + React build. JSX is transpiled at build time by
// @vitejs/plugin-react (esbuild/automatic runtime) — NO Babel in the browser.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        main: 'index.html',      // new structured-model app
        legacy: 'legacy.html',   // design prototype (reference)
      },
    },
  },
});
