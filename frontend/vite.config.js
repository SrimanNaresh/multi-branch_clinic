import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports can be changed without editing this file:
//   WEB_PORT  – Vite dev server for editing the UI (default 5181)
//   API_PORT  – the SmartClinic server (default 5180)
// Normal use needs no Vite: the server on 5180 serves the pre-built pages in dist/.
const WEB_PORT = Number(process.env.WEB_PORT || 5181);
const API_PORT = Number(process.env.API_PORT || 5180);

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: true,   // fail loudly instead of silently moving to another port
    // The browser calls /api on the web port; Vite forwards it to the API
    proxy: { '/api': `http://localhost:${API_PORT}` },
    // shared/permissions.js lives one level up
    fs: { allow: ['..'] },
  },
});
