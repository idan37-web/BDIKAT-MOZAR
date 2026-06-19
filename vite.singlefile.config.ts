import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the new structured-model app (index.html) into ONE self-contained .html
// (JS/CSS/worker inlined) that opens by double-click — no server, no internet.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-single',
    chunkSizeWarningLimit: 8000,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: 'index.html' },
  },
});
