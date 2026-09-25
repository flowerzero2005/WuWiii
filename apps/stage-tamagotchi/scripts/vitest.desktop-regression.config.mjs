import Vue from '@vitejs/plugin-vue'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [Vue()],
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/.git/**'],
    include: ['src/**/*.test.ts'],
    isolate: true,
  },
})
