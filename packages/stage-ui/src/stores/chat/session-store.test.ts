import type { ChatSessionRecord, ChatSessionsIndex } from '../../types/chat-session'
import type { GroupRoomScriptState } from './group-script'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMemoryShortTermSettingsStore } from '../settings/memory-short-term'
import { DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, parseGroupRoomScriptState } from './group-script'
import { isSessionMemoryWorkCancelled } from './session-memory-lifecycle'
import { useChatSessionStore } from './session-store'

vi.mock('./session-record-lock', () => {
  const queues = new Map<string, Promise<unknown>>()
  const lock = (key: string, task: () => Promise<unknown>) => {
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    const settled = result.catch(() => undefined)
    queues.set(key, settled)
    void settled.then(() => {
      if (queues.get(key) === settled)
        queues.delete(key)
    })
    return result
  }
  return {
    withSessionRecordLock: (sessionId: string, task: () => Promise<unknown>) => lock(`session:${sessionId}`, task),
    withUserSessionIndexLock: (userId: string, task: () => Promise<unknown>) => lock(`index:${userId}`, task),
    withIdleSession: (sessionId: string, task: () => Promise<unknown>) => lock(`idle:${sessionId}`, task),
  }
})

const mocks = vi.hoisted(() => ({
  getIndex: vi.fn(),
  getCardRuntime: vi.fn(),
  getSession: vi.fn(),
  listSessionIds: vi.fn().mockResolvedValue([]),
  isAuthenticated: false,
  authUserId: 'user-1',
  postSync: vi.fn(),
  saveIndex: vi.fn(),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteNoteForMessage: vi.fn().mockResolvedValue(undefined),
  deleteNotesForSession: vi.fn().mockResolvedValue(undefined),
  indexes: new Map<string, ChatSessionsIndex>(),
  waitUntilReady: vi.fn(async () => undefined),
}))

vi.mock('../../composables/api', () => ({
  client: {
    api: {
      chats: {
        sync: {
          $post: mocks.postSync,
        },
      },
    },
  },
}))

vi.mock('../../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    deleteSession: mocks.deleteSession,
    getIndex: mocks.getIndex,
    getSession: mocks.getSession,
    listSessionIds: mocks.listSessionIds,
    saveIndex: mocks.saveIndex,
    saveSession: mocks.saveSession,
  },
}))

vi.mock('../auth', async () => {
  const { defineStore } = await import('pinia')
  const { computed } = await import('vue')
  return {
    useAuthStore: defineStore('auth', () => ({
      isAuthenticated: computed(() => mocks.isAuthenticated),
      userId: computed(() => mocks.authUserId),
      waitUntilReady: mocks.waitUntilReady,
    })),
  }
})

vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return {
    useAiriCardStore: defineStore('airi-card', () => ({
      activeCardId: ref('character-1'),
      getCard: vi.fn(),
      getCardRuntime: mocks.getCardRuntime,
      systemPrompt: ref('active character prompt'),
    })),
  }
})

vi.mock('../modules/persona-package', () => ({
  getPersonaCardInitialGreeting: vi.fn(),
}))

vi.mock('./conversation-initializer', () => ({ resetConversationInitialization: vi.fn() }))

vi.mock('../settings/memory-advanced', async () => {
  const { defineStore } = await import('pinia')
  const { reactive } = await import('vue')
  return {
    useMemoryAdvancedSettingsStore: defineStore('memory-advanced-settings', () => ({
      settings: reactive({ enableMultiUser: false }),
    })),
  }
})

vi.mock('../user-identity', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return {
    useUserIdentityStore: defineStore('user-identity', () => ({
      currentUserId: ref('default'),
      identifyUser: vi.fn().mockResolvedValue('default'),
    })),
  }
})

vi.mock('./inner-voice-notes', () => ({
  useAssistantInnerVoiceNoteStore: () => ({
    deleteNotesForSession: mocks.deleteNotesForSession,
    deleteNoteForMessage: mocks.deleteNoteForMessage,
  }),
}))

