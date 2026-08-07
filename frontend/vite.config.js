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
      // `prompt` et non `autoUpdate`.
      //
      // Avec autoUpdate, le nouveau service worker prenait la main tout seul
      // (skipWaiting + clientsClaim) mais la page deja ouverte continuait de
      // tourner sur l'ancien code : il fallait fermer et rouvrir l'application
      // DEUX fois pour voir une nouvelle version. Sur un telephone ou le PWA
      // n'est jamais vraiment ferme, cela n'arrivait pour ainsi dire jamais.
      //
      // Ici, la nouvelle version s'installe en arriere-plan et attend. C'est
      // BandeauMiseAJour.vue qui decide du moment : une caisse ne doit pas se
      // recharger toute seule au milieu d'une vente.
      registerType: 'prompt',
      // La registration par defaut ne verifie la mise a jour qu'au chargement
      // de la page. On la remplace par la notre, qui interroge aussi le serveur
      // au retour dans l'application (voir src/pwa.js).
      injectRegister: null,
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
