import { describe, expect, it, vi } from 'vitest'

import { resolveProviderResourceLabel } from './provider-resource-label'

describe('resolveProviderResourceLabel', () => {
  it('uses a localized public label for a known provider resource', () => {
    const translate = vi.fn(() => 'Wuwiii 默认')
    const hasTranslation = vi.fn(() => true)

    expect(resolveProviderResourceLabel(
      'official-cloud',
      'models',
      'airi-default',
      'AIRI Default',
      translate,
      hasTranslation,
    )).toBe('Wuwiii 默认')
  })

  it('preserves a public catalog name published by the server', () => {
    const translate = vi.fn(() => 'Wuwiii Default')
    const hasTranslation = vi.fn(() => true)

    expect(resolveProviderResourceLabel(
      'official-cloud-speech',
      'voices',
      'airi-default',
      'Wuwiii Gentle Voice',
      translate,
      hasTranslation,
    )).toBe('Wuwiii Gentle Voice')
    expect(translate).not.toHaveBeenCalled()
  })

  it('uses the English fallback key when the current locale has no resource label', () => {
    const translate = vi.fn(() => 'Wuwiii Default')
    const hasTranslation = vi.fn((_key: string, locale?: string) => locale === 'en')

    expect(resolveProviderResourceLabel(
      'official-cloud-speech',
      'voices',
      'airi-default',
      undefined,
      translate,
      hasTranslation,
    )).toBe('Wuwiii Default')
  })

  it('preserves a listed name or custom ID when no public label exists', () => {
    const translate = vi.fn()
    const hasTranslation = vi.fn(() => false)

    expect(resolveProviderResourceLabel('custom', 'models', 'model-id', 'Model name', translate, hasTranslation))
      .toBe('Model name')
    expect(resolveProviderResourceLabel('custom', 'models', 'model-id', undefined, translate, hasTranslation))
      .toBe('model-id')
  })
})
