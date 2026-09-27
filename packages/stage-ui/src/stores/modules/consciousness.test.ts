import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessStore } from './consciousness'

const persistedConsciousnessValues = vi.hoisted(() => new Map<string, unknown>())
const providerModels = vi.hoisted(() => new Map<string, Array<{ id: string, capabilities?: string[] }>>())

vi.mock('@proj-airi/stage-shared/composables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/stage-shared/composables')>()
  const { ref, toValue } = await import('vue')

  return {
    ...actual,
    useLocalStorageManualReset: <T>(key: string, initialValue: T) => {
      const resolvedKey = toValue(key)
      return ref(persistedConsciousnessValues.has(resolvedKey) ? persistedConsciousnessValues.get(resolvedKey) as T : toValue(initialValue))
    },
  }
})

vi.mock('../providers', async () => {
  const { defineStore } = await import('pinia')
  return {
    useProvidersStore: defineStore('providers', () => ({
      fetchModelsForProvider: vi.fn(async () => []),
      getModelsForProvider: vi.fn((providerId: string) => providerModels.get(providerId) ?? []),
      getProviderMetadata: vi.fn(() => undefined),
      providerMetadata: {
        'openai-compatible': { category: 'chat' },
        'official-cloud': { category: 'chat' },
      },
      isLoadingModels: {},
      modelLoadError: {},
    })),
  }
})

describe('consciousness defaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    persistedConsciousnessValues.clear()
    providerModels.clear()
    setActivePinia(createPinia())
  })

  it('repairs an empty consumer selection without opening settings', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedConsciousnessValues.set('settings/consciousness/active-provider', '')
    persistedConsciousnessValues.set('settings/consciousness/active-model', '')

    const store = useConsciousnessStore()

    expect(store.activeProvider).toBe('official-cloud')
    expect(store.activeModel).toBe('airi-default')
    expect(store.configured).toBe(true)
  })

  it('preserves an explicitly selected custom provider', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedConsciousnessValues.set('settings/consciousness/active-provider', 'openai-compatible')
    persistedConsciousnessValues.set('settings/consciousness/active-model', '')

    const store = useConsciousnessStore()

    expect(store.activeProvider).toBe('openai-compatible')
    expect(store.activeModel).toBe('')
  })

  it('accepts a user-declared vision capability for a non-official chat provider', () => {
    const store = useConsciousnessStore()

    store.setModelVisionCapability('openai-compatible', 'local-vlm', true)

    expect(store.modelSupportsVision('openai-compatible', 'local-vlm')).toBe(true)
  })

  it('uses a provider model vision declaration without a local override', () => {
    providerModels.set('anthropic', [{ id: 'claude-vision', capabilities: ['vision'] }])
    const store = useConsciousnessStore()

    expect(store.modelSupportsVision('anthropic', 'claude-vision')).toBe(true)
  })

  it('ignores persisted and new vision overrides for official cloud models', () => {
    persistedConsciousnessValues.set('settings/consciousness/vision-capable-models', {
      'official-cloud': ['airi-default'],
    })
    const store = useConsciousnessStore()

    expect(store.canConfigureModelVision('official-cloud')).toBe(false)
    expect(store.modelSupportsVision('official-cloud', 'airi-default')).toBe(false)

    store.setModelVisionCapability('official-cloud', 'airi-default', true)

    expect(store.modelSupportsVision('official-cloud', 'airi-default')).toBe(false)
  })
})
