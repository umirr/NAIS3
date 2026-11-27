import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// No development gateway is included in the Android bundle.
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  define: { 'import.meta.env.VITE_MOBILE': JSON.stringify('1') },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@capacitor/core': resolve('mobile-host/node_modules/@capacitor/core/dist/index.js')
    }
  },
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve('mobile-host/www'), emptyOutDir: true }
})
