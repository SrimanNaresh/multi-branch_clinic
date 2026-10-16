import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,   // fail loudly instead of silently moving to another port
    // In development the API runs on :4000; the browser calls /api on :5180
    proxy: { '/api': 'http://localhost:4000' },
    // shared/permissions.js lives one level up
    fs: { allow: ['..'] },
  },
});
