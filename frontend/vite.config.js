import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5174,
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'MACHIBEL - Gestion Parfumerie',
        short_name: 'MACHIBEL',
        description: 'Systeme de gestion des ventes, stock et depenses - MACHIBEL',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1e9bf0',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
