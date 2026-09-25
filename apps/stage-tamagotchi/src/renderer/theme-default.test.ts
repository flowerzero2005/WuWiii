import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useDark, useToggle } = vi.hoisted(() => ({
  useDark: vi.fn(() => ({ value: false })),
  useToggle: vi.fn(),
}))

vi.mock('@vueuse/core', () => ({ useDark, useToggle }))

describe('desktop theme default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('leaves the shared theme default neutral for non-desktop clients', async () => {
    await import('../../../../packages/ui/src/composables/use-theme')

    expect(useDark).toHaveBeenCalledWith({
      disableTransition: false,
    })
  })

  it('migrates desktop auto theme before loading the renderer entrypoint', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
    const migrationIndex = html.indexOf('savedTheme === null || savedTheme === \'auto\'')
    const entrypointIndex = html.indexOf('src="/main.ts"')

    expect(migrationIndex).toBeGreaterThan(-1)
    expect(entrypointIndex).toBeGreaterThan(migrationIndex)
  })
})
