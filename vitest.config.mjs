import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/stage-tamagotchi/vitest.config.mjs',
      'packages/stage-ui/vitest.config.mjs',
      'packages/stage-ui-live2d/vitest.config.mjs',
      'packages/pipelines-audio/vitest.config.mjs',
      'packages/plugin-sdk/vitest.config.mjs',
      'packages/vite-plugin-warpdrive/vitest.config.mjs',
      'packages/electron-vueuse/vitest.config.mjs',
      'packages/server-runtime/vitest.config.mjs',
      'scripts/brand/vitest.config.mjs',
    ],
  },
})
