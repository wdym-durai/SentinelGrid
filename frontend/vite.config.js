import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls from the frontend to the backend
    // so the frontend can call "/incidents" instead of "http://localhost:3001/incidents"
    proxy: {
      '/incidents': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
