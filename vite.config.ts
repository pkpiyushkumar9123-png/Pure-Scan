import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'PureScan - Health First',
          short_name: 'PureScan',
          description: 'Scan food ingredients and get instant health grades.',
          theme_color: '#065f46',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '1024x1024',
              type: 'image/png'
            },
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '192x192',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
