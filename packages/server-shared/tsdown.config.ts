import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'vision-limits': 'src/vision-limits.ts',
    'types/index': 'src/types/index.ts',
  },
  sourcemap: true,
  unused: true,
  inlineOnly: false,
})
