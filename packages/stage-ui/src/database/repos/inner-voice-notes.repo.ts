import type {
  AiriAssistantInnerVoiceNote,
  AiriAssistantInnerVoiceNoteDraft,
} from '../../types/inner-voice-note'

import { nanoid } from 'nanoid'

import { isSessionMemoryWorkCancelled } from '../../stores/chat/session-memory-lifecycle'
import { storage } from '../storage'

const LOCAL_STORAGE_PREFIX = 'local:'
const INDEXEDDB_LOCAL_BASE_PREFIX = 'airi-local:'
const INNER_VOICE_NOTES_PREFIX = 'assistant-inner-voice-notes/by-message/'
const INNER_VOICE_NOTES_INDEXEDDB_ENUM_PREFIX = 'assistant-inner-voice-notes:by-message:'

function safeKeyPart(value: string) {
  return encodeURIComponent(value || 'default')
}

function sessionPrefix(sessionId: string) {
  return `${LOCAL_STORAGE_PREFIX}${INNER_VOICE_NOTES_PREFIX}${safeKeyPart(sessionId)}/`
}

function allNotesPrefix() {
  return `${LOCAL_STORAGE_PREFIX}${INNER_VOICE_NOTES_PREFIX}`
}

function noteKey(sessionId: string, messageId: string) {
  return `${sessionPrefix(sessionId)}${safeKeyPart(messageId)}`
}

function normalizeListedStorageKey(key: string) {
  // NOTICE: unstorage's IndexedDB driver stores keys with its physical base
  // (`airi-local:`), and key enumeration can expose both that base and
  // colon-separated IndexedDB keys. Exact reads still expect the logical
  // `local:assistant-inner-voice-notes/by-message/<session>/<message>` key.
  const mountedIndexedDBPrefix = `${LOCAL_STORAGE_PREFIX}${INDEXEDDB_LOCAL_BASE_PREFIX}`
  let normalizedKey = key
  if (normalizedKey.startsWith(mountedIndexedDBPrefix))
    normalizedKey = `${LOCAL_STORAGE_PREFIX}${normalizedKey.slice(mountedIndexedDBPrefix.length)}`

  if (normalizedKey.startsWith(INDEXEDDB_LOCAL_BASE_PREFIX))
    normalizedKey = `${LOCAL_STORAGE_PREFIX}${normalizedKey.slice(INDEXEDDB_LOCAL_BASE_PREFIX.length)}`

  if (normalizedKey.startsWith(INNER_VOICE_NOTES_PREFIX))
    normalizedKey = `${LOCAL_STORAGE_PREFIX}${normalizedKey}`

  const localIndexedDBEnumPrefix = `${LOCAL_STORAGE_PREFIX}${INNER_VOICE_NOTES_INDEXEDDB_ENUM_PREFIX}`
  if (normalizedKey.startsWith(localIndexedDBEnumPrefix)) {
    const rawParts = normalizedKey.slice(localIndexedDBEnumPrefix.length).split(':')
    const sessionId = rawParts.shift()
    const messageId = rawParts.join(':')
    if (sessionId && messageId)
      return `${LOCAL_STORAGE_PREFIX}${INNER_VOICE_NOTES_PREFIX}${sessionId}/${messageId}`
  }

  return normalizedKey
}

async function listNoteKeys(prefix: string) {
  const keys = await storage.getKeys(LOCAL_STORAGE_PREFIX)
  const normalizedKeys = keys.map(normalizeListedStorageKey)
  const filteredKeys = Array.from(new Set(
    normalizedKeys
      .filter(key => key.startsWith(prefix)),
  ))

  return filteredKeys
}

function normalizeNotes(notes: Array<AiriAssistantInnerVoiceNote | null>) {
  return notes
    .filter((note): note is AiriAssistantInnerVoiceNote => Boolean(note))
}

function normalizeNote(note?: AiriAssistantInnerVoiceNote | null): AiriAssistantInnerVoiceNote | null {
  if (!note)
    return null

  return {
    ...note,
    moodTags: Array.isArray(note.moodTags) ? [...note.moodTags] : undefined,
    visibleByDefault: false,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || note.createdAt || Date.now(),
  } satisfies AiriAssistantInnerVoiceNote
}

export const innerVoiceNotesRepo = {
  async getNote(sessionId: string, messageId: string) {
    return normalizeNote(
      await storage.getItemRaw<AiriAssistantInnerVoiceNote>(noteKey(sessionId, messageId)),
    )
  },

  async listNotesForSession(sessionId: string) {
    const keys = await listNoteKeys(sessionPrefix(sessionId))
    const loadedNotes = await Promise.all(keys.map(async (key) => {
      return normalizeNote(await storage.getItemRaw<AiriAssistantInnerVoiceNote>(key))
    }))
    const notes = normalizeNotes(loadedNotes)

    return notes.sort((left, right) => left.createdAt - right.createdAt)
  },

  async listAllNotes() {
    const keys = await listNoteKeys(allNotesPrefix())
    const loadedNotes = await Promise.all(keys.map(async (key) => {
      return normalizeNote(await storage.getItemRaw<AiriAssistantInnerVoiceNote>(key))
    }))
    const notes = normalizeNotes(loadedNotes)

    return notes.sort((left, right) => right.updatedAt - left.updatedAt)
  },

  async upsertNote(note: AiriAssistantInnerVoiceNoteDraft) {
    const now = Date.now()
    const existing = await this.getNote(note.sessionId, note.messageId)
    const nextNote = {
      ...existing,
      ...note,
      id: existing?.id || note.id || nanoid(),
      createdAt: existing?.createdAt || note.createdAt || now,
      updatedAt: now,
      visibleByDefault: false,
      moodTags: note.moodTags?.length ? [...note.moodTags] : undefined,
    } satisfies AiriAssistantInnerVoiceNote

    if (isSessionMemoryWorkCancelled(note.sessionId))
      throw new Error('Inner voice source session was deleted')
    await storage.setItemRaw(noteKey(nextNote.sessionId, nextNote.messageId), nextNote)
    if (isSessionMemoryWorkCancelled(note.sessionId)) {
      await storage.removeItem(noteKey(nextNote.sessionId, nextNote.messageId))
      throw new Error('Inner voice source session was deleted')
    }
    return nextNote
  },

  async deleteNoteForMessage(sessionId: string, messageId: string) {
    const existing = await this.getNote(sessionId, messageId)
    if (!existing)
      return undefined

    await storage.removeItem(noteKey(sessionId, messageId))
    return existing
  },

  async deleteNotesForSession(sessionId: string) {
    const notes = await this.listNotesForSession(sessionId)
    await Promise.all(notes.map(note => storage.removeItem(noteKey(note.sessionId, note.messageId))))

    return notes
  },

  async deleteNotesOlderThan(cutoff: number) {
    const notes = await this.listAllNotes()
    const expired = notes.filter(note => note.updatedAt < cutoff)
    await Promise.all(expired.map(note => storage.removeItem(noteKey(note.sessionId, note.messageId))))
    return expired
  },
}
