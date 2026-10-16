import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports can be changed without editing this file:
//   WEB_PORT  – where the web app runs (default 5180)
//   API_PORT  – where the backend API runs (default 4000)
// start-windows.bat sets both at the top of the file.
const WEB_PORT = Number(process.env.WEB_PORT || 5180);
const API_PORT = Number(process.env.API_PORT || 4000);

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
