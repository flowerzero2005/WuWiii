import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/stage-tamagotchi',
      'packages/stage-ui',
      'packages/stage-ui-live2d',
      'packages/pipelines-audio',
      'packages/plugin-sdk',
      'packages/vite-plugin-warpdrive',
      'packages/electron-vueuse',
      'packages/server-runtime',
      'scripts/brand',
    ],
  },
})
