export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  telemetry: false,
  devtools: { enabled: false },
  // SSR stays on for `nuxt dev` (a Nuxt 4.4 dev-server bug breaks SPA mode);
  // static generation for Tauri disables it via `NUXT_SSR=false`.
  ssr: process.env.NUXT_SSR !== 'false',
  devServer: {
    host: '127.0.0.1',
  },
  css: [
    '~/assets/css/main.css',
    // Static markup styles for convertLatexToMarkup output (palette chips).
    'mathlive/static.css',
    '~/assets/css/mathlive-fonts.css',
  ],
  vue: {
    compilerOptions: {
      isCustomElement: (tag) => tag === 'math-field',
    },
  },
  vite: {
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_'],
    optimizeDeps: {
      include: ['mathlive'],
    },
    server: {
      strictPort: true,
    },
  },
  ignore: ['**/src-tauri/**'],
  typescript: {
    tsConfig: {
      include: ['../test/**/*'],
    },
  },
})
