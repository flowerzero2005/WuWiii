import type { ChatSessionRecord, ChatSessionsIndex } from '../../types/chat-session'
import type { GroupRoomScriptState } from './group-script'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatSessionStore } from './session-store'

const mocks = vi.hoisted(() => ({
  getIndex: vi.fn(),
  getCardRuntime: vi.fn(),
  getSession: vi.fn(),
  isAuthenticated: false,
  postSync: vi.fn(),
  saveIndex: vi.fn(),
  saveSession: vi.fn(),
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
    deleteSession: vi.fn(),
    getIndex: mocks.getIndex,
    getSession: mocks.getSession,
    saveIndex: mocks.saveIndex,
    saveSession: mocks.saveSession,
  },
}))

vi.mock('../auth', async () => {
  const { defineStore } = await import('pinia')
  const { computed, ref } = await import('vue')
  return {
    useAuthStore: defineStore('auth', () => ({
      isAuthenticated: computed(() => mocks.isAuthenticated),
      userId: ref('user-1'),
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
    deleteNotesForSession: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('chat session sync conflicts', () => {
  const records = new Map<string, ChatSessionRecord>()

  beforeEach(() => {
    setActivePinia(createPinia())
    records.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated = false
    mocks.waitUntilReady.mockResolvedValue(undefined)

    mocks.getIndex.mockResolvedValue(null)
    mocks.getCardRuntime.mockImplementation((characterId: string) => ({
      characterId,
      displayName: characterId,
      systemPrompt: `${characterId} private prompt`,
    }))
    mocks.getSession.mockImplementation(async (sessionId: string) => records.get(sessionId) ?? null)
    mocks.saveIndex.mockResolvedValue(undefined)
    mocks.saveSession.mockImplementation(async (sessionId: string, record: ChatSessionRecord) => {
      records.set(sessionId, structuredClone(record))
    })
    mocks.postSync.mockResolvedValue(new Response(null, { status: 200 }))
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
    mocks.waitUntilReady.mockResolvedValue(undefined)
    mocks.getIndex.mockResolvedValue(null)
    mocks.getCardRuntime.mockImplementation((characterId: string) => ({
      characterId,
      displayName: characterId,
      systemPrompt: `${characterId} private prompt`,
    }))
    mocks.getSession.mockImplementation(async (sessionId: string) => records.get(sessionId) ?? null)
    mocks.saveIndex.mockResolvedValue(undefined)
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
