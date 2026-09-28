import type { ChatSessionRecord, ChatSessionsIndex } from '../types/chat-session'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive, ref } from 'vue'

import { DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, parseGroupRoomScriptState } from '../stores/chat/group-script'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useGroupScriptJobs } from './use-group-script-jobs'

const mocks = vi.hoisted(() => ({
  records: new Map<string, ChatSessionRecord>(),
  indexes: new Map<string, ChatSessionsIndex>(),
  generateText: vi.fn(),
  consentRequired: false,
  consentState: { fingerprint: 'quote-a' },
  authState: { userId: 'account-a', authenticated: false },
  activeActivities: 0,
}))

vi.mock('@xsai/generate-text', () => ({ generateText: mocks.generateText }))
vi.mock('../database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: {
  getIndex: async (id: string) => structuredClone(mocks.indexes.get(id) ?? null),
  saveIndex: async (index: ChatSessionsIndex) => { mocks.indexes.set(index.userId, structuredClone(index)) },
  getSession: async (id: string) => structuredClone(mocks.records.get(id) ?? null),
  saveSession: async (id: string, record: ChatSessionRecord) => { mocks.records.set(id, structuredClone(record)) },
  deleteSession: async (id: string) => { mocks.records.delete(id) },
  listSessionIds: async () => [...mocks.records.keys()],
} }))
vi.mock('../stores/chat/session-record-lock', () => {
  const queues = new Map<string, Promise<unknown>>()
  function lock(key: string, task: () => Promise<unknown>) {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    queues.set(key, next.catch(() => undefined))
    return next
  }
  return {
    withSessionRecordLock: (id: string, task: () => Promise<unknown>) => lock(`record:${id}`, task),
    withUserSessionIndexLock: (id: string, task: () => Promise<unknown>) => lock(`index:${id}`, task),
    withSessionActivity: async (_id: string, task: () => Promise<unknown>) => {
      mocks.activeActivities++
      try {
        return await task()
      }
      finally {
        mocks.activeActivities--
      }
    },
    withIdleSession: async (_id: string, task: () => Promise<unknown>) => mocks.activeActivities ? undefined : task(),
  }
})
vi.mock('./api', () => ({ client: { api: { chats: { sync: { $post: vi.fn(async () => new Response(null, { status: 200 })) } } } } }))
vi.mock('../stores/auth', async () => {
  const { defineStore } = await import('pinia')
  const { computed } = await import('vue')
  return { useAuthStore: defineStore('auth', () => ({
    userId: computed(() => mocks.authState.userId),
    isAuthenticated: computed(() => mocks.authState.authenticated),
    waitUntilReady: async () => undefined,
  })) }
})
vi.mock('../stores/modules/consciousness', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useConsciousnessStore: defineStore('consciousness', () => ({ activeProvider: ref('custom'), activeModel: ref('model-a') })) }
})
vi.mock('../stores/providers', () => ({ useProvidersStore: () => ({
  getProviderConfig: () => ({ baseURL: 'https://mock.invalid/v1/' }),
  getProviderInstance: async () => ({ chat: () => ({ baseURL: 'https://mock.invalid/v1/', apiKey: 'mock' }) }),
}) }))
vi.mock('../stores/settings/official-capability-consent', () => ({ useOfficialCapabilityConsentStore: () => ({ getQuote: () => ({ fingerprint: mocks.consentState.fingerprint }), getAcceptance: () => ({ quote: { fingerprint: mocks.consentState.fingerprint } }), needsConsent: () => mocks.consentRequired }) }))
vi.mock('../stores/modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useAiriCardStore: defineStore('airi-card', () => ({ activeCardId: ref('character-1'), getCard: vi.fn(), getCardRuntime: (id: string) => ({ characterId: id, displayName: id, systemPrompt: 'A guard.' }), systemPrompt: ref('A guard.') })) }
})
vi.mock('../stores/modules/persona-package', () => ({ getPersonaCardInitialGreeting: vi.fn() }))
vi.mock('../stores/chat/context-providers', () => ({ resetConversationInitialization: vi.fn() }))
vi.mock('../stores/settings/memory-advanced', async () => {
  const { defineStore } = await import('pinia')
  const { reactive } = await import('vue')
  return { useMemoryAdvancedSettingsStore: defineStore('memory-advanced-settings', () => ({ settings: reactive({ enableMultiUser: false }) })) }
})
vi.mock('../stores/user-identity', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useUserIdentityStore: defineStore('user-identity', () => ({ currentUserId: ref('default'), identifyUser: async () => 'default' })) }
})
vi.mock('../stores/chat/inner-voice-notes', () => ({ useAssistantInnerVoiceNoteStore: () => ({ deleteNotesForSession: async () => undefined }) }))

