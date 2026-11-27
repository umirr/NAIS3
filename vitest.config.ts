import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@capacitor/core': resolve('mobile-host/node_modules/@capacitor/core')
    }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
