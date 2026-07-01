import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/fonts/fonts.css'; // bundled UI fonts (offline-safe, no CDN)
import '../legacy/legacy.css'; // design tokens + shared styles
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
