import type { NotebookData } from '../../database/repos/notebook.repo'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notebookRepo } from '../../database/repos/notebook.repo'
import { useAiriCardStore } from '../modules/airi-card'
import { countDistinctDiaryEvents, normalizedDiaryEventKey, useCharacterNotebookStore } from './notebook'

const repoMock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../../database/repos/notebook.repo', () => ({
  notebookRepo: repoMock,
}))

vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useAiriCardStore: defineStore('airi-card', () => ({
      activeCardId: ref('default'),
    })),
  }
})

vi.mock('../settings/memory-advanced', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useMemoryAdvancedSettingsStore: defineStore('memory-advanced-settings', () => ({
      isLoaded: ref(true),
      settings: ref({
        enableMultiUser: false,
      }),
    })),
  }
})

vi.mock('../user-identity', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useUserIdentityStore: defineStore('user-identity', () => ({
      currentUserId: ref('default'),
      identifyUser: vi.fn(async () => 'default'),
    })),
  }
})

function notebookData(text: string): NotebookData {
  return {
    entries: [{
      id: text,
      kind: 'note',
      text,
      createdAt: 1,
    }],
    tasks: [],
    version: 1,
  }
}

function deferredNotebookLoad(scopeId: string) {
  let resolve!: (data: NotebookData | null) => void
  const promise = new Promise<NotebookData | null>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve, scopeId }
}