beforeEach(() => {
  // Each test supplies explicit cross-window delivery when needed. Native
  // Node channels outlive Pinia instances and leak events into later tests.
  vi.stubGlobal('BroadcastChannel', class {
    onmessage?: (event: MessageEvent) => void
    postMessage() {}
  })
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('chat session sync conflicts', () => {
  const records = new Map<string, ChatSessionRecord>()

  beforeEach(() => {
    mocks.authUserId = 'user-1'
    setActivePinia(createPinia())
    records.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated = false
    mocks.waitUntilReady.mockResolvedValue(undefined)

    mocks.indexes.clear()
    mocks.getIndex.mockImplementation(async (userId: string) => structuredClone(mocks.indexes.get(userId) ?? null))
    mocks.getCardRuntime.mockImplementation((characterId: string) => ({
      characterId,
      displayName: characterId,
      systemPrompt: `${characterId} private prompt`,
    }))
    mocks.getSession.mockImplementation(async (sessionId: string) => records.get(sessionId) ?? null)
    mocks.saveIndex.mockImplementation(async (value: ChatSessionsIndex) => {
      mocks.indexes.set(value.userId, structuredClone(value))
    })
    mocks.deleteSession.mockImplementation(async (sessionId: string) => records.delete(sessionId))
    mocks.saveSession.mockImplementation(async (sessionId: string, record: ChatSessionRecord) => {
      records.set(sessionId, structuredClone(record))
    })
    mocks.postSync.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('reuses an empty direct conversation and keeps previous history when starting another', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const first = store.activeSessionId
    expect(await store.createDirectSession('character-1')).toBe(first)
    store.getSessionMessages(first).push({ id: 'first-user', role: 'user', content: 'My original conversation' })
    await store.persistSessionMessages(first, { immediate: true })
    const next = await store.createDirectSession('character-1')
    expect(next).not.toBe(first)
    expect(await store.createDirectSession('character-1')).toBe(next)
    expect(store.getSessionMessages(next).some(message => message.role === 'user')).toBe(false)
    expect(records.get(first)?.messages.some(message => message.id === 'first-user')).toBe(true)
    expect(store.directSessions.map(meta => meta.sessionId)).toEqual(expect.arrayContaining([first, next]))
    expect(records.get(first)?.meta.title).toBe('My original conversation')
  })

  async function createStarHistory() {
    const store = useChatSessionStore()
    await store.initialize()
    const sessionId = store.activeSessionId
    store.setSessionMessages(sessionId, [
      { id: 'sys', role: 'system', content: 'system' },
      { id: 'old', role: 'user', content: 'keep my memory' },
      { id: 'middle', role: 'user', content: 'clean this' },
      { id: 'sys-late', role: 'system', content: 'second system' },
      { id: 'last', role: 'user', content: 'latest' },
    ])
    await store.persistSessionMessages(sessionId, { immediate: true })
    return { store, sessionId }
  }

  it('starts from a valid record when its indexed metadata is incomplete', async () => {
    const { sessionId } = await createStarHistory()
    const persisted = structuredClone(mocks.indexes.get('user-1')!)
    persisted.characters['character-1'].sessions[sessionId] = undefined as unknown as ChatSessionRecord['meta']
    mocks.indexes.set('user-1', persisted)
    mocks.listSessionIds.mockResolvedValueOnce([sessionId])

    const restarted = useChatSessionStore(createPinia())
    await restarted.initialize()

    expect(restarted.activeSessionId).toBe(sessionId)
    expect(restarted.getSessionMessages(sessionId).some(message => message.id === 'old')).toBe(true)
    expect(mocks.indexes.get('user-1')?.characters['character-1'].sessions[sessionId]).toEqual(records.get(sessionId)?.meta)
  })

  it('repairs a record missing metadata from its valid index without losing messages', async () => {
    const { sessionId } = await createStarHistory()
    const original = records.get(sessionId)!
    records.set(sessionId, { ...original, meta: undefined as unknown as ChatSessionRecord['meta'] })

    const restarted = useChatSessionStore(createPinia())
    await restarted.initialize()

    expect(restarted.activeSessionId).toBe(sessionId)
    expect(records.get(sessionId)?.meta.sessionId).toBe(sessionId)
    expect(records.get(sessionId)?.messages.map(message => message.id)).toEqual(original.messages.map(message => message.id))
  })

  it('keeps an unreadable record intact and starts a usable conversation', async () => {
    const { sessionId } = await createStarHistory()
    const original = records.get(sessionId)!
    records.set(sessionId, { ...original, meta: undefined as unknown as ChatSessionRecord['meta'] })
    const persisted = structuredClone(mocks.indexes.get('user-1')!)
    persisted.characters['character-1'].sessions[sessionId] = undefined as unknown as ChatSessionRecord['meta']
    mocks.indexes.set('user-1', persisted)
    mocks.listSessionIds.mockResolvedValueOnce([sessionId])

    const restarted = useChatSessionStore(createPinia())
    await restarted.initialize()

    expect(restarted.activeSessionId).not.toBe(sessionId)
    expect(records.get(sessionId)?.messages).toEqual(original.messages)
    expect(restarted.getSessionMeta(restarted.activeSessionId)).toBeDefined()
  })

  it('persists independent stars and explicit unstars through stale writes, exports and restarts', async () => {
    const { store, sessionId } = await createStarHistory()
    const other = useChatSessionStore(createPinia())
    await other.initialize()
    await store.setMessageStarred(sessionId, 'old', true)
    expect((await store.readSessionForInspection(sessionId))?.messageStars?.old.starred).toBe(true)
    await other.setMessageStarred(sessionId, 'old', false)
    const revision = records.get(sessionId)!.meta.messageStarsRevision
    await store.persistSessionMessages(sessionId, { immediate: true })
    expect(records.get(sessionId)!.messageStars?.old).toEqual({ starred: false, revision })
    expect(records.get(sessionId)!.meta.starred).not.toBe(true)
    const exported = await store.exportSessions()
    expect(exported.sessions[sessionId].messageStars?.old.starred).toBe(false)
    const restarted = useChatSessionStore(createPinia())
    await restarted.importSessions(exported)
    expect((await restarted.readSessionForInspection(sessionId))?.messageStars?.old.starred).toBe(false)
    expect(records.get(sessionId)!.messages.map(message => message.id)).toEqual(['sys', 'old', 'middle', 'sys-late', 'last'])
  })

  it('keeps stars and every system message in chronological order and deletes only removed notes', async () => {
    const { store, sessionId } = await createStarHistory()
    await store.setMessageStarred(sessionId, 'old', true)
    mocks.deleteNoteForMessage.mockClear()
    expect(await store.retainRecentMessages(sessionId, 1)).toEqual({
      removedMessageIds: ['middle'],
      retainedMessageIds: ['sys', 'old', 'sys-late', 'last'],
    })
    expect(records.get(sessionId)!.messages.map(message => message.id)).toEqual(['sys', 'old', 'sys-late', 'last'])
    expect(mocks.deleteNoteForMessage).toHaveBeenCalledTimes(1)
    expect(mocks.deleteNoteForMessage).toHaveBeenCalledWith(sessionId, 'middle')
  })

  it('ignores a delayed starred broadcast after explicit unstar and omits stars from remote message payloads', async () => {
    let channel: { onmessage?: (event: MessageEvent) => void } | undefined
    vi.stubGlobal('BroadcastChannel', class {
      onmessage?: (event: MessageEvent) => void
      constructor() { channel = this }
      postMessage() {}
    })
    mocks.isAuthenticated = true
    const { store, sessionId } = await createStarHistory()
    await store.setMessageStarred(sessionId, 'old', true)
    const stale = structuredClone(records.get(sessionId)!)
    await store.setMessageStarred(sessionId, 'old', false)
    channel?.onmessage?.({ data: {
      type: 'chat-session-updated',
      sessionId,
      userId: 'user-1',
      characterId: stale.meta.characterId,
      meta: { ...stale.meta, updatedAt: stale.meta.updatedAt + 1000 },
      messages: stale.messages,
    } } as MessageEvent)
    await store.persistSessionMessages(sessionId, { immediate: true })
    expect(store.getSessionMeta(sessionId)?.messageStarsRevision).toBe(2)
    expect(records.get(sessionId)!.messageStars?.old).toEqual({ starred: false, revision: 2 })
    await vi.waitFor(() => expect(mocks.postSync).toHaveBeenCalled())
    const payload = mocks.postSync.mock.calls.at(-1)?.[0]
    expect(JSON.stringify(payload)).not.toContain('messageStars')
    expect(JSON.stringify(payload)).not.toContain('starred')
  })

  it('prunes obsolete star revisions on explicit clear and does not recreate them from stale history', async () => {
    const { store, sessionId } = await createStarHistory()
    const stale = useChatSessionStore(createPinia())
    await stale.initialize()
    await store.setMessageStarred(sessionId, 'old', true)
    await store.setMessageStarred(sessionId, 'middle', false)
    await store.cleanupMessages(sessionId, { expectedMessageStarsRevision: 2 })
    expect(records.get(sessionId)!.messageStars).toEqual({})
    expect(records.get(sessionId)!.meta.messageStarsRevision).toBe(3)
    await stale.persistSessionMessages(sessionId, { immediate: true })
    expect(records.get(sessionId)!.messageStars).toEqual({})
    expect(records.get(sessionId)!.messages.some(message => message.id === 'old')).toBe(false)
  })

  it('keeps history and notes when cleanup cannot save the replacement', async () => {
    const { store, sessionId } = await createStarHistory()
    const before = structuredClone(records.get(sessionId)!)
    // A cold inspection has no pending history flush ahead of the mutation.
    const cold = useChatSessionStore(createPinia())
    await cold.initializeForInspection()
    mocks.saveSession.mockRejectedValueOnce(new Error('quota'))
    mocks.deleteNoteForMessage.mockClear()
    await expect(cold.retainRecentMessages(sessionId, 1)).rejects.toThrow('quota')
    expect(records.get(sessionId)).toEqual(before)
    expect(mocks.deleteNoteForMessage).not.toHaveBeenCalled()
    expect(store.getSessionMessages(sessionId).some(message => message.id === 'old')).toBe(true)
  })

  it('cleans automatically only above the unstarred limit, keeps the latest at limit one and is idempotent', async () => {
    const { store, sessionId } = await createStarHistory()
    const settings = useMemoryShortTermSettingsStore()
    expect(await store.autoCleanupSession(sessionId)).toBeUndefined()
    await store.setMessageStarred(sessionId, 'old', true)
    settings.settings.autoCleanupEnabled = true
    settings.setAutoCleanupLimit(1)
    expect((await store.autoCleanupSession(sessionId))?.removedMessageIds).toEqual(['middle'])
    const revision = records.get(sessionId)!.meta.historyRevision
    expect((await store.autoCleanupSession(sessionId))?.removedMessageIds).toEqual([])
    expect(records.get(sessionId)!.meta.historyRevision).toBe(revision)
    expect(records.get(sessionId)!.messages.map(message => message.id)).toEqual(['sys', 'old', 'sys-late', 'last'])
  })

  it('requires renewed destructive confirmation after stars change and clears a confirmed favorite', async () => {
    const { store, sessionId } = await createStarHistory()
    await store.setMessageStarred(sessionId, 'old', true)
    await expect(store.cleanupMessages(sessionId, { expectedMessageStarsRevision: 0 })).rejects.toThrow('Message stars changed')
    await expect(store.deleteSession(sessionId, { expectedMessageStarsRevision: 0 })).rejects.toThrow('Message stars changed')
    expect(records.get(sessionId)!.messages.some(message => message.id === 'old')).toBe(true)
    const revision = records.get(sessionId)!.meta.messageStarsRevision
    expect((await store.cleanupMessages(sessionId, { expectedMessageStarsRevision: revision }))?.removedMessageIds).toContain('old')
  })

  it('does not clear caches, cancel memory or delete notes if record deletion fails', async () => {
    const { store, sessionId } = await createStarHistory()
    const deleted = vi.fn()
    store.onSessionDeleted(deleted)
    const generation = store.getSessionGeneration(sessionId)
    mocks.deleteNotesForSession.mockClear()
    mocks.deleteSession.mockRejectedValueOnce(new Error('record unavailable'))
    await expect(store.deleteSession(sessionId)).rejects.toThrow('record unavailable')
    expect(store.getSessionMeta(sessionId)).toBeDefined()
    expect(store.getSessionGeneration(sessionId)).toBe(generation)
    expect(records.has(sessionId)).toBe(true)
    expect(isSessionMemoryWorkCancelled(sessionId)).toBe(false)
    expect(deleted).not.toHaveBeenCalled()
    expect(mocks.deleteNotesForSession).not.toHaveBeenCalled()
    await store.persistSessionMessages(sessionId, { immediate: true })
    expect(records.get(sessionId)!.messages.some(message => message.id === 'old')).toBe(true)
  })

  it.each([false, true])('keeps deletion committed when durable cancellation fails (index also fails: %s)', async (indexFails) => {
    const { store, sessionId } = await createStarHistory()
    const other = useChatSessionStore(createPinia())
    await other.initialize()
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    if (indexFails)
      mocks.saveIndex.mockRejectedValue(new Error('index unavailable'))
    await expect(store.deleteSession(sessionId)).resolves.toBe(true)
    expect(records.has(sessionId)).toBe(false)
    expect(store.getSessionMeta(sessionId)).toBeUndefined()
    expect(isSessionMemoryWorkCancelled(sessionId)).toBe(true)
    await other.persistSessionMessages(sessionId, { immediate: true })
    expect(records.has(sessionId)).toBe(false)
  })

  it('uses stable legacy IDs for repeated inspection and isolates star writes by owner', async () => {
    const { store, sessionId } = await createStarHistory()
    records.get(sessionId)!.messages = [{ role: 'user', content: 'legacy' }]
    const first = await store.readSessionForInspection(sessionId)
    const second = await store.readSessionForInspection(sessionId)
    expect(first!.messages[0].id).toBe(second!.messages[0].id)
    await store.setMessageStarred(sessionId, first!.messages[0].id!, true)
    expect(records.get(sessionId)!.messageStars?.[first!.messages[0].id!].starred).toBe(true)
    const otherPinia = createPinia()
    mocks.authUserId = 'user-2'
    const other = useChatSessionStore(otherPinia)
    await other.initializeForInspection()
    expect(await other.readSessionForInspection(sessionId)).toBeUndefined()
    await expect(other.setMessageStarred(sessionId, first!.messages[0].id!, false)).rejects.toThrow('no longer available')
  })

  it('starts fresh when an existing conversation only has proactive assistant content', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const original = store.activeSessionId
    store.getSessionMessages(original).push({
      id: 'proactive-greeting',
      role: 'assistant',
      content: 'Welcome back.',
      slices: [],
      tool_results: [],
    })
    await store.persistSessionMessages(original, { immediate: true })
    const next = await store.createDirectSession('character-1')
    expect(next).not.toBe(original)
    expect(store.getSessionMessages(next).every(message => message.role === 'system')).toBe(true)
    expect(records.get(original)?.messages.some(message => message.id === 'proactive-greeting')).toBe(true)
  })

  it('does not reuse a shell with unsaved assistant content or an active stream', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const original = store.activeSessionId
    store.getSessionMessages(original).push({
      id: 'unsaved-assistant',
      role: 'assistant',
      content: 'A draft reply.',
      slices: [],
      tool_results: [],
    })
    const next = await store.createDirectSession('character-1')
    expect(next).not.toBe(original)
    expect(store.getSessionMessages(original).some(message => message.id === 'unsaved-assistant')).toBe(true)
    const stream = (await import('./stream-store')).useChatStreamStore()
    stream.beginStream(next)
    const third = await store.createDirectSession('character-1')
    expect(third).not.toBe(next)
    expect(stream.streamingSessionId).toBe(next)
  })

  it('inspects cold history without selecting it or mutating its prompt', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const original = store.activeSessionId
    const other = await store.createDirectSession('character-2')
    await store.activateDirectSession(original)
    const before = structuredClone(records.get(other))
    mocks.saveSession.mockClear()
    const snapshot = await store.readSessionForInspection(other)
    expect(store.activeSessionId).toBe(original)
    expect(mocks.saveSession).not.toHaveBeenCalled()
    expect(snapshot).toEqual(before)
    snapshot!.messages.length = 0
    expect(records.get(other)).toEqual(before)
  })

  it('activates the historical persona without changing the global stage card', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const card = (await import('../modules/airi-card')).useAiriCardStore()
    const other = await store.createDirectSession('character-2')
    await store.activateDirectSession(other)
    expect(card.activeCardId).toBe('character-1')
    expect(store.getSessionMeta(store.activeSessionId)?.characterId).toBe('character-2')
    expect(store.getSessionMessages(other)[0].content).toContain('character-2 private prompt')
  })

  it('preserves a manual conversation title when a stale window persists a message', async () => {
    const first = useChatSessionStore()
    await first.initialize()
    const sessionId = first.activeSessionId
    const other = useChatSessionStore(createPinia())
    await other.initialize()
    await first.renameDirectSession(sessionId, 'A lasting title')
    other.getSessionMessages(sessionId).push({ id: 'stale-user', role: 'user', content: 'A different auto title' })
    await other.persistSessionMessages(sessionId, { immediate: true })
    expect(records.get(sessionId)?.meta.title).toBe('A lasting title')
    const capturedGeneration = first.getSessionGeneration(sessionId)
    await first.deleteSession(sessionId)
    expect(first.getSessionGeneration(sessionId)).toBeGreaterThan(capturedGeneration)
    other.setSessionMessages(sessionId, [{ id: 'late-user', role: 'user', content: 'Late completion' }])
    await other.persistSessionMessages(sessionId, { immediate: true })
    expect(records.has(sessionId)).toBe(false)
  })

  it('assigns new message ids when forking a session', async () => {
    const store = useChatSessionStore()
    store.setSessionMessages('parent-session', [
      { id: 'parent-system', role: 'system', content: 'system', createdAt: 1 },
      { id: 'parent-user', role: 'user', content: 'hello', createdAt: 2 },
    ])

    const forkId = await store.forkSession({ fromSessionId: 'parent-session' })
    const forkMessages = store.getSessionMessages(forkId)

    expect(forkMessages.map(message => message.role)).toEqual(['system', 'user'])
    expect(forkMessages[1]?.content).toBe('hello')
    expect(forkMessages.map(message => message.id)).not.toContain('parent-system')
    expect(forkMessages.map(message => message.id)).not.toContain('parent-user')
    expect(new Set(forkMessages.map(message => message.id)).size).toBe(forkMessages.length)
  })

  it('uses the target session card prompt when another card is active', async () => {
    const store = useChatSessionStore()
    const airiCardStore = (await import('../modules/airi-card')).useAiriCardStore()
    const targetSessionId = await store.selectOrCreateSessionForCharacter('character-b')

    airiCardStore.activeCardId = 'character-a'
    store.setSessionMessages(targetSessionId, [
      { id: 'wrong-system', role: 'system', content: 'character-a private prompt', createdAt: 1 },
    ])
    const targetPrompt = store.ensureSession(targetSessionId)

    expect(targetPrompt).toContain('character-b private prompt')
    expect(store.getSessionMessages(targetSessionId)[0]?.content).toContain('character-b private prompt')
    expect(store.getSessionMessages(targetSessionId)[0]?.content).not.toContain('character-a private prompt')

    await store.cleanupMessages(targetSessionId)
    expect(store.getSessionMessages(targetSessionId)[0]?.content).toContain('character-b private prompt')
  })

  it('waits for the initial auth scope before loading chat history', async () => {
    let resolveAuth!: (value: undefined) => void
    mocks.waitUntilReady.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      resolveAuth = resolve
    }))
    const store = useChatSessionStore()

    const initialization = store.initialize()
    await Promise.resolve()
    expect(mocks.getIndex).not.toHaveBeenCalled()
    expect(store.messages).toEqual([])

    resolveAuth(undefined)
    await initialization

    expect(mocks.getIndex).toHaveBeenCalledWith('user-1')
    expect(store.isReady).toBe(true)
  })

  it('repairs an index without characters before creating the default session', async () => {
    mocks.getIndex.mockResolvedValueOnce({ userId: 'user-1' } as unknown as ChatSessionsIndex)

    const store = useChatSessionStore()
    await expect(store.initialize()).resolves.toBeUndefined()

    expect(store.isReady).toBe(true)
    expect(mocks.saveIndex).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      characters: expect.objectContaining({
        'character-1': expect.any(Object),
      }),
    }))
  })

  it('reports the concrete remote 409 response instead of swallowing it', async () => {
    mocks.isAuthenticated = true
    mocks.postSync.mockResolvedValue(new Response(
      JSON.stringify({ error: 'Message already belongs to another chat' }),
      { status: 409 },
    ))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useChatSessionStore()
    store.setSessionMessages('parent-session', [
      { id: 'parent-user', role: 'user', content: 'hello', createdAt: 1 },
    ])

    await store.forkSession({ fromSessionId: 'parent-session' })

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'Failed to sync chat session',
        expect.objectContaining({
          message: expect.stringContaining('HTTP 409'),
        }),
      )
      expect(warn).toHaveBeenCalledWith(
        'Failed to sync chat session',
        expect.objectContaining({
          message: expect.stringContaining('Message already belongs to another chat'),
        }),
      )
    })
  })

  it('additively refreshes persisted sessions without replacing the active draft', async () => {
    const meta = {
      sessionId: 'session-1',
      userId: 'user-1',
      characterId: 'character-1',
      kind: 'direct' as const,
      createdAt: 1,
      updatedAt: 10,
    }
    mocks.getIndex.mockResolvedValue({
      userId: 'user-1',
      characters: {
        'character-1': {
          activeSessionId: 'session-1',
          sessions: { 'session-1': meta },
        },
      },
    })
    records.set('session-1', {
      meta,
      messages: [
        { id: 'system', role: 'system', content: 'character-1 private prompt', createdAt: 1 },
        { id: 'draft', role: 'assistant', content: 'persisted partial', createdAt: 2, slices: [], tool_results: [] },
      ],
    })
    const store = useChatSessionStore()
    await store.initialize()
    store.setSessionMessages('session-1', [
      { id: 'system', role: 'system', content: 'character-1 private prompt', createdAt: 1 },
      { id: 'draft', role: 'assistant', content: 'live voice draft', createdAt: 2, slices: [], tool_results: [] },
    ])
    const generation = store.getSessionGenerationValue('session-1')

    records.set('session-1', {
      meta: { ...meta, updatedAt: 20 },
      messages: [
        { id: 'system', role: 'system', content: 'character-1 private prompt', createdAt: 1 },
        { id: 'draft', role: 'assistant', content: 'persisted partial', createdAt: 2, slices: [], tool_results: [] },
        { id: 'remote', role: 'user', content: 'message from another window', createdAt: 3 },
      ],
    })

    await store.refreshFromPersistence()

    expect(store.activeSessionId).toBe('session-1')
    expect(store.getSessionGenerationValue('session-1')).toBe(generation)
    expect(store.getSessionMessages('session-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'draft', content: 'live voice draft' }),
      expect.objectContaining({ id: 'remote', content: 'message from another window' }),
    ]))
  })
})

