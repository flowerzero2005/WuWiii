import type {
  AiriAssistantInnerVoiceNote,
  AiriAssistantInnerVoiceNoteDraft,
} from '../../types/inner-voice-note'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const repoMock = vi.hoisted(() => {
  const notes = new Map<string, AiriAssistantInnerVoiceNote>()
  const key = (sessionId: string, messageId: string) => `${sessionId}::${messageId}`

  return {
    key,
    notes,
    innerVoiceNotesRepo: {
      getNote: vi.fn(async (sessionId: string, messageId: string) => {
        return notes.get(key(sessionId, messageId)) ?? null
      }),
      listNotesForSession: vi.fn(async (sessionId: string) => {
        return Array.from(notes.values())
          .filter(note => note.sessionId === sessionId)
          .sort((left, right) => left.createdAt - right.createdAt)
      }),
      listAllNotes: vi.fn(async () => {
        return Array.from(notes.values())
          .sort((left, right) => right.updatedAt - left.updatedAt)
      }),
      upsertNote: vi.fn(async (note: AiriAssistantInnerVoiceNoteDraft) => {
        const savedNote = {
          ...note,
          id: note.id ?? `note-${note.messageId}`,
          createdAt: note.createdAt ?? 1_000,
          updatedAt: note.updatedAt ?? 1_000,
          visibleByDefault: false,
        } satisfies AiriAssistantInnerVoiceNote
        notes.set(key(savedNote.sessionId, savedNote.messageId), savedNote)
        return savedNote
      }),
      deleteNoteForMessage: vi.fn(async (sessionId: string, messageId: string) => {
        const noteKey = key(sessionId, messageId)
        const note = notes.get(noteKey)
        notes.delete(noteKey)
        return note
      }),
      deleteNotesForSession: vi.fn(async (sessionId: string) => {
        const deletedNotes = Array.from(notes.values())
          .filter(note => note.sessionId === sessionId)
          .sort((left, right) => left.createdAt - right.createdAt)
        for (const note of deletedNotes)
          notes.delete(key(note.sessionId, note.messageId))
        return deletedNotes
      }),
      deleteNotesOlderThan: vi.fn(async (cutoff: number) => {
        const expired = [...notes.values()].filter(note => note.updatedAt < cutoff)
        expired.forEach(note => notes.delete(`${note.sessionId}:${note.messageId}`))
        return expired
      }),
    },
  }
})

const officialConsentMock = vi.hoisted(() => ({
  getQuote: vi.fn(() => ({ capability: 'inner-voice-note' })),
  needsConsent: vi.fn(() => false),
  refresh: vi.fn(async () => undefined),
}))

vi.mock('../../database/repos/inner-voice-notes.repo', () => ({
  innerVoiceNotesRepo: repoMock.innerVoiceNotesRepo,
}))

vi.mock('../auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-a' }, userId: 'user-a' }),
}))

vi.mock('../modules/airi-card', () => ({
  useAiriCardStore: () => ({ activeCardId: 'default' }),
}))

vi.mock('../official-pricing', () => ({
  useOfficialPricingStore: () => ({ refresh: officialConsentMock.refresh }),
}))

vi.mock('../settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => ({
    getQuote: officialConsentMock.getQuote,
    needsConsent: officialConsentMock.needsConsent,
  }),
}))

vi.mock('../settings/memory-advanced', () => ({
  useMemoryAdvancedSettingsStore: () => ({ settings: { innerVoiceNoteRetentionDays: 30 } }),
}))

const { useAssistantInnerVoiceNoteStore } = await import('./inner-voice-notes')

function createNote(patch: Partial<AiriAssistantInnerVoiceNote> = {}): AiriAssistantInnerVoiceNote {
  return {
    id: 'note-1',
    messageId: 'assistant-1',
    sessionId: 'session-a',
    personaCardId: 'airi',
    userId: 'user-a',
    text: 'She noticed the concern and softened only a little.',
    createdAt: 1_000,
    updatedAt: 1_000,
    visibleByDefault: false,
    ...patch,
  }
}

const sceneMode: AiriSceneModeInference = {
  mode: 'repair-after-failure',
  confidence: 'high',
  reason: 'User is correcting a reply.',
  signals: ['user-correction'],
  alternatives: [],
}

