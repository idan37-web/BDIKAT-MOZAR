import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Stage 1 (C.3): real Vite + React build. JSX is transpiled at build time by
// @vitejs/plugin-react (esbuild/automatic runtime) — NO Babel in the browser.

// Build stamp: git short hash + date, injected as __BUILD_ID__ and shown in the app footer,
// so every delivered build is identifiable (delivery-chain verification).
export function buildId(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${hash} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
  } catch { return 'dev'; }
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
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