const piniaInstances: ReturnType<typeof createPinia>[] = []
const scopes: ReturnType<typeof effectScope>[] = []
function activatePinia() {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  setActivePinia(pinia)
}
function chapterState() {
  return parseGroupRoomScriptState({
    templateSnapshot: { format: 'airi-group-script:v1', id: 'story', title: 'The crossing', rules: [], slots: [{ slotId: 'guard', name: 'Guard' }], relationships: [], createdAt: 1, updatedAt: 2, acts: [
      { actId: 'crossing', number: 1, title: 'Crossing', narration: 'The gate remains shut.', unlockConditions: [{ conditionId: 'safe', description: 'Everyone reaches the other side safely.', minConfidence: 0.8 }] },
      { actId: 'shelter', number: 2, title: 'Shelter', narration: 'The group searches for shelter.', unlockConditions: [{ conditionId: 'rest', description: 'Everyone finds shelter.' }] },
    ] },
    roleBindings: { guard: 'character-1' },
    narrationSettings: { enabled: false, speechEnabled: false },
    chapterSettings: { ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, automaticEvaluationEnabled: true },
  }, ['character-1'])
}
async function setupRoom() {
  const store = useChatSessionStore()
  await store.initialize()
  const sessionId = await store.createGroupSession([{ characterId: 'character-1', displayName: 'Guard' }], 'Crossing room')
  await store.updateGroupRoomScript(sessionId, chapterState())
  store.getSessionMessages(sessionId).push(
    { id: 'turn-a', role: 'user', content: 'I count our companions on the far bank. Nobody is missing.' },
    { id: 'answer-a', role: 'assistant', content: 'The last traveller steps onto dry land, unharmed.', slices: [{ type: 'text', text: 'The last traveller steps onto dry land, unharmed.' }], tool_results: [], metadata: { typingCompleted: true } },
  )
  const current = ref(sessionId)
  const scope = effectScope()
  scopes.push(scope)
  const jobs = scope.run(() => useGroupScriptJobs(current))!
  return { store, sessionId, current, jobs, input: { sessionId, turnId: 'turn-a', groupTurnId: 'group-a', language: 'en' } }
}
const display = { isPending: () => false, hasVisibleResponse: () => true }
function evaluated(overrides: Record<string, unknown> = {}) {
  return { text: JSON.stringify({ actId: 'crossing', conditions: [{ conditionId: 'safe', satisfied: true, confidence: 0.94, messageIds: ['turn-a', 'answer-a'], summary: 'Every traveller has arrived uninjured.', ...overrides }] }) }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  mocks.records.clear()
  mocks.indexes.clear()
  mocks.generateText.mockReset().mockResolvedValue(evaluated())
  mocks.consentRequired = false
  mocks.consentState = reactive({ fingerprint: 'quote-a' })
  mocks.authState = reactive({ userId: 'account-a', authenticated: false })
  mocks.activeActivities = 0
  activatePinia()
})
afterEach(async () => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.useRealTimers()
  // Let genuine store account transitions finish before disposing their Pinia.
  await new Promise(resolve => setTimeout(resolve, 0))
  piniaInstances.splice(0).forEach(disposePinia)
  vi.unstubAllGlobals()
})

