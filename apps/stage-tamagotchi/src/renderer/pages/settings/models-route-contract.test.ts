import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const modelPageSource = readFileSync(new URL('../../../../../../packages/stage-pages/src/pages/settings/models/index.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const desktopTypedRoutesSource = readFileSync(new URL('../../typed-router.d.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('desktop models route root contract', () => {
  it('maps the desktop settings route to the shared models page', () => {
    expect(desktopTypedRoutesSource).toMatch(/'\.\.\/\.\.\/packages\/stage-pages\/src\/pages\/settings\/models\/index\.vue': \{\s+routes:\s+\| '\/settings\/models\/'/)
  })

  it('keeps the route probe on an unconditional, non-collapsing page root', () => {
    const templateRootOpeningTag = modelPageSource.match(/<template>\s*(<div\b[^>]*>)/)?.[1]
    const pageClassSource = modelPageSource.match(/const pageClass = \[([\s\S]*?)\n\]/)?.[1]
    const modelSettingsOpeningTag = modelPageSource.match(/<ModelSettings\b[^>]*>/)?.[0]
    const minimumHeightPx = Number(pageClassSource?.match(/min-h-\[(\d+)px\]/)?.[1])

    expect(templateRootOpeningTag).toContain('data-airi-runtime-route="/settings/models"')
    expect(templateRootOpeningTag).toContain(':class="pageClass"')
    expect(templateRootOpeningTag).not.toMatch(/\bv-(?:if|else-if|else|show)\b/)
    expect(minimumHeightPx).toBeGreaterThan(128)
    expect(pageClassSource).not.toContain('min-h-0')
    expect(modelSettingsOpeningTag).not.toContain('data-airi-runtime-route')
  })
})
