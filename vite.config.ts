/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: process.env.VITE_BASE_URL ?? '/',
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon-96.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Baby Monitor',
        short_name: 'BabyMonitor',
        description: 'Keep an eye and an ear on your little one',
        // Matches the light theme's surface colour from src/theme.ts.
        theme_color: '#F7FAFB',
        background_color: '#F7FAFB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        categories: ['lifestyle', 'parenting', 'utilities'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Without a maskable icon Android crops the square artwork inside its
          // adaptive-icon mask.
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // woff2 must be listed or the self-hosted Roboto is not precached and the app
        // falls back to a system font when offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // Vite discovers Vuetify's auto-imported components lazily. On a cold cache
    // that discovery triggers a full page reload, which can reset an E2E pairing.
    include: [
      'vuetify/components/VAlert',
      'vuetify/components/VApp',
      'vuetify/components/VAppBar',
      'vuetify/components/VBtn',
      'vuetify/components/VBtnToggle',
      'vuetify/components/VCard',
      'vuetify/components/VChip',
      'vuetify/components/VDialog',
      'vuetify/components/VGrid',
      'vuetify/components/VIcon',
      'vuetify/components/VMain',
      'vuetify/components/VProgressLinear',
      'vuetify/components/VSlider',
      'vuetify/components/VSwitch',
      'vuetify/components/VTextarea',
    ],
  },
  server: {
    watch: {
      // Playwright writes traces while the dev server runs. Without this ignore
      // Vite treats those files as outside the module graph and reloads the page.
      ignored: ['**/test-results/**', '**/playwright-report/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: ['vuetify'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/main.ts', 'src/test-setup.ts'],
    },
  },
})
