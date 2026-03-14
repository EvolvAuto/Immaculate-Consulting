import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Ensures environment variables prefixed with VITE_ are
  // exposed to client-side code via import.meta.env
  envPrefix: 'VITE_',
  build: {
    outDir: 'dist',
    // IC-BOS.jsx is a large single file — raise the chunk
    // warning threshold to avoid false build warnings
    chunkSizeWarningLimit: 2000,
  },
});
