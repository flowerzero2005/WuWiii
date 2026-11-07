import { beforeEach, describe, expect, it, vi } from 'vitest'

import { syncEnabledCharacterMemories } from './shared-memory-sync'

const mocks = vi.hoisted(() => ({
  auth: { isAuthenticated: true, user: { id: 'owner-a' } },
  cards: new Map([['default', { name: 'Card' }]]),
  requests: [] as string[],
  finishSettings: undefined as undefined | ((value: unknown) => void),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({}) } }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../stores/modules/airi-card', () => ({ useAiriCardStore: () => ({ cards: mocks.cards }) }))
vi.mock('../stores/character/notebook', () => ({ useCharacterNotebookStore: () => ({}) }))
vi.mock('../stores/user-identity', () => ({ useUserIdentityStore: () => ({}) }))
vi.mock('../database/repos/notebook.repo', () => ({ notebookRepo: {} }))
vi.mock('./auth', () => ({
  SERVER_URL: 'https://example.test',
  getOfficialApiFetch: () => async (url: string) => {
    mocks.requests.push(url)
    if (url.endsWith('/settings')) {
      return {
        ok: true,
        json: () => new Promise((resolve) => { mocks.finishSettings = resolve }),
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  },
}))

describe('shared memory account switch', () => {
  beforeEach(() => {
    mocks.auth.user.id = 'owner-a'
    mocks.requests.length = 0
    mocks.finishSettings = undefined
  })

  it('does not continue syncing the previous owner after the settings request', async () => {
    const sync = syncEnabledCharacterMemories()
    await vi.waitFor(() => expect(mocks.finishSettings).toBeTypeOf('function'))
    mocks.auth.user.id = 'owner-b'
    mocks.finishSettings!([])
    await sync
    expect(mocks.requests).toEqual(['https://example.test/api/shared-memory/settings'])
  })
})
