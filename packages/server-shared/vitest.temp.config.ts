import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/types/model-performance.test.ts'] },
})
