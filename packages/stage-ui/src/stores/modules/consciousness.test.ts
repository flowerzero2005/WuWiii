import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessStore } from './consciousness'

const persistedConsciousnessValues = vi.hoisted(() => new Map<string, unknown>())

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
      getModelsForProvider: vi.fn(() => []),
      getProviderMetadata: vi.fn(() => undefined),
      isLoadingModels: {},
      modelLoadError: {},
    })),
  }
})

describe('consciousness defaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    persistedConsciousnessValues.clear()
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
})
