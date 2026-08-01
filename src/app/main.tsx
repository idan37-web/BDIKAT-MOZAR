import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/fonts/fonts.css'; // bundled UI fonts (offline-safe, no CDN)
import '../legacy/legacy.css'; // design tokens + shared styles
import { App } from './App';
import { registerServiceWorker } from './registerSw';

// Build stamp (injected by vite define): always-visible id so the user can verify WHICH build
// they are testing (git short hash + build date). Fixed, tiny, non-interactive.
function BuildStamp() {
  const id = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
  return (
    <div dir="ltr" title="build id" style={{
      position: 'fixed', bottom: 4, left: 8, zIndex: 99999, pointerEvents: 'none',
      fontFamily: 'monospace', fontSize: 10, color: '#8a8f98', opacity: 0.85,
      background: 'rgba(255,255,255,.7)', padding: '1px 6px', borderRadius: 4,
    }}>build {id}</div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <BuildStamp />
  </React.StrictMode>,
);

registerServiceWorker(); // Stage 9: offline / installable PWA (no-op in dev and on file://)
