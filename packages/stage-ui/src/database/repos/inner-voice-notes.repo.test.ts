import type { AiriAssistantInnerVoiceNoteDraft } from '../../types/inner-voice-note'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMock = vi.hoisted(() => {
  const data = new Map<string, unknown>()
  return {
    data,
    storage: {
      getItemRaw: vi.fn(async <T>(key: string) => data.get(key) as T | undefined),
      setItemRaw: vi.fn(async (key: string, value: unknown) => {
        data.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        data.delete(key)
      }),
      getKeys: vi.fn(async (prefix: string) => {
        return Array.from(data.keys()).filter(key => key.startsWith(prefix))
      }),
    },
  }
})

vi.mock('../storage', () => ({
  storage: storageMock.storage,
}))

const { innerVoiceNotesRepo } = await import('./inner-voice-notes.repo')

function createDraft(patch: Partial<AiriAssistantInnerVoiceNoteDraft> = {}): AiriAssistantInnerVoiceNoteDraft {
  return {
    messageId: 'assistant-1',
    sessionId: 'session-a',
    personaCardId: 'airi',
    userId: 'user-a',
    text: 'She wanted to answer lightly, but the worry stayed for a second.',
    ...patch,
  }
}

describe('innerVoiceNotesRepo', () => {
  it('deletes notes older than the configured retention cutoff', async () => {
    await innerVoiceNotesRepo.upsertNote(createDraft({ messageId: 'old' }))

    const deleted = await innerVoiceNotesRepo.deleteNotesOlderThan(Date.now() + 1)

    expect(deleted.map(note => note.messageId)).toEqual(['old'])
    expect(await innerVoiceNotesRepo.getNote('session-a', 'old')).toBeNull()
  })

  beforeEach(() => {
    storageMock.data.clear()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
  })

  it('stores and loads a note by session and assistant message', async () => {
    const saved = await innerVoiceNotesRepo.upsertNote(createDraft({
      moodTags: ['concern', 'reserved'],
    }))

    const loaded = await innerVoiceNotesRepo.getNote('session-a', 'assistant-1')

    expect(loaded).toEqual(saved)
    expect(loaded).toMatchObject({
      messageId: 'assistant-1',
      sessionId: 'session-a',
      personaCardId: 'airi',
      userId: 'user-a',
      text: 'She wanted to answer lightly, but the worry stayed for a second.',
      moodTags: ['concern', 'reserved'],
      visibleByDefault: false,
      createdAt: 1_000,
      updatedAt: 1_000,
    })
  })

  it('updates existing notes while preserving identity and created time', async () => {
    const first = await innerVoiceNotesRepo.upsertNote(createDraft())

    vi.setSystemTime(1_500)
    const updated = await innerVoiceNotesRepo.upsertNote(createDraft({
      text: 'She was a little hurt, so she kept the reply shorter than usual.',
      moodTags: ['hurt'],
    }))

    expect(updated.id).toBe(first.id)
    expect(updated.createdAt).toBe(1_000)
    expect(updated.updatedAt).toBe(1_500)
    expect(updated.text).toBe('She was a little hurt, so she kept the reply shorter than usual.')
    expect(updated.moodTags).toEqual(['hurt'])
  })

  it('lists notes for one session in creation order without prefix collisions', async () => {
    vi.setSystemTime(3_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-late',
      text: 'Later note.',
    }))

    vi.setSystemTime(1_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-early',
      text: 'Earlier note.',
    }))

    vi.setSystemTime(2_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-a-extra',
      messageId: 'assistant-other-session',
      text: 'This belongs to another session.',
    }))

    const notes = await innerVoiceNotesRepo.listNotesForSession('session-a')

    expect(notes.map(note => note.messageId)).toEqual(['assistant-early', 'assistant-late'])
  })

  it('lists notes when IndexedDB key enumeration includes the physical base prefix', async () => {
    vi.setSystemTime(1_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-a',
      text: 'Session A note.',
    }))

    vi.setSystemTime(2_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-b',
      messageId: 'assistant-b',
      text: 'Session B note.',
    }))

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(/^local:/, 'local:airi-local:'))
    })

    const sessionNotes = await innerVoiceNotesRepo.listNotesForSession('session-a')

    expect(sessionNotes.map(note => note.messageId)).toEqual(['assistant-a'])

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(/^local:/, 'local:airi-local:'))
    })

    const allNotes = await innerVoiceNotesRepo.listAllNotes()

    expect(allNotes.map(note => note.messageId)).toEqual(['assistant-b', 'assistant-a'])
  })

  it('lists notes when IndexedDB key enumeration omits the local mount prefix', async () => {
    vi.setSystemTime(1_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-a',
      text: 'Session A note.',
    }))

    vi.setSystemTime(2_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-b',
      messageId: 'assistant-b',
      text: 'Session B note.',
    }))

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(/^local:/, ''))
    })

    const sessionNotes = await innerVoiceNotesRepo.listNotesForSession('session-a')

    expect(sessionNotes.map(note => note.messageId)).toEqual(['assistant-a'])

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(/^local:/, ''))
    })

    const allNotes = await innerVoiceNotesRepo.listAllNotes()

    expect(allNotes.map(note => note.messageId)).toEqual(['assistant-b', 'assistant-a'])
  })

  it('lists notes when IndexedDB key enumeration uses colon-separated key paths', async () => {
    vi.setSystemTime(1_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-a',
      text: 'Session A note.',
    }))

    vi.setSystemTime(2_000)
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-b',
      messageId: 'assistant-b',
      text: 'Session B note.',
    }))

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key
          .replace(/^local:/, 'local:airi-local:')
          .replace('assistant-inner-voice-notes/by-message/', 'assistant-inner-voice-notes:by-message:')
          .replace(/\/([^/]+)$/, ':$1'))
    })

    const sessionNotes = await innerVoiceNotesRepo.listNotesForSession('session-a')

    expect(sessionNotes.map(note => note.messageId)).toEqual(['assistant-a'])

    storageMock.storage.getKeys.mockImplementationOnce(async (prefix: string) => {
      return Array.from(storageMock.data.keys())
        .filter(key => key.startsWith(prefix))
        .map(key => key
          .replace(/^local:/, 'local:airi-local:')
          .replace('assistant-inner-voice-notes/by-message/', 'assistant-inner-voice-notes:by-message:')
          .replace(/\/([^/]+)$/, ':$1'))
    })

    const allNotes = await innerVoiceNotesRepo.listAllNotes()

    expect(allNotes.map(note => note.messageId)).toEqual(['assistant-b', 'assistant-a'])
  })

  it('keeps the same assistant message id isolated across sessions', async () => {
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-a',
      messageId: 'same-message',
      text: 'Session A note.',
    }))
    await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-b',
      messageId: 'same-message',
      text: 'Session B note.',
    }))

    expect((await innerVoiceNotesRepo.getNote('session-a', 'same-message'))?.text).toBe('Session A note.')
    expect((await innerVoiceNotesRepo.getNote('session-b', 'same-message'))?.text).toBe('Session B note.')
  })

  it('deletes a note for a message', async () => {
    const saved = await innerVoiceNotesRepo.upsertNote(createDraft())

    const deleted = await innerVoiceNotesRepo.deleteNoteForMessage('session-a', 'assistant-1')

    expect(deleted).toEqual(saved)
    expect(await innerVoiceNotesRepo.getNote('session-a', 'assistant-1')).toBeNull()
  })

  it('deletes all notes for one session without removing other sessions', async () => {
    vi.setSystemTime(1_000)
    const first = await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-1',
      text: 'First session A note.',
    }))

    vi.setSystemTime(2_000)
    const second = await innerVoiceNotesRepo.upsertNote(createDraft({
      messageId: 'assistant-2',
      text: 'Second session A note.',
    }))

    vi.setSystemTime(1_500)
    const otherSession = await innerVoiceNotesRepo.upsertNote(createDraft({
      sessionId: 'session-b',
      messageId: 'assistant-b',
      text: 'Session B note.',
    }))

    const deleted = await innerVoiceNotesRepo.deleteNotesForSession('session-a')

    expect(deleted).toEqual([first, second])
    expect(await innerVoiceNotesRepo.getNote('session-a', 'assistant-1')).toBeNull()
    expect(await innerVoiceNotesRepo.getNote('session-a', 'assistant-2')).toBeNull()
    expect(await innerVoiceNotesRepo.getNote('session-b', 'assistant-b')).toEqual(otherSession)
  })
})
