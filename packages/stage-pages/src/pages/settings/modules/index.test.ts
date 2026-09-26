import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('module landing page', () => {
  it('lays out the five primary modules as two cards followed by three cards', () => {
    expect(source).toContain('const primaryModuleIds = [\'consciousness\', \'speech\', \'hearing\', \'vision\', \'web-search\']')
    expect(source).toContain(':items="primaryTopRowModules"')
    expect(source).toContain(':columns="{ default: 1, md: 2 }"')
    expect(source).toContain(':items="primaryBottomRowModules"')
    expect(source).toContain(':columns="{ default: 1, md: 3 }"')
  })

  it('keeps all other module entries after the primary five', () => {
    expect(source).toContain('const additionalModules = computed(() => modulesList.value.filter(module => !primaryModuleIds.includes(module.id)))')
    expect(source).toContain(':items="additionalModules"')
    expect(source).toContain('t(\'settings.pages.modules.additional-capabilities\')')
    expect(source).toContain('class="h-full min-h-28"')
  })
})
