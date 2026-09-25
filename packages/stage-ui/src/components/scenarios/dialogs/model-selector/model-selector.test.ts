import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./model-selector.vue', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('./model-selector-dialog.vue', import.meta.url), 'utf8')

describe('model selector card preview', () => {
  it('keeps a single model card bounded and shows the full preview image', () => {
    expect(source).toContain('w-[min(80vw,20rem)] shrink-0 md:min-w-0 md:w-full md:flex')
    expect(source).toContain('aspect-[3/4] w-full shrink-0 px-1 py-2 lg:w-60 md:w-52 sm:w-64')
    expect(source).toContain('object-contain')
    expect(source).not.toContain('rounded-lg object-cover')
  })

  it('does not blur the animated scene behind the selector', () => {
    expect(dialogSource).not.toContain('backdrop-blur')
  })

  it('uses localized feedback for imported display models', () => {
    expect(source).toContain("t('settings.pages.models.model-selector.import_success'")
    expect(source).not.toContain('toast.success(`${model.name} imported.`)')
  })
})