describe('completed group turn through model, chapter persistence and narration', () => {
  it('uses semantic evidence without shared keywords, persists one advance and reloads its progress/narration', async () => {
    const { store, jobs, input, sessionId } = await setupRoom()
    await jobs.scheduleEvaluation(input, display)
    expect(mocks.generateText).toHaveBeenCalledOnce()
    const request = mocks.generateText.mock.calls[0][0]
    const context = JSON.parse(request.messages[1].content)
    expect(context.conversation.map((message: { id: string }) => message.id)).toEqual(['turn-a', 'answer-a'])
    expect(request.messages[0].content).toContain('Do not use keyword matching')
    const saved = mocks.records.get(sessionId)!
    expect(saved.roomScript!.progress!.currentActId).toBe('shelter')
    expect(saved.roomScript!.chapterRuntime!.evaluations[0].result).toBe('advanced')
    expect(saved.messages.filter(message => message.metadata?.messageKind === 'narration')).toHaveLength(2)
    expect((await store.resolveGroupRoomScript(sessionId))!.progress).toEqual(saved.roomScript!.progress)
    activatePinia()
    const reloaded = useChatSessionStore()
    await reloaded.initialize()
    await reloaded.loadSession(sessionId)
    expect((await reloaded.resolveGroupRoomScript(sessionId))!.progress).toEqual(saved.roomScript!.progress)
    expect(reloaded.getSessionMessages(sessionId).map(message => message.id)).toEqual(saved.messages.map(message => message.id))
    const scope = effectScope()
    scopes.push(scope)
    const reloadedJobs = scope.run(() => useGroupScriptJobs(sessionId))!
    await expect(reloadedJobs.run('evaluation', input)).rejects.toThrow('already been evaluated')
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it.each([
    ['same words but not accomplished', { satisfied: false, confidence: 0.95, summary: 'They only plan to reach the other side safely.' }],
    ['low confidence', { confidence: 0.4 }],
  ])('does not advance on %s and retains the billed-turn marker', async (_label, verdict) => {
    mocks.generateText.mockResolvedValue(evaluated(verdict))
    const { jobs, input, sessionId } = await setupRoom()
    await jobs.scheduleEvaluation(input, display)
    const saved = mocks.records.get(sessionId)!
    expect(saved.roomScript!.progress!.revision).toBe(0)
    expect(saved.roomScript!.chapterRuntime!.evaluations[0].result).toBe('unmet')
    await expect(jobs.run('evaluation', input)).rejects.toThrow('already been evaluated')
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it.each(['invalid evidence', 'bad JSON'])('fails closed on %s without another model request', async (kind) => {
    mocks.generateText.mockResolvedValue(kind === 'bad JSON' ? { text: '{broken' } : evaluated({ messageIds: ['invented-message'] }))
    const { jobs, input, sessionId } = await setupRoom()
    await expect(jobs.scheduleEvaluation(input, display)).rejects.toThrow()
    expect(mocks.records.get(sessionId)!.roomScript!.progress!.revision).toBe(0)
    expect(mocks.records.get(sessionId)!.roomScript!.chapterRuntime!.evaluations[0].result).toBe('failed')
    await expect(jobs.run('evaluation', input)).rejects.toThrow('already been evaluated')
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('waits for the final visible response and persists it before evaluating', async () => {
    const { jobs, input, store, sessionId } = await setupRoom()
    vi.useFakeTimers()
    let pendingDisplay = true
    const request = jobs.scheduleEvaluation(input, { ...display, isPending: () => pendingDisplay })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.generateText).not.toHaveBeenCalled()
    const answer = store.getSessionMessages(sessionId).find(message => message.id === 'answer-a')!
    answer.content = 'All companions finally reach dry land.'
    if (answer.role === 'assistant')
      answer.slices = [{ type: 'text', text: answer.content }]
    pendingDisplay = false
    await vi.advanceTimersByTimeAsync(250)
    await request
    expect(mocks.records.get(sessionId)!.messages.find(message => message.id === 'answer-a')!.content).toBe('All companions finally reach dry land.')
    expect(JSON.parse(mocks.generateText.mock.calls[0][0].messages[1].content).conversation[1].text).toContain('finally reach dry land')
  })

  it.each(['account', 'model', 'session', 'quote'])('cancels a queued completed turn on %s change before any provider request', async (change) => {
    const { jobs, input, current } = await setupRoom()
    if (change === 'quote') {
      useConsciousnessStore().activeProvider = 'official-cloud'
      mocks.authState.authenticated = true
    }
    const request = jobs.scheduleEvaluation(input, { ...display, isPending: () => true })
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    if (change === 'account')
      mocks.authState.userId = 'account-b'
    else if (change === 'model')
      useConsciousnessStore().activeModel = 'model-b'
    else if (change === 'session')
      current.value = 'other-room'
    else
      mocks.consentState.fingerprint = 'quote-b'
    await rejected
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('does not evaluate a turn without a completed visible speaker response', async () => {
    const { jobs, input } = await setupRoom()
    await jobs.scheduleEvaluation(input, { ...display, hasVisibleResponse: () => false })
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it('keeps the display protected from cleanup even when chapter evaluation is disabled', async () => {
    const { jobs, input } = await setupRoom()
    vi.useFakeTimers()
    let pendingDisplay = true
    const request = jobs.scheduleEvaluation(input, { ...display, isPending: () => pendingDisplay, shouldEvaluate: () => false })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.activeActivities).toBe(1)
    pendingDisplay = false
    await vi.advanceTimersByTimeAsync(250)
    await request
    expect(mocks.activeActivities).toBe(0)
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  it.each(['account', 'session', 'model'])('discards an in-flight model response after %s changes', async (change) => {
    const { jobs, input, current, sessionId } = await setupRoom()
    let finish!: (value: { text: string }) => void
    mocks.generateText.mockImplementation(() => new Promise(resolve => finish = resolve))
    const request = jobs.scheduleEvaluation(input, display)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce())
    if (change === 'account')
      mocks.authState.userId = 'account-b'
    else if (change === 'session')
      current.value = 'other-room'
    else
      useConsciousnessStore().activeModel = 'model-b'
    await rejected
    expect(jobs.pending.value).toBe(false)
    finish(evaluated())
    await Promise.resolve()
    expect(mocks.records.get(sessionId)!.roomScript!.progress!.revision).toBe(0)
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('keeps automatic evaluation and sequel generation opt-in for a newly attached script', () => {
    const state = chapterState()
    delete state.chapterSettings
    const parsed = parseGroupRoomScriptState(state, ['character-1'])
    expect({ ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, ...parsed.chapterSettings }).toMatchObject({ automaticEvaluationEnabled: false, sequelGenerationEnabled: false })
  })

  it('rolls back after an advance without deleting conversation or prior completion evidence', async () => {
    const { jobs, input, store, sessionId } = await setupRoom()
    await jobs.scheduleEvaluation(input, display)
    const advanced = (await store.resolveGroupRoomScript(sessionId))!
    const ids = mocks.records.get(sessionId)!.messages.map(message => message.id)
    await store.executeGroupScriptCommand(sessionId, store.getSessionMeta(sessionId)!.roomScriptRevision!, { type: 'rollback', operationId: 'rollback-a', at: Date.now() })
    const rolled = (await store.resolveGroupRoomScript(sessionId))!
    expect(rolled.progress!.currentActId).toBe('crossing')
    expect(rolled.progress!.history[1]).toEqual(advanced.progress!.history[1])
    expect(mocks.records.get(sessionId)!.messages.map(message => message.id)).toEqual(expect.arrayContaining(ids))
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('releases a non-cooperative model on timeout and ignores its late response', async () => {
    const { jobs, input, sessionId } = await setupRoom()
    let finish!: (value: { text: string }) => void
    mocks.generateText.mockImplementation(() => new Promise(resolve => finish = resolve))
    vi.useFakeTimers()
    const request = jobs.scheduleEvaluation(input, display)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.generateText).toHaveBeenCalledOnce()
    expect(mocks.activeActivities).toBe(1)
    await vi.advanceTimersByTimeAsync(90_000)
    await rejected
    expect(jobs.pending.value).toBe(false)
    expect(mocks.activeActivities).toBe(0)
    finish(evaluated())
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.records.get(sessionId)!.roomScript!.progress!.revision).toBe(0)
    expect(mocks.records.get(sessionId)!.roomScript!.chapterRuntime!.evaluations[0].result).toBe('failed')
  })

  it('rejects a late evaluation after restart while keeping messages, prior history and the attempted-turn marker', async () => {
    const { jobs, input, store, sessionId } = await setupRoom()
    let finish!: (value: { text: string }) => void
    mocks.generateText.mockImplementation(() => new Promise(resolve => finish = resolve))
    const request = jobs.scheduleEvaluation(input, display)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledOnce())
    const ids = mocks.records.get(sessionId)!.messages.map(message => message.id)
    await store.executeGroupScriptCommand(sessionId, store.getSessionMeta(sessionId)!.roomScriptRevision!, { type: 'restart', operationId: 'restart-a', at: Date.now() })
    await rejected
    finish(evaluated())
    const state = (await store.resolveGroupRoomScript(sessionId))!
    expect(state.progress!.history.map(item => item.action)).toEqual(['initialize', 'restart'])
    expect(state.progress!.currentActId).toBe('crossing')
    expect(mocks.records.get(sessionId)!.messages.map(message => message.id)).toEqual(expect.arrayContaining(ids))
    await expect(jobs.run('evaluation', input)).rejects.toThrow('already been evaluated')
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })

  it('keeps sequel generation disabled by default and appends a validated proposal only after acceptance', async () => {
    const { jobs, input, store, sessionId } = await setupRoom()
    await store.persistSessionMessages(sessionId, { immediate: true })
    await expect(jobs.run('sequel', input)).rejects.toThrow('disabled')
    expect(mocks.generateText).not.toHaveBeenCalled()
    const state = (await store.resolveGroupRoomScript(sessionId))!
    await store.updateGroupRoomScript(sessionId, { ...state, chapterSettings: { ...state.chapterSettings!, sequelGenerationEnabled: true } }, store.getSessionMeta(sessionId)!.roomScriptRevision)
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({ summary: 'The following morning after finding shelter.', acts: [{ act: { actId: 'morning', number: 3, title: 'Morning', unlockConditions: [{ conditionId: 'leave', description: 'The group resumes its journey.' }] }, roleSlotIds: ['guard'], afterActId: 'shelter', prerequisiteActIds: ['shelter'] }] }) })
    await jobs.run('sequel', input)
    const proposed = (await store.resolveGroupRoomScript(sessionId))!
    expect(proposed.templateSnapshot.acts).toHaveLength(2)
    expect(proposed.chapterRuntime!.sequelDraft!.acts).toHaveLength(1)
    await store.executeGroupScriptCommand(sessionId, store.getSessionMeta(sessionId)!.roomScriptRevision!, { type: 'accept', requestId: proposed.chapterRuntime!.sequelDraft!.requestId, operationId: 'accept-a', at: Date.now() })
    const accepted = (await store.resolveGroupRoomScript(sessionId))!
    expect(accepted.templateSnapshot.acts).toHaveLength(3)
    expect(accepted.templateSnapshot.acts!.slice(0, 2)).toEqual(state.templateSnapshot.acts)
    expect(accepted.chapterRuntime!.sequelDraft).toBeUndefined()
    expect(mocks.generateText).toHaveBeenCalledOnce()
  })
})
