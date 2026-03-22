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
        injectRegister: 'auto',
        manifestFilename: 'manifest.json',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true
        },
        manifest: {
          name: 'PureScan AI',
          short_name: 'PureScan',
          description: 'Scan the Label. Know the Truth. Make your life 1 step more Improved!',
          theme_color: '#10B981',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/?utm_source=pwa',
          scope: '/',
          orientation: 'portrait',
          icons: [
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: 'https://storage.googleapis.com/static.antigravity.dev/aistudio/attachments/2026-03-18/1742365225330_PureScan_Logo.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        devOptions: {
          enabled: true,
          type: 'module'
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
