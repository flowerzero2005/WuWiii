import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPersonaCardConflicts, syncPersonaCards } from './persona-card-sync'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'owner-a' } },
  cards: new Map<string, { name: string }>(),
  activeCardId: 'default',
  state: new Map<string, unknown>(),
  remote: new Map<string, Array<{ cardId: string, card: { name: string }, revision: number, deletedAt: null }>>(),
  posted: [] as Array<{ owner: string, ids: string[] }>,
  storage: new Map<string, string>(),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({
  getItem: async (key: string) => mocks.state.get(key) ?? null,
  setItem: async (key: string, value: unknown) => { mocks.state.set(key, value) },
}) } }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../stores/modules/airi-card', () => ({ useAiriCardStore: () => ({
  get cards() { return mocks.cards },
  set cards(value: Map<string, { name: string }>) { mocks.cards = value },
  get activeCardId() { return mocks.activeCardId },
  set activeCardId(value: string) { mocks.activeCardId = value },
  initialize() {
    if (!mocks.cards.has('default'))
      mocks.cards.set('default', { name: 'Default' })
  },
}) }))
vi.mock('../stores/character/notebook', () => ({ useCharacterNotebookStore: () => ({}) }))
vi.mock('../database/repos/notebook.repo', () => ({ notebookRepo: {} }))
vi.mock('./auth', () => ({
  SERVER_URL: 'https://example.test',
  getOfficialApiFetch: () => async (url: string, init?: RequestInit) => {
    const owner = mocks.auth.user.id
    const rows = mocks.remote.get(owner) ?? []
    if (url.endsWith('/sync')) {
      const { operations } = JSON.parse(String(init?.body)) as { operations: Array<{ id: string, card?: { name: string } }> }
      mocks.posted.push({ owner, ids: operations.map(item => item.id) })
      for (const operation of operations) {
        if (operation.card)
          rows.push({ cardId: operation.id, card: operation.card, revision: 1, deletedAt: null })
      }
      mocks.remote.set(owner, rows)
      return { ok: true, json: async () => ({ cards: rows, conflicts: [] }) }
    }
    return { ok: true, json: async () => rows }
  },
}))

describe('persona card account sync', () => {
  beforeEach(() => {
    mocks.auth.user.id = 'owner-a'
    mocks.cards = new Map([['default', { name: 'Local' }]])
    mocks.activeCardId = 'default'
    mocks.state.clear()
    mocks.remote.clear()
    mocks.posted.length = 0
    mocks.storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mocks.storage.get(key) ?? null,
      setItem: (key: string, value: string) => { mocks.storage.set(key, value) },
    })
  })

  it('keeps a first-sync collision for user choice without overwriting either version', async () => {
    mocks.remote.set('owner-a', [{ cardId: 'default', card: { name: 'Cloud' }, revision: 2, deletedAt: null }])
    const conflicts = await syncPersonaCards()
    expect(conflicts).toMatchObject([{ id: 'default', local: { name: 'Local' }, remote: { name: 'Cloud' } }])
    expect(mocks.cards.get('default')?.name).toBe('Local')
    expect(mocks.posted).toEqual([])
    expect(await getPersonaCardConflicts()).toHaveLength(1)
  })

  it('does not upload the previous account cards when the user switches accounts', async () => {
    mocks.cards.set('private-a', { name: 'A only' })
    await syncPersonaCards()
    mocks.auth.user.id = 'owner-b'
    await syncPersonaCards()
    expect(mocks.posted.find(item => item.owner === 'owner-b')?.ids).toEqual(['default'])
    expect(mocks.cards.has('private-a')).toBe(false)
    mocks.auth.user.id = 'owner-a'
    await syncPersonaCards()
    expect(mocks.cards.get('private-a')?.name).toBe('A only')
  })
})
