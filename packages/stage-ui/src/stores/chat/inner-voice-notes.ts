import type { ChatProvider } from '@xsai-ext/providers/utils'

import type {
  AiriAssistantInnerVoiceNote,
  AiriAssistantInnerVoiceNoteDraft,
} from '../../types/inner-voice-note'
import type { OfficialCapabilityConsentQuote } from '../settings/official-capability-consent'
import type { ChatTraceContext } from './chat-diagnostics'
import type { AiriInnerVoiceNoteGenerationInput } from './inner-voice-note-generator'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { innerVoiceNotesRepo } from '../../database/repos/inner-voice-notes.repo'
import { SERVER_URL } from '../../libs/auth'
import { useAuthStore } from '../auth'
import { useLLM } from '../llm'
import { useAiriCardStore } from '../modules/airi-card'
import { useConsciousnessStore } from '../modules/consciousness'
import { useOfficialPricingStore } from '../official-pricing'
import { useProvidersStore } from '../providers'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { useOfficialCapabilityConsentStore } from '../settings/official-capability-consent'
import { deriveAiriInnerVoiceMoodTags, generateAiriInnerVoiceNote, shouldPrewarmAiriInnerVoiceNote } from './inner-voice-note-generator'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { useChatPersonaRuntimeStore } from './persona-runtime-store'
import { createDefaultAiriPersonaState } from './persona-state'
import { isSessionMemoryWorkCancelled } from './session-memory-lifecycle'
import { useChatSessionStore } from './session-store'

interface EnsureAssistantInnerVoiceNoteInput {
  sessionId?: string
  messageId?: string
  userId?: string
  personaCardId?: string
  userMessage?: string
  assistantText: string
  /** Language resolved for the visible chat turn. */
  language?: string
  stream?: AiriInnerVoiceNoteGenerationInput['stream']
  model?: string
  chatProvider?: ChatProvider
  headers?: Record<string, string>
  abortSignal?: AbortSignal
  timeoutMs?: number
  sceneMode?: AiriSceneModeInference | null
  personaState?: AiriPersonaState | null
  relationshipState?: AiriPersonaRelationshipState | null
  replyIntent?: AiriReplyIntent
  trace?: ChatTraceContext
  requestOfficialUsageConsent?: (quote: OfficialCapabilityConsentQuote) => boolean | Promise<boolean>
  requireNote?: boolean
}

interface ResolvedGenerationClient {
  stream: AiriInnerVoiceNoteGenerationInput['stream']
  model: string
  chatProvider: ChatProvider
  headers?: Record<string, string>
  officialCloud: boolean
}

const NO_NOTE_GENERATED_MESSAGE = '模型没有返回可保存的心声札记，未写入。'
const OFFICIAL_CLOUD_INNER_VOICE_FEATURE_HEADER = 'x-airi-feature'

function logInnerVoiceWarn(label: string, details: Record<string, unknown>) {
  console.warn(`${label} ${JSON.stringify(details)}`)
}

function safeKeyPart(value: string) {
  return encodeURIComponent(value || 'default')
}

function sessionKeyPrefix(sessionId: string) {
  return `${safeKeyPart(sessionId)}/`
}

function messageKey(sessionId: string, messageId: string) {
  return `${sessionKeyPrefix(sessionId)}${safeKeyPart(messageId)}`
}

function normalizePersonaCardId(value?: string) {
  const normalized = value?.trim()
  if (!normalized || normalized === 'default')
    return undefined

  const scopedCardId = normalized.split('::card:').at(-1)?.trim()
  if (!scopedCardId || scopedCardId === 'default')
    return undefined

  return scopedCardId
}

function createFallbackSceneMode(): AiriSceneModeInference {
  return {
    mode: 'casual-chat',
    confidence: 'low',
    reason: 'Manual inner voice note generation uses the latest runtime state when available, otherwise this neutral fallback.',
    signals: ['manual-inner-voice'],
    alternatives: [],
  }
}

function createLinkedAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted)
      controller.abort('inner-voice-note-timeout')
  }, timeoutMs)
  const abortFromParent = () => {
    if (!controller.signal.aborted)
      controller.abort(parentSignal?.reason ?? 'parent-abort')
  }

  if (parentSignal?.aborted) {
    abortFromParent()
  }
  else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}

function hasHeaderEntries(headers?: Record<string, string>) {
  return headers && Object.keys(headers).length > 0
}

function getGenerationProviderBaseURL(model: string | undefined, chatProvider: ChatProvider | undefined) {
  if (!model || !chatProvider)
    return undefined

  try {
    const baseURL = chatProvider.chat(model).baseURL
    return typeof baseURL === 'string' ? baseURL : baseURL.toString()
  }
  catch {
    return undefined
  }
}

function isOfficialCloudGenerationClient(model: string, chatProvider: ChatProvider) {
  const baseURL = getGenerationProviderBaseURL(model, chatProvider)
  if (!baseURL)
    return false

  try {
    const actual = new URL(baseURL)
    const official = new URL('/api/model-gateway/v1', SERVER_URL)
    return actual.origin === official.origin
      && actual.pathname.replace(/\/+$/, '') === official.pathname.replace(/\/+$/, '')
  }
  catch {
    return false
  }
}

function formatGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|connect ECONNREFUSED|Failed to fetch|fetch failed|NetworkError/i.test(message))
    return `${message}；心声生成没有连上当前模型服务，未写入札记。`

  if (/abort|timeout/i.test(message))
    return `${message}；心声生成已中断或超时，未写入札记。`

  return message
}

function pickHeadersFromProviderConfig(config?: Record<string, unknown>) {
  const headers = config?.headers
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    return undefined

  return headers as Record<string, string>
}

function removeSessionState<T>(
  stateByMessageKey: Record<string, T>,
  sessionId: string,
) {
  const prefix = sessionKeyPrefix(sessionId)
  return Object.fromEntries(
    Object.entries(stateByMessageKey).filter(([key]) => !key.startsWith(prefix)),
  ) as Record<string, T>
}

function removeMessageKeyState<T>(
  stateByMessageKey: Record<string, T>,
  removedKeys: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(stateByMessageKey).filter(([key]) => !removedKeys.has(key)),
  ) as Record<string, T>
}