async function flushPromises(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

describe('character notebook store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    repoMock.load.mockReset()
    repoMock.save.mockReset()
    repoMock.save.mockImplementation(async (_scopeId: string, data: NotebookData) => data)
  })

  it('reloads the latest persona-card scope after an in-flight load resolves', async () => {
    const pendingLoads: Array<{
      scopeId: string
      resolve: (data: NotebookData | null) => void
    }> = []

    vi.mocked(notebookRepo.load).mockImplementation((scopeId: string) => {
      return new Promise<NotebookData | null>((resolve) => {
        pendingLoads.push({ scopeId, resolve })
      })
    })

    const airiCardStore = useAiriCardStore()
    const notebookStore = useCharacterNotebookStore()

    await flushPromises(2)
    expect(pendingLoads.map(load => load.scopeId)).toEqual(['default::card:default'])

    airiCardStore.activeCardId = 'side-card'
    const reloadPromise = notebookStore.loadFromStorage()

    pendingLoads[0]?.resolve(notebookData('default-card-note'))
    await vi.waitFor(() => {
      expect(pendingLoads.map(load => load.scopeId)).toEqual([
        'default::card:default',
        'default::card:side-card',
      ])
    })

    pendingLoads[1]?.resolve(notebookData('side-card-note'))
    await reloadPromise

    expect(notebookStore.loadedScopeId).toBe('default::card:side-card')
    expect(notebookStore.entries.map(entry => entry.text)).toEqual(['side-card-note'])
  })

  it('waits for the active notebook scope before saving chat-extracted memories', async () => {
    const pendingLoads: ReturnType<typeof deferredNotebookLoad>[] = []
    vi.mocked(notebookRepo.load).mockImplementation((scopeId: string) => {
      const load = deferredNotebookLoad(scopeId)
      pendingLoads.push(load)
      return load.promise
    })

    const notebookStore = useCharacterNotebookStore()
    await flushPromises(2)

    const addPromise = notebookStore.addMemoryEntryToScope('note', '用户喜欢香菜', {
      scope: { personaCardId: 'default' },
      tags: ['偏好'],
      metadata: { importance: 'low' },
    })
    await flushPromises(2)

    expect(notebookRepo.save).not.toHaveBeenCalled()

    pendingLoads[0]?.resolve(notebookData('旧记忆'))
    const entry = await addPromise

    expect(entry.text).toBe('用户喜欢香菜')
    expect(notebookStore.entries.map(item => item.text)).toEqual(['旧记忆', '用户喜欢香菜'])
    expect(notebookRepo.save).toHaveBeenCalledWith('default::card:default', expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({ text: '旧记忆' }),
        expect.objectContaining({ text: '用户喜欢香菜' }),
      ]),
    }))
  })

  it('adds persona-card scope metadata to new entries', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)

    const airiCardStore = useAiriCardStore()
    airiCardStore.activeCardId = 'miside'

    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    const entry = notebookStore.addNote('用户喜欢雨夜散步', {
      tags: ['偏好'],
      metadata: {
        importance: 'medium',
      },
    })

    expect(entry.metadata).toMatchObject({
      characterId: 'default::card:miside',
      importance: 'medium',
      memoryScope: 'current-persona',
      personaCardId: 'miside',
      userId: 'default',
    })
    expect(notebookStore.entryBelongsToCurrentScope(entry)).toBe(true)
    expect(notebookStore.entryBelongsToCurrentScope({
      ...entry,
      metadata: {
        ...entry.metadata,
        personaCardId: 'other-card',
      },
    })).toBe(false)
  })

  it('keeps shared-by-user memories private to the owning user', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)

    const memorySettings = (await import('../settings/memory-advanced')).useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableMultiUser = true
    const userIdentity = (await import('../user-identity')).useUserIdentityStore()
    userIdentity.currentUserId = 'user-a'
    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    const sharedEntry = notebookStore.addNote('shared user note', {
      metadata: {
        memoryScope: 'shared-by-user',
        userId: 'user-a',
      },
    })

    expect(notebookStore.entryBelongsToMemoryScope(sharedEntry, { userId: 'user-a', personaCardId: 'default' })).toBe(true)
    expect(notebookStore.entryBelongsToMemoryScope(sharedEntry, { userId: 'user-b', personaCardId: 'default' })).toBe(false)
    await expect(notebookStore.getMemoryEntriesForScope({ userId: 'user-b', personaCardId: 'default' })).resolves.toEqual([])
  })

  it('removes entries by source message trace within the current session', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)

    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    const targetEntry = notebookStore.addNote('用户喜欢雨夜散步', {
      metadata: {
        sourceAssistantMessageId: 'assistant-1',
        sourceAssistantMessageIds: ['assistant-1', 'assistant-2'],
        sourceSessionId: 'session-a',
        sourceUserMessageId: 'user-1',
      },
    })
    const otherSessionEntry = notebookStore.addNote('其他会话的同名消息记忆', {
      metadata: {
        sourceAssistantMessageId: 'assistant-2',
        sourceSessionId: 'session-b',
      },
    })

    const removedEntries = notebookStore.removeEntriesBySourceMessage({
      sourceMessageId: 'assistant-2',
      sourceSessionId: 'session-a',
    })

    expect(removedEntries.map(entry => entry.id)).toEqual([targetEntry.id])
    expect(notebookStore.entries.map(entry => entry.id)).toEqual([otherSessionEntry.id])
  })

  it('counts distinct diary events while collapsing punctuation and whitespace variants', () => {
    const greeting = { role: 'user' as const, text: 'Hello,   there!' }
    const greetingVariant = { role: 'user' as const, text: 'hello there' }
    const sameWordsFromCharacter = { role: 'assistant' as const, text: 'hello there' }

    expect(normalizedDiaryEventKey(greeting)).toBe(normalizedDiaryEventKey(greetingVariant))
    expect(countDistinctDiaryEvents([greeting, greetingVariant, sameWordsFromCharacter])).toBe(2)
  })

  it('offers the diary model a decision after either enough turns or distinct events', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)

    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    expect(notebookStore.shouldOfferDiaryDraft({
      turnCount: 20,
      events: [{ role: 'user', text: 'short' }],
      now: 1_000,
    })).toBe(true)

    expect(notebookStore.shouldOfferDiaryDraft({
      turnCount: 1,
      events: Array.from({ length: 8 }, (_, index) => ({ role: 'user' as const, text: `event-${index}` })),
      now: 1_000,
    })).toBe(true)
  })

  it('applies the diary cooldown from the actual local creation time', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 12, 18, 0, 0).getTime()
    try {
      vi.setSystemTime(now - 60 * 60 * 1000)
      const notebookStore = useCharacterNotebookStore()
      await notebookStore.loadFromStorage()
      notebookStore.addDiaryEntry('今天的日记。')

      expect(notebookStore.shouldOfferDiaryDraft({
        turnCount: 20,
        events: [],
        now,
      })).toBe(false)
      notebookStore.cleanup()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('limits confirmed diaries by the device-local calendar day', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 12, 23, 30, 0).getTime()
    try {
      const notebookStore = useCharacterNotebookStore()
      await notebookStore.loadFromStorage()
      vi.setSystemTime(new Date(2026, 8, 12, 0, 30, 0))
      notebookStore.addDiaryEntry('当天第一篇。')
      vi.setSystemTime(new Date(2026, 8, 12, 1, 30, 0))
      notebookStore.addDiaryEntry('当天第二篇。')

      expect(notebookStore.shouldOfferDiaryDraft({
        turnCount: 20,
        events: [],
        now,
      })).toBe(false)
      notebookStore.cleanup()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('serializes an in-flight draft save before persisting its confirmation', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)
    const savedSnapshots: NotebookData[] = []
    let releaseFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    let saveCount = 0
    repoMock.save.mockImplementation(async (_scopeId: string, data: NotebookData) => {
      savedSnapshots.push(structuredClone(data))
      saveCount += 1
      if (saveCount === 1)
        await firstSave
      return data
    })

    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()
    const draft = notebookStore.createDiaryDraft({
      title: 'A quiet afternoon',
      text: 'We watched the rain together.',
      periodStart: 1,
      periodEnd: 2,
      sourceMessageIds: ['message-1'],
      importantEvents: ['rain'],
      preferenceNotes: [],
    })

    const firstSavePromise = notebookStore.saveToStorage()
    await vi.waitFor(() => expect(savedSnapshots).toHaveLength(1))
    const confirmPromise = notebookStore.confirmDiaryDraft(draft.id)
    await flushPromises(2)
    expect(savedSnapshots).toHaveLength(1)

    releaseFirstSave()
    await firstSavePromise
    await confirmPromise

    expect(savedSnapshots[0]?.diaryDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })])
    expect(savedSnapshots.at(-1)?.diaryDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'confirmed' })])
    expect(savedSnapshots.at(-1)?.entries).toEqual([expect.objectContaining({ kind: 'diary', text: draft.text })])
    expect(notebookStore.lastSaveResult).toMatchObject({
      scopeId: 'default::card:default',
      succeeded: true,
    })
    notebookStore.cleanup()
  })

  it('waits for the current scope before confirming a diary draft', async () => {
    const pendingLoad = deferredNotebookLoad('default::card:default')
    vi.mocked(notebookRepo.load).mockReturnValue(pendingLoad.promise)

    const notebookStore = useCharacterNotebookStore()
    const confirmPromise = notebookStore.confirmDiaryDraft('draft-1')
    await flushPromises(2)
    expect(notebookRepo.save).not.toHaveBeenCalled()

    pendingLoad.resolve({
      entries: [],
      tasks: [],
      diaryDrafts: [{
        id: 'draft-1',
        title: 'Loaded draft',
        text: 'The persisted draft is confirmed after loading.',
        periodStart: 1,
        periodEnd: 2,
        sourceMessageIds: [],
        importantEvents: [],
        preferenceNotes: [],
        status: 'draft',
        createdAt: 1,
        updatedAt: 1,
      }],
      version: 4,
    })
    await confirmPromise

    expect(notebookStore.diaryDrafts).toEqual([expect.objectContaining({ id: 'draft-1', status: 'confirmed' })])
    expect(notebookRepo.save).toHaveBeenCalledWith('default::card:default', expect.objectContaining({
      diaryDrafts: [expect.objectContaining({ id: 'draft-1', status: 'confirmed' })],
    }))
    notebookStore.cleanup()
  })

  it('forces the current scope to save after discarding a draft or deleting a diary', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue({
      entries: [{
        id: 'diary-1',
        kind: 'diary',
        text: 'A diary to delete.',
        createdAt: 1,
      }],
      tasks: [],
      diaryDrafts: [{
        id: 'draft-1',
        title: 'A draft to discard',
        text: 'Draft text',
        periodStart: 1,
        periodEnd: 2,
        sourceMessageIds: [],
        importantEvents: [],
        preferenceNotes: [],
        status: 'draft',
        createdAt: 1,
        updatedAt: 1,
      }],
      version: 1,
    })
    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    await notebookStore.discardDiaryDraft('draft-1')
    expect(vi.mocked(notebookRepo.save)).toHaveBeenLastCalledWith('default::card:default', expect.objectContaining({
      diaryDrafts: [expect.objectContaining({ id: 'draft-1', status: 'discarded' })],
    }))

    await notebookStore.removeDiaryEntry('diary-1')
    expect(vi.mocked(notebookRepo.save)).toHaveBeenLastCalledWith('default::card:default', expect.objectContaining({
      entries: [],
    }))
    notebookStore.cleanup()
  })

  it('rejects a failed confirmation and restores the draft instead of claiming success', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue(null)
    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()
    const draft = notebookStore.createDiaryDraft({
      title: 'A draft that must remain reviewable',
      text: 'Storage should confirm this before the draft leaves the review list.',
      periodStart: 1,
      periodEnd: 2,
      sourceMessageIds: [],
      importantEvents: [],
      preferenceNotes: [],
    })
    repoMock.save.mockRejectedValueOnce(new Error('IndexedDB unavailable'))

    await expect(notebookStore.confirmDiaryDraft(draft.id)).rejects.toThrow('IndexedDB unavailable')

    expect(notebookStore.diaryDrafts).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })])
    expect(notebookStore.partitionDiary).toEqual([])
    expect(notebookStore.lastSaveResult).toMatchObject({ succeeded: false })
    notebookStore.cleanup()
  })

  it('restores a draft or diary entry when its explicit discard or deletion cannot be saved', async () => {
    vi.mocked(notebookRepo.load).mockResolvedValue({
      entries: [{ id: 'diary-1', kind: 'diary', text: 'Still saved', createdAt: 1 }],
      tasks: [],
      diaryDrafts: [{
        id: 'draft-1',
        title: 'Still a draft',
        text: 'This draft must stay visible after a failed discard.',
        periodStart: 1,
        periodEnd: 2,
        sourceMessageIds: [],
        importantEvents: [],
        preferenceNotes: [],
        status: 'draft',
        createdAt: 1,
        updatedAt: 1,
      }],
      version: 1,
    })
    const notebookStore = useCharacterNotebookStore()
    await notebookStore.loadFromStorage()

    repoMock.save.mockRejectedValueOnce(new Error('discard write failed'))
    await expect(notebookStore.discardDiaryDraft('draft-1')).rejects.toThrow('discard write failed')
    expect(notebookStore.diaryDrafts[0]).toMatchObject({ id: 'draft-1', status: 'draft' })

    repoMock.save.mockRejectedValueOnce(new Error('delete write failed'))
    await expect(notebookStore.removeDiaryEntry('diary-1')).rejects.toThrow('delete write failed')
    expect(notebookStore.partitionDiary).toEqual([expect.objectContaining({ id: 'diary-1' })])
    notebookStore.cleanup()
  })

  it('does not treat a failed load as an empty scope that may be saved', async () => {
    vi.mocked(notebookRepo.load).mockRejectedValue(new Error('IndexedDB read failed'))
    const notebookStore = useCharacterNotebookStore()
    await flushPromises(2)

    await expect(notebookStore.loadFromStorage()).rejects.toThrow('IndexedDB read failed')
    expect(notebookStore.isLoaded).toBe(false)
    expect(notebookStore.loadedScopeId).toBeNull()
    notebookStore.addNote('must not overwrite unread notebook')
    await flushPromises(2)
    expect(notebookRepo.save).not.toHaveBeenCalled()
    notebookStore.cleanup()
  })

  it('merges stale snapshots without rolling back a confirmed diary or reviving a deleted entry', async () => {
    const draft = {
      id: 'draft-1',
      title: 'Confirmed draft',
      text: 'A persistent diary entry.',
      periodStart: 1,
      periodEnd: 2,
      sourceMessageIds: [],
      importantEvents: [],
      preferenceNotes: [],
      status: 'confirmed' as const,
      createdAt: 1,
      updatedAt: 3,
    }
    const entry = {
      id: 'diary:draft-1',
      kind: 'diary' as const,
      text: draft.text,
      createdAt: 3,
    }
    const staleDraft = { ...draft, status: 'draft' as const, updatedAt: 2 }
    const { mergeNotebookData } = await vi.importActual<typeof import('../../database/repos/notebook.repo')>('../../database/repos/notebook.repo')
    const confirmed = mergeNotebookData({
      entries: [entry],
      tasks: [],
      diaryDrafts: [draft],
      version: 5,
      revision: 5,
    }, {
      entries: [],
      tasks: [],
      diaryDrafts: [staleDraft],
      version: 2,
      revision: 2,
    })

    expect(confirmed.diaryDrafts).toEqual([expect.objectContaining({ status: 'confirmed' })])
    expect(confirmed.entries).toEqual([entry])

    const deleted = mergeNotebookData({
      ...confirmed,
      deletedDiaryEntryIds: [entry.id],
    }, {
      entries: [entry],
      tasks: [],
      diaryDrafts: [staleDraft],
      version: 2,
      revision: 2,
    })
    expect(deleted.entries).toEqual([])
    expect(deleted.deletedDiaryEntryIds).toEqual([entry.id])
  })
})