const personaState: AiriPersonaState = {
  closeness: 0.52,
  seriousness: 0.4,
  hurt: 0.18,
  affection: 0.68,
  needForAttention: 0.44,
  arousal: 0.36,
  inhibition: 0.7,
  emotionalOverhang: 'guarded',
  emotionalTrigger: 'repair-request',
  overhangTurnsRemaining: 2,
  trajectory: 'guarding',
  lastFailureKind: 'too-robotic',
}

const relationshipState: AiriPersonaRelationshipState = {
  trust: 0.42,
  familiarity: 0.56,
  teasingTolerance: 0.3,
  repairDebt: 0.2,
  recentSensitiveTopics: ['repair'],
}

describe('assistant inner voice note store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    repoMock.notes.clear()
    officialConsentMock.needsConsent.mockReturnValue(false)
    vi.clearAllMocks()
  })

  it('hydrates notes for a session without clearing other hydrated sessions', async () => {
    const sessionANote = createNote()
    const sessionBNote = createNote({
      id: 'note-b',
      sessionId: 'session-b',
      text: 'This belongs to another session.',
    })
    repoMock.notes.set(repoMock.key(sessionANote.sessionId, sessionANote.messageId), sessionANote)
    repoMock.notes.set(repoMock.key(sessionBNote.sessionId, sessionBNote.messageId), sessionBNote)

    const store = useAssistantInnerVoiceNoteStore()
    await store.hydrateSessionNotes('session-a')
    await store.hydrateSessionNotes('session-b')

    expect(store.getNoteForMessage('session-a', 'assistant-1')).toEqual(sessionANote)
    expect(store.getNoteForMessage('session-b', 'assistant-1')).toEqual(sessionBNote)

    repoMock.notes.delete(repoMock.key('session-a', 'assistant-1'))
    await store.hydrateSessionNotes('session-a')

    expect(store.getNoteForMessage('session-a', 'assistant-1')).toBeUndefined()
    expect(store.getNoteForMessage('session-b', 'assistant-1')).toEqual(sessionBNote)
  })

  it('updates in-memory state when upserting and deleting a note', async () => {
    const store = useAssistantInnerVoiceNoteStore()

    const saved = await store.upsertNote({
      messageId: 'assistant-1',
      sessionId: 'session-a',
      personaCardId: 'airi',
      userId: 'user-a',
      text: 'She wanted to ask him to stay, but said it more quietly.',
    })

    expect(store.getNoteForMessage('session-a', 'assistant-1')).toEqual(saved)

    const deleted = await store.deleteNoteForMessage('session-a', 'assistant-1')

    expect(deleted).toEqual(saved)
    expect(store.getNoteForMessage('session-a', 'assistant-1')).toBeUndefined()
  })

  it('deletes all cached notes for a session without clearing other sessions', async () => {
    const store = useAssistantInnerVoiceNoteStore()

    const first = await store.upsertNote({
      messageId: 'assistant-1',
      sessionId: 'session-a',
      personaCardId: 'airi',
      userId: 'user-a',
      text: 'Session A first note.',
    })
    const second = await store.upsertNote({
      messageId: 'assistant-2',
      sessionId: 'session-a',
      personaCardId: 'airi',
      userId: 'user-a',
      text: 'Session A second note.',
    })
    const otherSession = await store.upsertNote({
      messageId: 'assistant-b',
      sessionId: 'session-b',
      personaCardId: 'airi',
      userId: 'user-a',
      text: 'Session B note.',
    })

    const deleted = await store.deleteNotesForSession('session-a')

    expect(deleted).toEqual([first, second])
    expect(store.getNoteForMessage('session-a', 'assistant-1')).toBeUndefined()
    expect(store.getNoteForMessage('session-a', 'assistant-2')).toBeUndefined()
    expect(store.getNoteForMessage('session-b', 'assistant-b')).toEqual(otherSession)
    expect(store.allNotes).toEqual([otherSession])
  })

  it('generates a note on demand, tracks loading state, and reuses the saved note', async () => {
    const store = useAssistantInnerVoiceNoteStore()
    let resolveStream!: () => void
    const streamCompletion = new Promise<void>((resolve) => {
      resolveStream = resolve
    })
    const stream = vi.fn(async (_model, _provider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '心声：我有点不服气，' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '但还是想把话说好。' })
      await streamCompletion
    })

    const generating = store.ensureNoteForMessage({
      sessionId: 'session-a',
      messageId: 'assistant-1',
      userId: 'user-a',
      personaCardId: 'airi',
      userMessage: '你刚才那句很奇怪。',
      assistantText: '嗯，那句我收回。我重新说。',
      stream,
      model: 'test-model',
      chatProvider: {} as any,
      sceneMode,
      personaState,
      relationshipState,
    })
    const duplicate = store.ensureNoteForMessage({
      sessionId: 'session-a',
      messageId: 'assistant-1',
      userId: 'user-a',
      personaCardId: 'airi',
      userMessage: '你刚才那句很奇怪。',
      assistantText: '嗯，那句我收回。我重新说。',
      stream,
      model: 'test-model',
      chatProvider: {} as any,
      sceneMode,
      personaState,
      relationshipState,
    })

    await Promise.resolve()
    expect(store.isGeneratingNoteForMessage('session-a', 'assistant-1')).toBe(true)

    resolveStream()
    const [saved, duplicateSaved] = await Promise.all([generating, duplicate])

    expect(saved?.text).toBe('我有点不服气，但还是想把话说好。')
    expect(duplicateSaved).toEqual(saved)
    expect(store.getNoteForMessage('session-a', 'assistant-1')).toEqual(saved)
    expect(store.isGeneratingNoteForMessage('session-a', 'assistant-1')).toBe(false)
    expect(stream).toHaveBeenCalledOnce()
    expect(officialConsentMock.needsConsent).not.toHaveBeenCalled()

    const cached = await store.ensureNoteForMessage({
      sessionId: 'session-a',
      messageId: 'assistant-1',
      assistantText: '不会再次生成。',
      stream,
      model: 'test-model',
      chatProvider: {} as any,
      sceneMode,
      personaState,
      relationshipState,
    })

    expect(cached).toEqual(saved)
    expect(stream).toHaveBeenCalledOnce()
  })

  it('marks official cloud generation for bounded default-model billing only', async () => {
    const store = useAssistantInnerVoiceNoteStore()
    const stream = vi.fn(async (_model, _provider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '只把这点心思收好。' })
    })
    const officialProvider = {
      chat: vi.fn(() => ({ baseURL: 'http://127.0.0.1:3000/api/model-gateway/v1' })),
    } as any

    await store.ensureNoteForMessage({
      sessionId: 'session-official',
      messageId: 'assistant-official',
      userId: 'user-a',
      personaCardId: 'airi',
      userMessage: '你在想什么？',
      assistantText: '没什么。',
      stream,
      model: 'airi-smart',
      chatProvider: officialProvider,
      sceneMode,
      personaState,
      relationshipState,
    })

    expect(stream).toHaveBeenCalledWith(
      'airi-default',
      officialProvider,
      expect.any(Array),
      expect.objectContaining({ headers: { 'x-airi-feature': 'inner-voice-note' } }),
    )
  })

  it('does not generate an official inner voice note before consent', async () => {
    const store = useAssistantInnerVoiceNoteStore()
    const stream = vi.fn()
    const officialProvider = {
      chat: vi.fn(() => ({ baseURL: 'http://127.0.0.1:3000/api/model-gateway/v1' })),
    } as any
    officialConsentMock.needsConsent.mockReturnValue(true)

    const note = await store.ensureNoteForMessage({
      sessionId: 'session-unaccepted',
      messageId: 'assistant-unaccepted',
      assistantText: 'Visible reply.',
      stream,
      model: 'airi-smart',
      chatProvider: officialProvider,
      sceneMode,
      personaState,
      relationshipState,
    })

    expect(note).toBeNull()
    expect(officialConsentMock.getQuote).toHaveBeenCalledWith('inner-voice-note')
    expect(officialConsentMock.needsConsent).toHaveBeenCalledWith('user-a', 'inner-voice-note', { capability: 'inner-voice-note' })
    expect(stream).not.toHaveBeenCalled()
  })

  it('reuses a persisted note before generating after store state is reset', async () => {
    const persistedNote = createNote({
      text: 'She already wrote this down, so she should not regenerate it.',
    })
    repoMock.notes.set(repoMock.key(persistedNote.sessionId, persistedNote.messageId), persistedNote)

    const store = useAssistantInnerVoiceNoteStore()
    const stream = vi.fn()

    const note = await store.ensureNoteForMessage({
      sessionId: persistedNote.sessionId,
      messageId: persistedNote.messageId,
      assistantText: 'A visible reply that already has a saved note.',
      stream,
    })

    expect(note).toEqual(persistedNote)
    expect(store.getNoteForMessage(persistedNote.sessionId, persistedNote.messageId)).toEqual(persistedNote)
    expect(stream).not.toHaveBeenCalled()
  })
})