export const useAssistantInnerVoiceNoteStore = defineStore('assistant-inner-voice-notes', () => {
  const notesByMessageKey = shallowRef<Record<string, AiriAssistantInnerVoiceNote>>({})
  const allNotes = shallowRef<AiriAssistantInnerVoiceNote[]>([])
  const generatingByMessageKey = shallowRef<Record<string, boolean>>({})
  const generationErrorByMessageKey = shallowRef<Record<string, string>>({})
  const generationTasksByMessageKey = new Map<string, Promise<AiriAssistantInnerVoiceNote | null>>()

  async function pruneExpiredNotes() {
    const configuredDays = useMemoryAdvancedSettingsStore().settings.innerVoiceNoteRetentionDays
    const retentionDays = Math.max(1, Math.min(365, configuredDays))
    const expired = await innerVoiceNotesRepo.deleteNotesOlderThan(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const expiredKeys = new Set(expired.map(note => messageKey(note.sessionId, note.messageId)))
    notesByMessageKey.value = removeMessageKeyState(notesByMessageKey.value, expiredKeys)
    allNotes.value = allNotes.value.filter(note => !expiredKeys.has(messageKey(note.sessionId, note.messageId)))
    return expired
  }

  function getNoteForMessage(sessionId?: string, messageId?: string) {
    if (!sessionId || !messageId)
      return undefined

    return notesByMessageKey.value[messageKey(sessionId, messageId)]
  }

  function isGeneratingNoteForMessage(sessionId?: string, messageId?: string) {
    if (!sessionId || !messageId)
      return false

    return generatingByMessageKey.value[messageKey(sessionId, messageId)] === true
  }

  function getGenerationErrorForMessage(sessionId?: string, messageId?: string) {
    if (!sessionId || !messageId)
      return undefined

    return generationErrorByMessageKey.value[messageKey(sessionId, messageId)]
  }

  function setGenerating(key: string, generating: boolean) {
    const next = { ...generatingByMessageKey.value }
    if (generating) {
      next[key] = true
    }
    else {
      delete next[key]
    }
    generatingByMessageKey.value = next
  }

  function setGenerationError(key: string, error?: string) {
    const next = { ...generationErrorByMessageKey.value }
    if (error) {
      next[key] = error
    }
    else {
      delete next[key]
    }
    generationErrorByMessageKey.value = next
  }

  async function resolveGenerationClient(input: EnsureAssistantInnerVoiceNoteInput): Promise<ResolvedGenerationClient> {
    const fallbackStream = input.stream ?? useLLM().stream
    let model = input.model?.trim()
    let chatProvider = input.chatProvider
    let headers = input.headers

    if (!model || !chatProvider) {
      const consciousness = useConsciousnessStore()
      const providers = useProvidersStore()

      model ||= consciousness.activeModel
      if (!chatProvider) {
        if (!consciousness.activeProvider)
          throw new Error('Chat provider is not configured.')

        chatProvider = await providers.getProviderInstance<ChatProvider>(consciousness.activeProvider)
      }

      headers ||= pickHeadersFromProviderConfig(providers.getProviderConfig(consciousness.activeProvider))
    }

    if (!model)
      throw new Error('Chat model is not configured.')

    if (!chatProvider)
      throw new Error('Chat provider is not configured.')

    const officialCloud = isOfficialCloudGenerationClient(model, chatProvider)
    const client: ResolvedGenerationClient = {
      stream: fallbackStream,
      model: officialCloud ? 'airi-default' : model,
      chatProvider,
      officialCloud,
    }
    if (headers)
      client.headers = headers

    return client
  }

  function resolveGenerationRuntime(input: EnsureAssistantInnerVoiceNoteInput) {
    if (!input.sessionId) {
      return {
        sceneMode: input.sceneMode ?? createFallbackSceneMode(),
        personaState: input.personaState ?? createDefaultAiriPersonaState(),
        relationshipState: input.relationshipState ?? createDefaultAiriRelationshipState(),
      }
    }

    if (input.sceneMode && input.personaState && input.relationshipState) {
      return {
        sceneMode: input.sceneMode,
        personaState: input.personaState,
        relationshipState: input.relationshipState,
      }
    }

    const runtime = useChatPersonaRuntimeStore()
    return {
      sceneMode: input.sceneMode ?? runtime.getLatestSceneMode(input.sessionId) ?? createFallbackSceneMode(),
      personaState: input.personaState ?? runtime.getLatestPersonaState(input.sessionId) ?? createDefaultAiriPersonaState(),
      relationshipState: input.relationshipState ?? runtime.getLatestRelationshipState(input.sessionId) ?? createDefaultAiriRelationshipState(),
    }
  }

  function resolveNoteScope(input: EnsureAssistantInnerVoiceNoteInput) {
    const auth = input.userId ? undefined : useAuthStore()
    const chatSession = input.personaCardId || !input.sessionId ? undefined : useChatSessionStore()
    const canUseActiveCardFallback = !input.sessionId || chatSession?.activeSessionId === input.sessionId
    const airiCardStore = input.personaCardId || !canUseActiveCardFallback ? undefined : useAiriCardStore()
    const sessionPersonaCardId = input.sessionId ? chatSession?.getSessionMeta(input.sessionId)?.characterId : undefined

    return {
      userId: input.userId ?? auth?.userId ?? 'local',
      personaCardId: normalizePersonaCardId(input.personaCardId)
        ?? normalizePersonaCardId(sessionPersonaCardId)
        ?? normalizePersonaCardId(airiCardStore?.activeCardId)
        ?? 'default',
    }
  }

  async function hydrateSessionNotes(sessionId: string, _source = 'unknown') {
    if (!sessionId)
      return []

    const notes = await innerVoiceNotesRepo.listNotesForSession(sessionId)
    const next = removeSessionState(notesByMessageKey.value, sessionId)
    for (const note of notes)
      next[messageKey(note.sessionId, note.messageId)] = note

    notesByMessageKey.value = next
    allNotes.value = [
      ...notes,
      ...allNotes.value.filter(note => note.sessionId !== sessionId),
    ].sort((left, right) => right.updatedAt - left.updatedAt)

    return notes
  }

  async function hydrateAllNotes(_source = 'unknown') {
    await pruneExpiredNotes()
    const notes = await innerVoiceNotesRepo.listAllNotes()
    allNotes.value = notes

    notesByMessageKey.value = {
      ...notesByMessageKey.value,
      ...Object.fromEntries(notes.map(note => [messageKey(note.sessionId, note.messageId), note])),
    }

    return notes
  }

  async function upsertNote(note: AiriAssistantInnerVoiceNoteDraft) {
    const savedNote = await innerVoiceNotesRepo.upsertNote(note)
    cacheNote(savedNote)
    return savedNote
  }

  function cacheNote(savedNote: AiriAssistantInnerVoiceNote) {
    notesByMessageKey.value = {
      ...notesByMessageKey.value,
      [messageKey(savedNote.sessionId, savedNote.messageId)]: savedNote,
    }
    allNotes.value = [
      savedNote,
      ...allNotes.value.filter(note => messageKey(note.sessionId, note.messageId) !== messageKey(savedNote.sessionId, savedNote.messageId)),
    ].sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function ensureNoteForMessage(input: EnsureAssistantInnerVoiceNoteInput) {
    if (!input.sessionId || !input.messageId || !input.assistantText.trim() || isSessionMemoryWorkCancelled(input.sessionId))
      return null

    const scope = resolveNoteScope(input)
    const key = messageKey(input.sessionId, input.messageId)
    const existingNote = notesByMessageKey.value[key]
    if (existingNote?.text)
      return existingNote

    const persistedNote = await innerVoiceNotesRepo.getNote(input.sessionId, input.messageId)
    if (isSessionMemoryWorkCancelled(input.sessionId))
      return null
    if (persistedNote?.text) {
      cacheNote(persistedNote)
      return persistedNote
    }

    const existingTask = generationTasksByMessageKey.get(key)
    if (existingTask)
      return existingTask

    const runtime = resolveGenerationRuntime(input)
    if (!input.requireNote && !shouldPrewarmAiriInnerVoiceNote(runtime))
      return null

    const task = (async () => {
      setGenerating(key, true)
      setGenerationError(key)

      let linkedAbort: ReturnType<typeof createLinkedAbortSignal> | undefined
      let resolvedClient: ResolvedGenerationClient | undefined
      try {
        const client = await resolveGenerationClient(input)
        resolvedClient = client
        if (client.officialCloud) {
          const pricingStore = useOfficialPricingStore()
          const consentStore = useOfficialCapabilityConsentStore()
          if (!pricingStore.snapshot)
            await pricingStore.refresh()
          const quote = consentStore.getQuote('inner-voice-note')
          const userId = useAuthStore().user?.id
          if (consentStore.needsConsent(userId, 'inner-voice-note', quote)) {
            if (!quote) {
              if (input.requestOfficialUsageConsent)
                setGenerationError(key, '暂时无法获取心声的当前价格，请稍后重试。')
              return null
            }
            if (!input.requestOfficialUsageConsent)
              return null

            const approved = await input.requestOfficialUsageConsent(quote)
            if (!approved || !consentStore.accept(userId, 'inner-voice-note', quote))
              return null
          }
        }
        // NOTICE: Start the generation timeout only after any user consent dialog closes.
        // A blocking confirmation must not consume the model request's response budget.
        if (isSessionMemoryWorkCancelled(input.sessionId) || input.abortSignal?.aborted)
          return null
        linkedAbort = createLinkedAbortSignal(input.abortSignal, input.timeoutMs ?? 20_000)
        const generationInput: AiriInnerVoiceNoteGenerationInput = {
          stream: client.stream,
          model: client.model,
          chatProvider: client.chatProvider,
          abortSignal: linkedAbort.signal,
          userMessage: input.userMessage ?? '',
          assistantText: input.assistantText,
          language: input.language,
          sceneMode: runtime.sceneMode,
          personaState: runtime.personaState,
          relationshipState: runtime.relationshipState,
          trace: input.trace,
          requireNote: input.requireNote,
        }
        if (input.replyIntent)
          generationInput.replyIntent = input.replyIntent

        const headers = input.headers ?? client.headers
        if (client.officialCloud) {
          generationInput.headers = {
            ...headers,
            [OFFICIAL_CLOUD_INNER_VOICE_FEATURE_HEADER]: 'inner-voice-note',
          }
        }
        else if (hasHeaderEntries(headers)) {
          generationInput.headers = headers
        }

        const noteText = await generateAiriInnerVoiceNote(generationInput)
        if (!noteText || linkedAbort.signal.aborted || isSessionMemoryWorkCancelled(input.sessionId)) {
          setGenerationError(key, NO_NOTE_GENERATED_MESSAGE)
          return null
        }

        return await upsertNote({
          messageId: input.messageId!,
          sessionId: input.sessionId!,
          personaCardId: scope.personaCardId,
          userId: scope.userId,
          text: noteText,
          moodTags: deriveAiriInnerVoiceMoodTags(runtime),
        })
      }
      catch (error) {
        const message = formatGenerationError(error)
        setGenerationError(key, message)
        logInnerVoiceWarn('[InnerVoiceNotes] Failed to generate assistant inner voice note', {
          error: message,
          messageId: input.messageId,
          model: resolvedClient?.model ?? input.model,
          providerBaseURL: getGenerationProviderBaseURL(
            resolvedClient?.model ?? input.model,
            resolvedClient?.chatProvider ?? input.chatProvider,
          ),
          sessionId: input.sessionId,
        })
        throw error
      }
      finally {
        linkedAbort?.dispose()
        setGenerating(key, false)
        generationTasksByMessageKey.delete(key)
      }
    })()

    generationTasksByMessageKey.set(key, task)
    return task
  }

  async function deleteNoteForMessage(sessionId: string, messageId?: string) {
    if (!sessionId || !messageId)
      return undefined

    const deletedNote = await innerVoiceNotesRepo.deleteNoteForMessage(sessionId, messageId)
    const key = messageKey(sessionId, messageId)
    const removedKeys = new Set([key])
    notesByMessageKey.value = removeMessageKeyState(notesByMessageKey.value, removedKeys)
    generatingByMessageKey.value = removeMessageKeyState(generatingByMessageKey.value, removedKeys)
    generationErrorByMessageKey.value = removeMessageKeyState(generationErrorByMessageKey.value, removedKeys)
    allNotes.value = allNotes.value.filter(note => messageKey(note.sessionId, note.messageId) !== key)
    return deletedNote
  }

  async function deleteNotesForSession(sessionId: string) {
    if (!sessionId)
      return []

    const deletedNotes = await innerVoiceNotesRepo.deleteNotesForSession(sessionId)
    notesByMessageKey.value = removeSessionState(notesByMessageKey.value, sessionId)
    generatingByMessageKey.value = removeSessionState(generatingByMessageKey.value, sessionId)
    generationErrorByMessageKey.value = removeSessionState(generationErrorByMessageKey.value, sessionId)
    allNotes.value = allNotes.value.filter(note => note.sessionId !== sessionId)

    return deletedNotes
  }

  return {
    notesByMessageKey,
    allNotes,
    generatingByMessageKey,
    generationErrorByMessageKey,

    getNoteForMessage,
    isGeneratingNoteForMessage,
    getGenerationErrorForMessage,
    hydrateAllNotes,
    hydrateSessionNotes,
    upsertNote,
    ensureNoteForMessage,
    deleteNoteForMessage,
    deleteNotesForSession,
    pruneExpiredNotes,
  }
})
