import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProvidersStore } from './providers'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('store providers runtime validation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('does not run provider validation when the store is created', async () => {
    const store = useProvidersStore()

    await flushMicrotasks()

    expect(store.addedProviders['official-cloud']).toBeUndefined()
    expect(store.configuredProviders['official-cloud']).toBe(false)
  })

  it('runs provider validation when runtime validation is started', async () => {
    const store = useProvidersStore()

    await store.startRuntimeValidation()

    expect(store.addedProviders['official-cloud']).toBe(true)
    expect(store.configuredProviders['official-cloud']).toBe(true)
    expect(store.configuredProviders['official-cloud-speech']).toBe(true)
    expect(store.configuredProviders['official-cloud-transcription']).toBe(true)
    expect(store.configuredProviders['official-cloud-embed']).toBe(true)
    expect(store.configuredProviders['official-cloud-web-search']).toBe(true)
    expect(store.getProviderMetadata('official-cloud-speech').category).toBe('speech')
    expect(store.getProviderMetadata('official-cloud-transcription').category).toBe('transcription')
    expect(store.getProviderMetadata('official-cloud-embed').category).toBe('embed')
    expect(store.getProviderMetadata('official-cloud-web-search').category).toBe('web-search')
  })

  it('stops serving a cached provider before asynchronous disposal finishes', async () => {
    const store = useProvidersStore()
    await store.startRuntimeValidation()

    const firstInstance = await store.getProviderInstance('official-cloud') as { dispose?: () => Promise<void> }
    firstInstance.dispose = () => new Promise(() => {})
    store.providers['official-cloud'] = {
      ...store.providers['official-cloud'],
      apiBaseURL: 'https://example.test',
    }
    await flushMicrotasks()

    const nextInstance = await store.getProviderInstance('official-cloud')
    expect(nextInstance).not.toBe(firstInstance)
  })
})