function createRoomScriptState(characterIds = ['character-1', 'character-2'], title = 'Night shift'): GroupRoomScriptState {
  const slots = characterIds.map((_characterId, index) => ({
    slotId: `role-${index + 1}`,
    name: `Role ${index + 1}`,
    description: `Public role ${index + 1}`,
  }))
  return {
    templateSnapshot: {
      format: 'airi-group-script:v1',
      id: `script-${characterIds.length}`,
      title,
      rules: ['Stay in the room scene.'],
      slots,
      relationships: [],
      createdAt: 1,
      updatedAt: 1,
    },
    roleBindings: Object.fromEntries(slots.map((slot, index) => [slot.slotId, characterIds[index]!])),
    narrationSettings: {
      enabled: false,
      speechEnabled: false,
    },
  }
}

describe('group room script persistence', () => {
  const records = new Map<string, ChatSessionRecord>()

  beforeEach(() => {
    setActivePinia(createPinia())
    records.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated = false
    mocks.authUserId = 'user-1'
    mocks.waitUntilReady.mockResolvedValue(undefined)
    mocks.indexes.clear()
    mocks.getIndex.mockImplementation(async (userId: string) => structuredClone(mocks.indexes.get(userId) ?? null))
    mocks.getCardRuntime.mockImplementation((characterId: string) => ({
      characterId,
      displayName: characterId,
      systemPrompt: `${characterId} private prompt`,
    }))
    mocks.getSession.mockImplementation(async (sessionId: string) => records.get(sessionId) ?? null)
    mocks.saveIndex.mockImplementation(async (value: ChatSessionsIndex) => {
      mocks.indexes.set(value.userId, structuredClone(value))
    })
    mocks.deleteSession.mockImplementation(async (sessionId: string) => records.delete(sessionId))
    mocks.saveSession.mockImplementation(async (sessionId: string, record: ChatSessionRecord) => {
      records.set(sessionId, structuredClone(record))
    })
    mocks.postSync.mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function createRoom() {
    const store = useChatSessionStore()
    await store.initialize()
    const sessionId = await store.createGroupSession([
      { characterId: 'character-1', displayName: 'One' },
      { characterId: 'character-2', displayName: 'Two' },
    ], 'Room')
    return { sessionId, store }
  }

  it('preserves revisions from concurrent different-session writes in independent windows', async () => {
    const first = await createRoom()
    const second = await createRoom()
    await first.store.updateGroupRoomScript(first.sessionId, chapterState())
    await second.store.updateGroupRoomScript(second.sessionId, chapterState())
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(second.sessionId)
    await Promise.all([
      first.store.updateGroupRoomScript(first.sessionId, chapterState(), 1),
      otherWindow.updateGroupRoomScript(second.sessionId, chapterState(), 1),
    ])
    const durable = mocks.indexes.get('user-1')!
    expect(durable.characters.group.sessions[first.sessionId].roomScriptRevision).toBe(2)
    expect(durable.characters.group.sessions[second.sessionId].roomScriptRevision).toBe(2)
  })

  it('retains explicit inserts from two stale independently initialized windows', async () => {
    const first = useChatSessionStore()
    await first.initialize()
    const second = useChatSessionStore(createPinia())
    await second.initialize()
    const participants = [{ characterId: 'character-1', displayName: 'One' }]
    const [left, right] = await Promise.all([first.createGroupSession(participants, 'Left'), second.createGroupSession(participants, 'Right')])
    expect(Object.keys(mocks.indexes.get('user-1')!.characters.group.sessions).sort()).toEqual([left, right].sort())
  })

  it('does not resurrect a deleted session or active selection through an old window save', async () => {
    const { sessionId, store } = await createRoom()
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(sessionId)
    await store.deleteSession(sessionId)
    otherWindow.setActiveSession(sessionId)
    otherWindow.getSessionMessages(sessionId).push({ id: 'stale-message', role: 'user', content: 'old draft' })
    await otherWindow.persistSessionMessages(sessionId, { immediate: true })
    expect(mocks.indexes.get('user-1')!.characters.group?.sessions[sessionId]).toBeUndefined()
    expect(mocks.indexes.get('user-1')!.characters.group?.activeSessionId).not.toBe(sessionId)
    expect(records.has(sessionId)).toBe(false)
    expect(otherWindow.getSessionMeta(sessionId)).toBeUndefined()
    expect(otherWindow.activeSessionId).not.toBe(sessionId)
  })

  it('removes stale navigation metadata when an old window selects a deleted session without saving messages', async () => {
    const { sessionId, store } = await createRoom()
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(sessionId)
    await store.deleteSession(sessionId)
    otherWindow.setActiveSession(sessionId)
    await vi.waitFor(() => expect(otherWindow.getSessionMeta(sessionId)).toBeUndefined())
    expect(otherWindow.groupSessions.some(session => session.sessionId === sessionId)).toBe(false)
    expect(otherWindow.activeSessionId).not.toBe(sessionId)
  })

  it('reloads a partially saved chapter and repairs its index without repeating narration', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    const messagesBefore = structuredClone(store.getSessionMessages(sessionId).map(message => ({ id: message.id, content: message.content })))
    mocks.saveIndex.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(store.executeGroupScriptCommand(sessionId, 1, { type: 'restart', operationId: 'index-failed', at: Date.now() })).rejects.toThrow('index unavailable')
    expect(store.getSessionMeta(sessionId)!.roomScriptRevision).toBe(1)
    expect(store.getSessionMessages(sessionId).map(message => ({ id: message.id, content: message.content }))).toEqual(messagesBefore)
    const recovered = await store.resolveGroupRoomScript(sessionId)
    expect(recovered!.progress!.revision).toBe(1)
    expect(store.getSessionMeta(sessionId)!.roomScriptRevision).toBe(2)
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[sessionId].roomScriptRevision).toBe(2)
    const recordBefore = structuredClone(records.get(sessionId))
    await store.executeGroupScriptCommand(sessionId, 2, { type: 'restart', operationId: 'index-failed', at: Date.now() })
    expect(records.get(sessionId)).toEqual(recordBefore)
    expect(store.getSessionMessages(sessionId).filter(message => message.id?.startsWith('script-act:'))).toHaveLength(2)
  })

  it('repairs index metadata and local state through an idempotent command retry', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    const command = { type: 'restart' as const, operationId: 'retry-index', at: Date.now() }
    mocks.saveIndex.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(store.executeGroupScriptCommand(sessionId, 1, command)).rejects.toThrow('index unavailable')
    const writes = mocks.saveSession.mock.calls.length
    await store.executeGroupScriptCommand(sessionId, 2, command)
    expect(mocks.saveSession).toHaveBeenCalledTimes(writes)
    expect(store.getSessionMeta(sessionId)!.roomScriptRevision).toBe(2)
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[sessionId].roomScriptRevision).toBe(2)
    expect(store.getSessionMessages(sessionId).filter(message => message.id?.startsWith('script-act:'))).toHaveLength(2)
  })

  it('recovers a durable paid-turn claim after index failure and refuses a second claim', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    const job = { kind: 'evaluation' as const, turnId: 'paid-turn', requestId: 'paid-request', operationId: 'paid-operation', expiresAt: Date.now() + 60_000, progressRevision: 0 }
    mocks.saveIndex.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(store.executeGroupScriptCommand(sessionId, 1, { type: 'claim', job })).rejects.toThrow('index unavailable')
    expect((await store.resolveGroupRoomScript(sessionId))!.chapterRuntime!.pendingJob).toEqual(job)
    await expect(store.executeGroupScriptCommand(sessionId, 2, { type: 'claim', job })).rejects.toThrow()
    expect(records.get(sessionId)!.meta.roomScriptRevision).toBe(2)
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[sessionId].roomScriptRevision).toBe(2)
  })

  it('refreshes durable membership and clears deleted sessions from stale window caches', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(sessionId)
    otherWindow.setActiveSession(sessionId)
    await vi.waitFor(() => expect(mocks.indexes.get('user-1')!.characters.group.activeSessionId).toBe(sessionId))
    await store.deleteSession(sessionId)
    await otherWindow.refreshFromPersistence()
    expect(otherWindow.getSessionMeta(sessionId)).toBeUndefined()
    expect(otherWindow.groupSessions.some(session => session.sessionId === sessionId)).toBe(false)
    expect(otherWindow.getAllSessions()).not.toHaveProperty(sessionId)
    expect(otherWindow.activeSessionId).not.toBe(sessionId)
    expect(await otherWindow.resolveGroupRoomScript(sessionId)).toBeUndefined()
  })

  it('prunes a missing record after deletion succeeded but index persistence failed', async () => {
    const { sessionId, store } = await createRoom()
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    mocks.saveIndex.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(store.deleteSession(sessionId)).resolves.toBe(true)
    expect(records.has(sessionId)).toBe(false)
    expect(store.getSessionMeta(sessionId)).toBeUndefined()
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[sessionId]).toBeDefined()
    await otherWindow.refreshFromPersistence()
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[sessionId]).toBeUndefined()
    expect(otherWindow.getSessionMeta(sessionId)).toBeUndefined()
  })

  it('keeps explicit import replacement semantics instead of unioning old sessions', async () => {
    const { sessionId, store } = await createRoom()
    const payload = await store.exportSessions()
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    const removedByImport = await otherWindow.createGroupSession([{ characterId: 'character-1', displayName: 'One' }], 'Other window')
    await store.importSessions(payload)
    const durable = mocks.indexes.get('user-1')!
    expect(durable.characters.group.sessions[sessionId]).toBeDefined()
    expect(durable.characters.group.sessions[removedByImport]).toBeUndefined()
  })

  it('resets the latest user index explicitly and prevents stale windows from restoring removed entries', async () => {
    const { sessionId, store } = await createRoom()
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(sessionId)
    const remoteSessionId = await otherWindow.createGroupSession([{ characterId: 'character-1', displayName: 'One' }], 'Remote room')
    await store.resetAllSessions()
    expect(mocks.indexes.get('user-1')!.characters.group).toBeUndefined()
    expect(records.has(sessionId)).toBe(false)
    expect(records.has(remoteSessionId)).toBe(false)
    await otherWindow.persistSessionMessages(remoteSessionId, { immediate: true })
    expect(mocks.indexes.get('user-1')!.characters.group).toBeUndefined()
    expect(records.has(remoteSessionId)).toBe(false)
  }, 15_000)

  it('retains a session inserted by another window while reset deletes its initial snapshot', async () => {
    const { sessionId, store } = await createRoom()
    const oldGeneration = store.getSessionGeneration(sessionId)
    const otherWindow = useChatSessionStore(createPinia())
    await otherWindow.initialize()
    let releaseDelete!: () => void
    let startedDelete!: () => void
    const started = new Promise<void>((resolve) => {
      startedDelete = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseDelete = resolve
    })
    mocks.deleteSession.mockImplementationOnce(async (id: string) => {
      startedDelete()
      await release
      records.delete(id)
    })
    mocks.saveSession.mockImplementation(async (id: string, record: ChatSessionRecord) => {
      if (record.meta.title === 'During reset')
        expect(records.has(sessionId)).toBe(true)
      records.set(id, structuredClone(record))
    })
    const resetting = store.resetAllSessions()
    await started
    expect(store.getSessionGeneration(sessionId)).toBe(oldGeneration)
    const inserting = otherWindow.createGroupSession([{ characterId: 'character-1', displayName: 'One' }], 'During reset')
    // Let the other window enqueue its user-index lock while deletion holds it.
    for (let turn = 0; turn < 20; turn++)
      await Promise.resolve()
    releaseDelete()
    const inserted = await inserting
    await resetting
    expect(store.getSessionGeneration(sessionId)).toBeGreaterThan(oldGeneration)
    expect(records.has(sessionId)).toBe(false)
    expect(records.has(inserted)).toBe(true)
    expect(mocks.indexes.get('user-1')!.characters.group.sessions[inserted]).toBeDefined()
    expect(store.groupSessions.some(session => session.sessionId === inserted)).toBe(true)
  })

  function chapterState() {
    const base = createRoomScriptState()
    return parseGroupRoomScriptState({
      ...base,
      templateSnapshot: { ...base.templateSnapshot, acts: [
        { actId: 'first', number: 1, title: 'First act', narration: 'The watch begins.', unlockConditions: [{ conditionId: 'explained', description: 'An arrival has been explained.' }] },
        { actId: 'second', number: 2, title: 'Second act', unlockConditions: [{ conditionId: 'resolved', description: 'The situation is resolved.' }] },
      ] },
      chapterSettings: { ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, automaticEvaluationEnabled: true },
    }, ['character-1', 'character-2'])
  }

  it('uses the fresh durable message list for chapter evidence and never resurrects a deleted message', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    store.getSessionMessages(sessionId).push({ id: 'removed-evidence', role: 'user', content: 'The guest explained their arrival.' })
    await store.persistSessionMessages(sessionId, { immediate: true })
    const record = records.get(sessionId)!
    records.set(sessionId, { ...record, messages: record.messages.filter(message => message.id !== 'removed-evidence') })
    const now = Date.now()
    await store.executeGroupScriptCommand(sessionId, 1, {
      type: 'claim',
      job: { kind: 'evaluation', turnId: 'turn-1', requestId: 'request-1', operationId: 'eval-1', expiresAt: now + 60_000, progressRevision: 0 },
    })
    expect(records.get(sessionId)!.messages.some(message => message.id === 'removed-evidence')).toBe(false)
    await expect(store.executeGroupScriptCommand(sessionId, 2, {
      type: 'evaluate',
      requestId: 'request-1',
      evaluation: {
        actId: 'first',
        operationId: 'eval-1',
        evaluationTurnId: 'turn-1',
        evaluatedAt: now,
        conditions: [{ conditionId: 'explained', satisfied: true, confidence: 0.9, messageIds: ['removed-evidence'] }],
      },
    })).rejects.toThrow('unavailable message')
    expect(records.get(sessionId)!.roomScript!.progress!.revision).toBe(0)
    await expect(store.executeGroupScriptCommand(sessionId, 1, { type: 'restart', operationId: 'restart-old', at: now })).rejects.toThrow('changed')
  })

  it('lets only one independently hydrated window claim a paid chapter turn', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    const savedIndex = structuredClone(mocks.saveIndex.mock.calls.at(-1)![0])
    setActivePinia(createPinia())
    const airiCardStore = (await import('../modules/airi-card')).useAiriCardStore()
    airiCardStore.activeCardId = 'group'
    mocks.getIndex.mockResolvedValue(savedIndex)
    const otherWindow = useChatSessionStore()
    await otherWindow.initialize()
    await otherWindow.resolveGroupRoomScript(sessionId)
    const now = Date.now()
    const job = { kind: 'evaluation' as const, turnId: 'shared-turn', operationId: 'first-window', requestId: 'first-window', expiresAt: now + 60_000, progressRevision: 0 }
    const results = await Promise.allSettled([
      store.executeGroupScriptCommand(sessionId, 1, { type: 'claim', job }),
      otherWindow.executeGroupScriptCommand(sessionId, 1, { type: 'claim', job: { ...job, operationId: 'other-window', requestId: 'other-window' } }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(records.get(sessionId)!.meta.roomScriptRevision).toBe(2)
    expect(records.get(sessionId)!.roomScript!.chapterRuntime!.pendingJob!.requestId).toBe('first-window')
  })

  it('does not publish an advanced chapter when its durable write fails', async () => {
    const { sessionId, store } = await createRoom()
    const initial = await store.updateGroupRoomScript(sessionId, chapterState())
    mocks.saveSession.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(store.executeGroupScriptCommand(sessionId, 1, { type: 'restart', operationId: 'restart-failed', at: Date.now() })).rejects.toThrow('storage unavailable')
    expect(store.getSessionMeta(sessionId)!.roomScriptRevision).toBe(1)
    expect(await store.resolveGroupRoomScript(sessionId)).toEqual(initial)
    expect(records.get(sessionId)!.roomScript!.progress!.revision).toBe(0)
  })

  it('announces each attachment generation once and gives an explicit restart its own announcement', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, chapterState())
    await store.clearGroupRoomScript(sessionId)
    const attachedAgain = await store.updateGroupRoomScript(sessionId, chapterState())
    await store.updateGroupRoomScript(sessionId, attachedAgain!, 3)
    const announcements = () => records.get(sessionId)!.messages.filter(message => message.id?.startsWith('script-act:'))
    expect(announcements()).toHaveLength(2)
    expect(new Set(announcements().map(message => message.id)).size).toBe(2)
    await store.executeGroupScriptCommand(sessionId, 4, { type: 'restart', operationId: 'restart-current', at: Date.now() })
    expect(announcements()).toHaveLength(3)
    expect(records.get(sessionId)!.roomScript!.progress!.revision).toBe(1)
  })

  it('supports a one-character group while keeping its final member', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const sessionId = await store.createGroupSession([
      { characterId: 'character-1', displayName: 'One' },
    ], 'Solo room')

    expect(records.get(sessionId)?.meta.participants).toEqual([
      expect.objectContaining({ characterId: 'character-1' }),
    ])
    await expect(store.removeGroupParticipant(sessionId, 'character-1')).resolves.toBe(false)
  })

  it('updates, resolves, and clears a validated room script with monotonic revisions', async () => {
    const { sessionId, store } = await createRoom()
    const state = createRoomScriptState()

    await expect(store.updateGroupRoomScript(sessionId, state)).resolves.toEqual(state)
    expect(await store.resolveGroupRoomScript(sessionId)).toEqual(state)
    expect(records.get(sessionId)).toMatchObject({
      meta: { roomScriptRevision: 1 },
      roomScript: { templateSnapshot: { title: 'Night shift' } },
    })

    await store.clearGroupRoomScript(sessionId)
    expect(await store.resolveGroupRoomScript(sessionId)).toBeUndefined()
    expect(records.get(sessionId)?.meta.roomScriptRevision).toBe(2)
    expect(records.get(sessionId)).not.toHaveProperty('roomScript')
  })

  it('renames a group in its live metadata, index, and persisted reload', async () => {
    const { sessionId, store } = await createRoom()

    await expect(store.renameGroupSession(sessionId, '  Night Crew  ')).resolves.toBe(true)
    expect(store.getSessionMeta(sessionId)?.title).toBe('Night Crew')
    expect(store.groupSessions.find(room => room.sessionId === sessionId)?.title).toBe('Night Crew')
    expect(records.get(sessionId)?.meta.title).toBe('Night Crew')

    const savedIndex = structuredClone(mocks.saveIndex.mock.calls.at(-1)?.[0] as ChatSessionsIndex)
    setActivePinia(createPinia())
    const airiCardStore = (await import('../modules/airi-card')).useAiriCardStore()
    airiCardStore.activeCardId = 'group'
    mocks.getIndex.mockResolvedValue(savedIndex)
    const reloadedStore = useChatSessionStore()
    await reloadedStore.initialize()

    expect(reloadedStore.groupSessions.find(room => room.sessionId === sessionId)?.title).toBe('Night Crew')
  })

  it('preserves a newer persisted room script during an ordinary message save', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, createRoomScriptState())

    const persisted = records.get(sessionId)!
    records.set(sessionId, {
      ...persisted,
      meta: {
        ...persisted.meta,
        roomScriptRevision: 2,
        updatedAt: persisted.meta.updatedAt + 10,
      },
      roomScript: createRoomScriptState(undefined, 'Changed elsewhere'),
    })

    store.setSessionMessages(sessionId, [{ id: 'user-1', role: 'user', content: 'hello', createdAt: 10 }])
    await store.persistSessionMessages(sessionId, { immediate: true })

    expect(records.get(sessionId)?.meta.roomScriptRevision).toBe(2)
    expect(records.get(sessionId)?.roomScript?.templateSnapshot.title).toBe('Changed elsewhere')
  })

  it('captures messages when a queued persistence task runs, not when it is scheduled', async () => {
    const { sessionId, store } = await createRoom()
    let releaseFirstSave!: () => void
    let firstSaveStarted!: () => void
    const firstSaveReady = new Promise<void>((resolve) => {
      firstSaveStarted = resolve
    })
    const firstSaveRelease = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    let deferNextSave = true

    mocks.saveSession.mockImplementation(async (id: string, record: ChatSessionRecord) => {
      if (deferNextSave) {
        deferNextSave = false
        firstSaveStarted()
        await firstSaveRelease
      }
      records.set(id, structuredClone(record))
    })

    store.setSessionMessages(sessionId, [
      { id: 'user-1', role: 'user', content: 'hello', createdAt: 1 },
    ])
    const firstPersist = store.persistSessionMessages(sessionId, { immediate: true })
    await firstSaveReady

    // Queue the next write while the first one is blocked, then append a
    // speaker message before the queued callback actually snapshots state.
    const secondPersist = store.persistSessionMessages(sessionId, { immediate: true })
    store.getSessionMessages(sessionId).push({
      id: 'speaker-2',
      role: 'assistant',
      content: 'second speaker reply',
      createdAt: 2,
      slices: [],
      tool_results: [],
    })
    releaseFirstSave()

    await Promise.all([firstPersist, secondPersist])
    expect(records.get(sessionId)?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ id: 'speaker-2', content: 'second speaker reply' }),
    ]))
  })

  it('atomically detaches an existing script when participants change', async () => {
    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, createRoomScriptState())

    await expect(store.addGroupParticipant(sessionId, { characterId: 'character-3', displayName: 'Three' })).resolves.toBe(true)
    expect(records.get(sessionId)?.meta).toMatchObject({
      roomScriptRevision: 2,
      participants: expect.arrayContaining([expect.objectContaining({ characterId: 'character-3' })]),
    })
    expect(records.get(sessionId)).not.toHaveProperty('roomScript')

    await store.updateGroupRoomScript(sessionId, createRoomScriptState(['character-1', 'character-2', 'character-3']))
    await expect(store.removeGroupParticipant(sessionId, 'character-3')).resolves.toBe(true)
    expect(records.get(sessionId)?.meta.roomScriptRevision).toBe(4)
    expect(records.get(sessionId)).not.toHaveProperty('roomScript')
  })

  it('reloads and exports a valid snapshot while omitting an invalid persisted snapshot', async () => {
    const { sessionId, store } = await createRoom()
    const state = createRoomScriptState()
    await store.updateGroupRoomScript(sessionId, state)

    const firstExport = await store.exportSessions()
    expect(firstExport.sessions[sessionId]?.roomScript).toEqual(state)

    const savedIndex = structuredClone(mocks.saveIndex.mock.calls.at(-1)?.[0] as ChatSessionsIndex)
    setActivePinia(createPinia())
    const airiCardStore = (await import('../modules/airi-card')).useAiriCardStore()
    airiCardStore.activeCardId = 'group'
    mocks.getIndex.mockResolvedValue(savedIndex)
    const reloadedStore = useChatSessionStore()
    await reloadedStore.initialize()
    expect(await reloadedStore.resolveGroupRoomScript(sessionId)).toEqual(state)

    const validRecord = records.get(sessionId)!
    records.set(sessionId, {
      ...validRecord,
      meta: { ...validRecord.meta, roomScriptRevision: 2, updatedAt: validRecord.meta.updatedAt + 10 },
      roomScript: {
        ...state,
        templateSnapshot: { ...state.templateSnapshot, systemPrompt: 'must not import' },
      } as unknown as GroupRoomScriptState,
    })
    await reloadedStore.refreshFromPersistence()
    expect(await reloadedStore.resolveGroupRoomScript(sessionId)).toBeUndefined()
    expect((await reloadedStore.exportSessions()).sessions[sessionId]).not.toHaveProperty('roomScript')
  })

  it('validates room scripts during import and preserves valid snapshots', async () => {
    const store = useChatSessionStore()
    await store.initialize()
    const meta = {
      sessionId: 'imported-room',
      userId: 'user-1',
      characterId: 'group',
      kind: 'room' as const,
      participants: [
        { characterId: 'character-1', displayName: 'One' },
        { characterId: 'character-2', displayName: 'Two' },
      ],
      roomScriptRevision: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    const state = createRoomScriptState()
    await store.importSessions({
      format: 'chat-sessions-index:v1',
      index: {
        userId: 'user-1',
        characters: { group: { activeSessionId: meta.sessionId, sessions: { [meta.sessionId]: meta } } },
      },
      sessions: { [meta.sessionId]: { meta, messages: [], roomScript: state } },
    })

    expect(await store.resolveGroupRoomScript(meta.sessionId)).toEqual(state)
    expect(records.get(meta.sessionId)?.roomScript).toEqual(state)
  })

  it('hydrates legacy room scripts without a revision for narration settings', async () => {
    const { sessionId, store } = await createRoom()
    const state = createRoomScriptState()
    const persisted = records.get(sessionId)!
    records.set(sessionId, {
      ...persisted,
      meta: { ...persisted.meta, roomScriptRevision: undefined },
      roomScript: state,
    })

    await store.refreshFromPersistence()
    await expect(store.resolveGroupRoomScript(sessionId)).resolves.toEqual(state)
    expect(store.getSessionMeta(sessionId)?.roomScriptRevision).toBe(1)
  })

  it('marks a cached script stale when a newer cross-window write has the same revision', async () => {
    let channel: { onmessage?: (event: MessageEvent) => void } | undefined
    class FakeBroadcastChannel {
      onmessage?: (event: MessageEvent) => void

      constructor(_name: string) {
        channel = this
      }

      postMessage() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, createRoomScriptState())
    const persisted = records.get(sessionId)!
    const changedState = createRoomScriptState(undefined, 'Remote revision')
    const changedRecord: ChatSessionRecord = {
      ...persisted,
      meta: { ...persisted.meta, updatedAt: persisted.meta.updatedAt + 10 },
      roomScript: changedState,
    }
    records.set(sessionId, changedRecord)

    channel?.onmessage?.({
      data: {
        type: 'chat-session-updated',
        sessionId,
        userId: 'user-1',
        characterId: 'group',
        meta: changedRecord.meta,
        messages: changedRecord.messages,
      },
    } as MessageEvent)

    expect(await store.resolveGroupRoomScript(sessionId)).toEqual(changedState)
  })

  it('uses the room script revision to invalidate cache even when the incoming timestamp is older', async () => {
    let channel: { onmessage?: (event: MessageEvent) => void } | undefined
    class FakeBroadcastChannel {
      onmessage?: (event: MessageEvent) => void

      constructor(_name: string) {
        channel = this
      }

      postMessage() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

    const { sessionId, store } = await createRoom()
    await store.updateGroupRoomScript(sessionId, createRoomScriptState())
    const persisted = records.get(sessionId)!
    const changedState = createRoomScriptState(undefined, 'Higher logical revision')
    const changedRecord: ChatSessionRecord = {
      ...persisted,
      meta: {
        ...persisted.meta,
        roomScriptRevision: (persisted.meta.roomScriptRevision ?? 0) + 1,
        updatedAt: persisted.meta.updatedAt - 1,
      },
      roomScript: changedState,
    }
    records.set(sessionId, changedRecord)

    channel?.onmessage?.({
      data: {
        type: 'chat-session-updated',
        sessionId,
        userId: 'user-1',
        characterId: 'group',
        meta: changedRecord.meta,
        messages: changedRecord.messages,
      },
    } as MessageEvent)

    expect(await store.resolveGroupRoomScript(sessionId)).toEqual(changedState)
  })
})
