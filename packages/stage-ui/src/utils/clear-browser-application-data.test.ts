import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearBrowserApplicationData } from './clear-browser-application-data'

describe('browser application data cleanup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installCommonStorageMocks() {
    const localClear = vi.fn()
    const sessionClear = vi.fn()
    const removeEntry = vi.fn(async () => undefined)
    const deleteCache = vi.fn(async () => true)

    vi.stubGlobal('localStorage', { clear: localClear })
    vi.stubGlobal('sessionStorage', { clear: sessionClear })
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['voice-cache']),
      delete: deleteCache,
    })
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => ({
          async* entries() {
            yield ['model-cache', {}]
          },
          removeEntry,
        })),
      },
    })

    return { deleteCache, localClear, removeEntry, sessionClear }
  }

  it('clears local, session, cache and OPFS storage', async () => {
    const mocks = installCommonStorageMocks()

    await clearBrowserApplicationData({ includeIndexedDB: false })

    expect(mocks.localClear).toHaveBeenCalledOnce()
    expect(mocks.sessionClear).toHaveBeenCalledOnce()
    expect(mocks.deleteCache).toHaveBeenCalledWith('voice-cache')
    expect(mocks.removeEntry).toHaveBeenCalledWith('model-cache', { recursive: true })
  })

  it('waits for every IndexedDB database deletion in web builds', async () => {
    installCommonStorageMocks()
    const deletedDatabases: string[] = []
    vi.stubGlobal('indexedDB', {
      databases: vi.fn(async () => [{ name: 'airi' }, { name: 'localforage' }]),
      deleteDatabase: vi.fn((name: string) => {
        const request: Record<string, (() => void) | null> = {
          onsuccess: null,
          onerror: null,
          onblocked: null,
        }
        queueMicrotask(() => {
          deletedDatabases.push(name)
          request.onsuccess?.()
        })
        return request
      }),
    })

    await clearBrowserApplicationData({ includeIndexedDB: true })

    expect(deletedDatabases).toEqual(['airi', 'localforage'])
  })
})
