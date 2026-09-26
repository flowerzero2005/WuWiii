import type { ChatHistoryItem } from '../../types/chat'
import type { ChatRoomParticipantSnapshot, ChatSessionMeta, ChatSessionRecord, ChatSessionsExport, ChatSessionsIndex } from '../../types/chat-session'
import type { GroupRoomScriptState } from './group-script'
import type { GroupScriptRuntimeCommand } from './group-script-runtime'

import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { client } from '../../composables/api'
import { useLocalFirstRequest } from '../../composables/use-local-first'
import { chatSessionsRepo } from '../../database/repos/chat-sessions.repo'
import { summarizeChatHistoryMessage } from '../../utils/chat-message-summary'
import { useAuthStore } from '../auth'
import { useAiriCardStore } from '../modules/airi-card'
import { getPersonaCardInitialGreeting } from '../modules/persona-package'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { useUserIdentityStore } from '../user-identity'
import { collectChatSyncCharacterIds, normalizeChatSyncCharacterId } from './chat-sync-members'
import { GROUP_CHAT_MAX_PARTICIPANTS, GROUP_CHAT_MIN_PARTICIPANTS, normalizeGroupParticipantIds } from './group-chat'
import { parseGroupRoomScriptState } from './group-script'
import { reduceGroupScriptRuntimeCommand } from './group-script-runtime'
import { useAssistantInnerVoiceNoteStore } from './inner-voice-notes'
import { withSessionRecordLock, withUserSessionIndexLock } from './session-record-lock'

interface DeleteSessionMessageTarget {
  messageId?: string
  index?: number
}

interface PersonaContactSessionSummary {
  characterId?: string
  id: string
  lastMessageAt?: number
  lastMessagePreview?: string
  unreadCount?: number
}

interface ChatSessionCrossWindowEvent {
  // 'chat-session-updated' is an additive sync (merge by identity). 'chat-session-reset'
  // is a destructive sync used by cleanup: it forces a full replace so a removal
  // actually propagates to other windows instead of being merged back in.
  type: 'chat-session-updated' | 'chat-session-reset'
  sessionId: string
  userId: string
  characterId: string
  meta: ChatSessionMeta
  messages: ChatHistoryItem[]
  /** Included only when a room script was changed; null means it was detached. */
  roomScript?: GroupRoomScriptState | null
}

export const useChatSessionStore = defineStore('chat-session', () => {
  const MAX_SESSIONS_IN_MEMORY = 6
  const PERSIST_DEBOUNCE_MS = 250

  const authStore = useAuthStore()
  const { userId, isAuthenticated } = storeToRefs(authStore)
  const airiCardStore = useAiriCardStore()
  const { activeCardId, systemPrompt } = storeToRefs(airiCardStore)
  const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
  const userIdentityStore = useUserIdentityStore()
  const { currentUserId } = storeToRefs(userIdentityStore)

  const activeSessionId = ref<string>('')
  const sessionMessages = ref<Record<string, ChatHistoryItem[]>>({})
  const sessionMetas = ref<Record<string, ChatSessionMeta>>({})
  const sessionGenerations = ref<Record<string, number>>({})
  const index = ref<ChatSessionsIndex | null>(null)
  const remoteSyncBlockedSessionIds = new Set<string>()
  const roomScriptCache = new Map<string, GroupRoomScriptState | undefined>()
  const staleRoomScriptSessionIds = new Set<string>()

  const ready = ref(false)
  const isReady = computed(() => ready.value)
  const initializing = ref(false)
  let initializePromise: Promise<void> | null = null
  let refreshFromPersistencePromise: Promise<void> | null = null
  let crossWindowChannel: BroadcastChannel | null = null

  let persistQueue = Promise.resolve()
  let syncQueue = Promise.resolve()
  const loadedSessions = new Set<string>()
  const loadingSessions = new Map<string, Promise<void>>()
  const sessionAccessOrder = new Map<string, number>()
  const scheduledSessionPersists = new Map<string, {
    timer: ReturnType<typeof setTimeout>
    promise: Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  }>()

  function ensureCrossWindowSync() {
    if (crossWindowChannel || typeof BroadcastChannel === 'undefined')
      return

    try {
      crossWindowChannel = new BroadcastChannel('airi-chat-session-sync')
      crossWindowChannel.onmessage = (event: MessageEvent<ChatSessionCrossWindowEvent>) => {
        const payload = event.data
        if ((payload?.type !== 'chat-session-updated' && payload?.type !== 'chat-session-reset') || payload.userId !== getCurrentUserId())
          return

        const isReset = payload.type === 'chat-session-reset'
        const incomingMeta = normalizeSessionMeta(payload.meta)

        // A reset (cleanup) must always win: skipping the freshness guard and replacing
        // wholesale is the point — otherwise a stale-but-recently-persisted window would
        // keep its old messages after another window cleaned the session.
        const currentMeta = sessionMetas.value[payload.sessionId]
        const incomingRevision = getRoomScriptRevision(incomingMeta)
        if (getRoomScriptRevision(currentMeta) !== incomingRevision)
          staleRoomScriptSessionIds.add(payload.sessionId)

        if (!isReset && currentMeta?.updatedAt && currentMeta.updatedAt > incomingMeta.updatedAt)
          return

        if (incomingRevision > 0 && incomingMeta.updatedAt > (currentMeta?.updatedAt ?? 0)) {
          staleRoomScriptSessionIds.add(payload.sessionId)
        }

        const currentMessages = sessionMessages.value[payload.sessionId] ?? []
        setSessionMeta(incomingMeta)
        sessionMessages.value[payload.sessionId] = isReset
          ? cloneSnapshot(payload.messages)
          : mergeSessionMessages(payload.messages, currentMessages)
        loadedSessions.add(payload.sessionId)
        // Bump the generation so any in-flight stream in this window for the reset
        // session is treated as stale and stops touching the cleared message list.
        if (isReset) {
          ensureGeneration(payload.sessionId)
          sessionGenerations.value[payload.sessionId] += 1
        }
        else {
          ensureGeneration(payload.sessionId)
        }
        // Room-script edits originate in a separate settings/quick-chat
        // renderer. Carry the validated snapshot in the broadcast so the
        // active chat can apply narration changes immediately instead of
        // waiting for a later IndexedDB refresh.
        if (Object.hasOwn(payload, 'roomScript') && incomingMeta.kind === 'room') {
          if (payload.roomScript === null) {
            roomScriptCache.set(payload.sessionId, undefined)
            staleRoomScriptSessionIds.delete(payload.sessionId)
          }
          else {
            try {
              const validated = payload.roomScript
                ? parseGroupRoomScriptState(payload.roomScript, getRoomParticipantIds(incomingMeta))
                : undefined
              roomScriptCache.set(payload.sessionId, validated ? cloneSnapshot(validated) : undefined)
              staleRoomScriptSessionIds.delete(payload.sessionId)
            }
            catch {
              // A concurrent participant change may make the payload stale;
              // leave it marked stale so resolveGroupRoomScript reloads the
              // authoritative persisted record.
              staleRoomScriptSessionIds.add(payload.sessionId)
            }
          }
        }
        touchSessionAccess(payload.sessionId)
      }
    }
    catch (error) {
      console.warn('[ChatSession] Cross-window sync unavailable:', error)
      crossWindowChannel = null
    }
  }

  function broadcastSessionUpdate(sessionId: string, meta: ChatSessionMeta, messages: ChatHistoryItem[], roomScript?: GroupRoomScriptState | null) {
    ensureCrossWindowSync()
    if (!crossWindowChannel)
      return

    try {
      crossWindowChannel.postMessage({
        type: 'chat-session-updated',
        sessionId,
        userId: getCurrentUserId(),
        characterId: meta.characterId,
        meta: cloneSnapshot(meta),
        messages: cloneSnapshot(messages),
        ...(roomScript !== undefined ? { roomScript: roomScript === null ? null : cloneSnapshot(roomScript) } : {}),
      } satisfies ChatSessionCrossWindowEvent)
    }
    catch (error) {
      console.warn('[ChatSession] Failed to broadcast session update:', error)
    }
  }

  function broadcastSessionReset(sessionId: string, meta: ChatSessionMeta, messages: ChatHistoryItem[]) {
    ensureCrossWindowSync()
    if (!crossWindowChannel)
      return

    try {
      crossWindowChannel.postMessage({
        type: 'chat-session-reset',
        sessionId,
        userId: getCurrentUserId(),
        characterId: meta.characterId,
        meta: cloneSnapshot(meta),
        messages: cloneSnapshot(messages),
      } satisfies ChatSessionCrossWindowEvent)
    }
    catch (error) {
      console.warn('[ChatSession] Failed to broadcast session reset:', error)
    }
  }

  // I know this nu uh, better than loading all language on rehypeShiki
  const codeBlockSystemPrompt = '- For any programming code block, always specify the programming language that supported on @shikijs/rehype on the rendered markdown, eg. ```python ... ```\n'
  const mathSyntaxSystemPrompt = '- For any math equation, use LaTeX format, eg: $ x^3 $, always escape dollar sign outside math equation\n'

  // Watch systemPrompt changes and update only the active in-memory session.
  // Other sessions are repaired lazily in ensureSession() when the user visits them.
  watch(systemPrompt, () => {
    if (!activeSessionId.value)
      return

    const meta = getSessionMeta(activeSessionId.value)
    if (meta?.kind === 'room')
      return

    const currentSystemPrompt = resolveSessionSystemPrompt(activeSessionId.value)

    const messages = sessionMessages.value[activeSessionId.value]
    if (messages?.length > 0 && messages[0]?.role === 'system' && messages[0].content !== currentSystemPrompt) {
      messages[0] = {
        ...messages[0],
        content: currentSystemPrompt,
      }
      void persistSessionMessages(activeSessionId.value)
    }
  })

  function getBaseUserId() {
    return userId.value || 'local'
  }

  function usesScopedLocalUser() {
    return memoryAdvancedSettings.settings.enableMultiUser
  }

  function getCurrentUserId() {
    if (usesScopedLocalUser()) {
      return currentUserId.value || 'default'
    }

    return getBaseUserId()
  }

  async function resolveCurrentUserId() {
    if (usesScopedLocalUser()) {
      return await userIdentityStore.identifyUser()
    }

    return getBaseUserId()
  }

  function getCurrentCharacterId() {
    return activeCardId.value || 'default'
  }

  function touchSessionAccess(sessionId: string) {
    sessionAccessOrder.set(sessionId, Date.now())
  }

  function evictInactiveSessions(keepSessionIds: string[] = []) {
    const keep = new Set<string>([activeSessionId.value, ...keepSessionIds].filter(Boolean))

    if (loadedSessions.size <= MAX_SESSIONS_IN_MEMORY)
      return

    const candidates = Array.from(loadedSessions)
      .filter(sessionId => !keep.has(sessionId))
      .filter(sessionId => !loadingSessions.has(sessionId))
      .filter(sessionId => !scheduledSessionPersists.has(sessionId))
      .sort((left, right) => (sessionAccessOrder.get(left) ?? 0) - (sessionAccessOrder.get(right) ?? 0))

    const toEvict = loadedSessions.size - MAX_SESSIONS_IN_MEMORY
    for (const sessionId of candidates.slice(0, toEvict)) {
      delete sessionMessages.value[sessionId]
      roomScriptCache.delete(sessionId)
      staleRoomScriptSessionIds.delete(sessionId)
      loadedSessions.delete(sessionId)
      sessionAccessOrder.delete(sessionId)
    }
  }

  function enqueuePersist(task: () => Promise<void>) {
    persistQueue = persistQueue.then(task, task)
    return persistQueue
  }

  function enqueueSync(task: () => Promise<void>) {
    syncQueue = syncQueue.then(task, task)
    return syncQueue
  }

  function sanitizeSnapshotValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value == null)
      return value

    if (typeof value === 'function' || typeof value === 'symbol')
      return undefined

    if (value instanceof Date)
      return value.toISOString()

    if (value instanceof URL)
      return value.toString()

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }

    if (typeof Window !== 'undefined' && value instanceof Window)
      return '[Window]'

    if (typeof Document !== 'undefined' && value instanceof Document)
      return '[Document]'

    if (typeof Node !== 'undefined' && value instanceof Node)
      return '[DOMNode]'

    if (Array.isArray(value))
      return value.map(item => sanitizeSnapshotValue(item, seen))

    if (typeof value === 'object') {
      if (seen.has(value as object))
        return '[Circular]'

      seen.add(value as object)

      const sanitizedObject: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const sanitizedEntry = sanitizeSnapshotValue(entry, seen)
        if (sanitizedEntry !== undefined)
          sanitizedObject[key] = sanitizedEntry
      }

      seen.delete(value as object)
      return sanitizedObject
    }

    return value
  }

  function cloneSnapshot<T>(value: T): T {
    try {
      if (typeof structuredClone === 'function')
        return structuredClone(value)
    }
    catch {
      // NOTICE: Chat snapshots may temporarily contain browser-native objects from
      // tool results or UI-adjacent metadata. Chromium throws on structuredClone
      // for values like Window/DOM nodes, so we fall back to a JSON-safe sanitizer
      // instead of breaking the whole chat turn during persistence.
    }

    return sanitizeSnapshotValue(value) as T
  }

  function enqueueSessionPersist(sessionId: string, task: () => Promise<void>, ownerId = sessionMetas.value[sessionId]?.userId ?? getCurrentUserId()) {
    return enqueuePersist(() => withSessionRecordLock(sessionId, () => withUserSessionIndexLock(ownerId, task)))
  }

  function isValidRoomScriptRevision(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0
  }

  function getRoomScriptRevision(meta?: ChatSessionMeta) {
    return isValidRoomScriptRevision(meta?.roomScriptRevision) ? meta.roomScriptRevision : 0
  }

  function normalizeSessionMeta(meta: ChatSessionMeta): ChatSessionMeta {
    if (meta.roomScriptRevision === undefined || isValidRoomScriptRevision(meta.roomScriptRevision))
      return meta

    const { roomScriptRevision: _invalidRevision, ...normalizedMeta } = meta
    return normalizedMeta
  }

  function getRoomParticipantIds(meta: ChatSessionMeta) {
    if (meta.kind !== 'room')
      return []
    return meta.participants?.map(participant => participant.characterId) ?? []
  }

  function validateRecordRoomScript(record: ChatSessionRecord) {
    const meta = normalizeSessionMeta(record.meta)
    if (!record.roomScript || meta.kind !== 'room' || !isValidRoomScriptRevision(meta.roomScriptRevision))
      return undefined

    try {
      return parseGroupRoomScriptState(record.roomScript, getRoomParticipantIds(meta))
    }
    catch {
      return undefined
    }
  }

  function normalizeSessionRecord(record: ChatSessionRecord): ChatSessionRecord {
    let meta = normalizeSessionMeta(record.meta)
    // Room scripts created before revision tracking was introduced have a
    // valid snapshot but no `roomScriptRevision`. Assign the initial revision
    // while normalizing so refreshes do not silently discard narration
    // settings; subsequent writes continue the monotonic revision sequence.
    if (meta.kind === 'room' && record.roomScript && meta.roomScriptRevision === undefined)
      meta = { ...meta, roomScriptRevision: 1 }
    const roomScript = validateRecordRoomScript({ ...record, meta })
    return {
      meta,
      messages: record.messages,
      ...(roomScript ? { roomScript } : {}),
    }
  }

  function cacheRoomScriptFromRecord(sessionId: string, record: ChatSessionRecord) {
    const roomScript = validateRecordRoomScript(record)
    roomScriptCache.set(sessionId, roomScript ? cloneSnapshot(roomScript) : undefined)
    staleRoomScriptSessionIds.delete(sessionId)
    return roomScript
  }

  function setSessionMeta(meta: ChatSessionMeta) {
    const normalizedMeta = normalizeSessionMeta(meta)
    sessionMetas.value[normalizedMeta.sessionId] = normalizedMeta
    const characterIndex = index.value?.characters?.[normalizedMeta.characterId]
    if (characterIndex)
      characterIndex.sessions[normalizedMeta.sessionId] = normalizedMeta
  }

  function nextRoomScriptRevision(...metas: Array<ChatSessionMeta | undefined>) {
    const revision = Math.max(0, ...metas.map(getRoomScriptRevision))
    if (revision >= Number.MAX_SAFE_INTEGER)
      throw new Error('Group room script revision limit reached.')
    return revision + 1
  }

  function snapshotMessages(messages: ChatHistoryItem[]) {
    return cloneSnapshot(messages)
  }

  function extractMessageContent(message: ChatHistoryItem) {
    const summary = summarizeChatHistoryMessage(message, {
      maxLength: 2_000,
      toolLimit: 8,
    })

    return summary === '[无内容]' ? '' : summary
  }

  function getSessionPreview(sessionId: string, meta: ChatSessionMeta) {
    if (meta.title?.trim())
      return meta.title

    const messages = sessionMessages.value[sessionId] ?? []
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (!message || message.role === 'system')
        continue

      const preview = summarizeChatHistoryMessage(message, {
        maxLength: 80,
        toolLimit: 1,
      }).trim()

      return preview || undefined
    }

    return undefined
  }

  function getMessageIdentity(message: ChatHistoryItem) {
    return message.id || `${message.role}:${message.createdAt ?? ''}:${extractMessageContent(message)}`
  }

  function mergeSessionMessages(storedMessages: ChatHistoryItem[], currentMessages: ChatHistoryItem[]) {
    if (currentMessages.length === 0)
      return storedMessages

    if (storedMessages.length === 0)
      return currentMessages

    const merged = [...storedMessages]
    const seen = new Set(storedMessages.map(getMessageIdentity))

    for (const message of currentMessages) {
      const identity = getMessageIdentity(message)
      if (seen.has(identity))
        continue

      seen.add(identity)
      merged.push(message)
    }

    return merged.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }

  function hasIndexedSession(sessionId: string) {
    if (!index.value)
      return false

    return Object.values(index.value.characters ?? {}).some(character => Boolean(character.sessions[sessionId]))
  }

  function getIndexedSessionMeta(sessionId: string) {
    if (!index.value)
      return undefined

    for (const character of Object.values(index.value.characters ?? {})) {
      const meta = character.sessions[sessionId]
      if (meta)
        return meta
    }
  }

  function ensureSessionMessageIds(sessionId: string) {
    const current = sessionMessages.value[sessionId] ?? []
    let changed = false
    const next = current.map((message) => {
      if (message.id)
        return message
      changed = true
      return {
        ...message,
        id: nanoid(),
      }
    })

    if (changed)
      sessionMessages.value[sessionId] = next

    return next
  }

  function buildSyncMessages(messages: ChatHistoryItem[]) {
    return messages.map(message => ({
      id: message.id ?? nanoid(),
      role: message.role,
      content: extractMessageContent(message),
      characterId: message.role === 'assistant'
        ? normalizeChatSyncCharacterId(message.metadata?.speaker?.characterId)
        : undefined,
      createdAt: message.createdAt,
    }))
  }

  async function syncSessionToRemote(sessionId: string) {
    if (remoteSyncBlockedSessionIds.has(sessionId))
      return

    let cachedRecord: ChatSessionRecord | null | undefined
    const request = useLocalFirstRequest({
      local: async () => {
        cachedRecord = await chatSessionsRepo.getSession(sessionId)
        return cachedRecord
      },
      remote: async () => {
        if (!cachedRecord)
          cachedRecord = await chatSessionsRepo.getSession(sessionId)
        if (!cachedRecord)
          return cachedRecord

        await withSessionRecordLock(sessionId, async () => {
          cachedRecord = await chatSessionsRepo.getSession(sessionId)
          if (!cachedRecord)
            return
          const normalizedMessages = cachedRecord.messages.map(message => message.id ? message : { ...message, id: nanoid() })
          if (normalizedMessages.some((message, index) => cachedRecord?.messages[index]?.id !== message.id)) {
            cachedRecord = { ...cachedRecord, messages: normalizedMessages }
            await chatSessionsRepo.saveSession(sessionId, cachedRecord)
          }
        })
        if (!cachedRecord)
          return cachedRecord

        const normalizedMessages = cachedRecord.messages
        const members: Array<
          | { type: 'user', userId: string }
          | { type: 'character', characterId: string }
        > = [
          { type: 'user', userId: userId.value },
        ]

        const participantIds = cachedRecord.meta.kind === 'room'
          ? cachedRecord.meta.participants?.map(participant => participant.characterId) ?? []
          : [cachedRecord.meta.characterId]

        for (const characterId of collectChatSyncCharacterIds(participantIds, normalizedMessages))
          members.push({ type: 'character', characterId })

        const res = await client.api.chats.sync.$post({
          json: {
            chat: {
              id: cachedRecord.meta.sessionId,
              type: 'group',
              title: cachedRecord.meta.title,
              createdAt: cachedRecord.meta.createdAt,
              updatedAt: cachedRecord.meta.updatedAt,
            },
            members,
            messages: buildSyncMessages(normalizedMessages),
          },
        })

        if (!res.ok) {
          const details = (await res.text()).trim()
          if (res.status === 403) {
            // A remote chat id can already belong to another account. Keep the
            // local-first session usable and stop retrying the same forbidden id.
            remoteSyncBlockedSessionIds.add(sessionId)
            return cachedRecord
          }
          throw new Error(`Failed to sync chat session (HTTP ${res.status})${details ? `: ${details}` : ''}`)
        }
        return cachedRecord
      },
      allowRemote: () => isAuthenticated.value,
      lazy: true,
    })

    await request.execute()
    if (request.error.value)
      throw request.error.value
  }

  function scheduleSync(sessionId: string) {
    void enqueueSync(async () => {
      try {
        await syncSessionToRemote(sessionId)
      }
      catch (error) {
        console.warn('Failed to sync chat session', error)
      }
    })
  }

  function generateInitialMessageFromPrompt(prompt: string) {
    const content = codeBlockSystemPrompt + mathSyntaxSystemPrompt + prompt

    return {
      role: 'system',
      content,
      id: nanoid(),
      createdAt: Date.now(),
    } satisfies ChatHistoryItem
  }

  function resolvePersonaSystemPrompt(characterId: string) {
    return airiCardStore.getCardRuntime(characterId)?.systemPrompt
      ?? airiCardStore.getCardRuntime('default')?.systemPrompt
      ?? systemPrompt.value
  }

  function resolveSessionSystemPrompt(sessionId: string, personaSystemPrompt?: string) {
    const characterId = getSessionMeta(sessionId)?.characterId ?? getCurrentCharacterId()
    return codeBlockSystemPrompt + mathSyntaxSystemPrompt + (personaSystemPrompt ?? resolvePersonaSystemPrompt(characterId))
  }

  function generateInitialMessages(characterId = getCurrentCharacterId(), personaSystemPrompt?: string) {
    const card = airiCardStore.getCard(characterId)
    const runtime = airiCardStore.getCardRuntime(characterId)
    const messages: ChatHistoryItem[] = [generateInitialMessageFromPrompt(
      personaSystemPrompt ?? runtime?.systemPrompt ?? resolvePersonaSystemPrompt(characterId),
    )]
    const greeting = getPersonaCardInitialGreeting(card)
    if (greeting) {
      messages.push({
        role: 'assistant',
        content: greeting,
        slices: [],
        tool_results: [],
        id: nanoid(),
        createdAt: Date.now(),
        metadata: runtime
          ? {
              speaker: {
                avatarUrl: runtime.avatarUrl,
                characterId: runtime.characterId,
                displayName: runtime.displayName,
              },
            }
          : undefined,
      })
    }
    return messages
  }

  function ensureGeneration(sessionId: string) {
    if (sessionGenerations.value[sessionId] === undefined)
      sessionGenerations.value[sessionId] = 0
  }

  async function migrateIndexForScopedUser(targetUserId: string) {
    if (!usesScopedLocalUser())
      return

    const sourceUserId = getBaseUserId()
    if (!sourceUserId || sourceUserId === targetUserId)
      return

    const existingTargetIndex = await chatSessionsRepo.getIndex(targetUserId)
    if (existingTargetIndex)
      return

    const sourceIndex = await chatSessionsRepo.getIndex(sourceUserId)
    if (!sourceIndex)
      return

    const nextIndex: ChatSessionsIndex = {
      userId: targetUserId,
      characters: {},
    }

    for (const [characterId, characterIndex] of Object.entries(sourceIndex.characters)) {
      const nextSessions: Record<string, ChatSessionMeta> = {}
      let nextActiveSessionId = ''

      for (const [sourceSessionId, sourceMeta] of Object.entries(characterIndex.sessions)) {
        const sourceRecord = await chatSessionsRepo.getSession(sourceSessionId)
        if (!sourceRecord)
          continue

        const normalizedSourceRecord = normalizeSessionRecord(sourceRecord)
        const nextSessionId = nanoid()
        const nextMeta: ChatSessionMeta = {
          ...normalizeSessionMeta(sourceMeta),
          sessionId: nextSessionId,
          userId: targetUserId,
          characterId,
        }

        const nextRecord: ChatSessionRecord = {
          meta: nextMeta,
          messages: cloneSnapshot(normalizedSourceRecord.messages),
          ...(normalizedSourceRecord.roomScript ? { roomScript: cloneSnapshot(normalizedSourceRecord.roomScript) } : {}),
        }

        nextSessions[nextSessionId] = nextMeta
        if (characterIndex.activeSessionId === sourceSessionId)
          nextActiveSessionId = nextSessionId

        await enqueueSessionPersist(nextSessionId, () => chatSessionsRepo.saveSession(nextSessionId, nextRecord))
      }

      const availableSessionIds = Object.keys(nextSessions)
      if (availableSessionIds.length === 0)
        continue

      nextIndex.characters[characterId] = {
        activeSessionId: nextActiveSessionId || availableSessionIds[0],
        sessions: nextSessions,
      }
    }

    await enqueuePersist(() => withUserSessionIndexLock(targetUserId, async () => {
      if (!await chatSessionsRepo.getIndex(targetUserId))
        await chatSessionsRepo.saveIndex(nextIndex)
    }))
  }

  function normalizeSessionsIndex(stored: ChatSessionsIndex, currentUserId: string): ChatSessionsIndex {
    const characters: ChatSessionsIndex['characters'] = {}
    for (const [characterId, character] of Object.entries(stored.characters ?? {})) {
      const sessions: Record<string, ChatSessionMeta> = {}
      for (const [sessionId, meta] of Object.entries(character.sessions ?? {}))
        sessions[sessionId] = normalizeSessionMeta(meta)
      characters[characterId] = { ...character, sessions }
    }

    return { ...stored, userId: currentUserId, characters }
  }

  async function loadIndexForUser(currentUserId: string) {
    let stored = await chatSessionsRepo.getIndex(currentUserId)
    if (!stored && usesScopedLocalUser()) {
      await migrateIndexForScopedUser(currentUserId)
      stored = await chatSessionsRepo.getIndex(currentUserId)
    }

    // Local indexes written by older builds can omit `characters`. Normalize
    // that persisted shape before any session creation or eviction touches it.
    index.value = stored
      ? normalizeSessionsIndex(stored, currentUserId)
      : {
          userId: currentUserId,
          characters: {},
        }
  }

  function getCharacterIndex(characterId: string) {
    if (!index.value)
      return null
    // Older local indexes may omit `characters`; treat them as empty so the
    // renderer can initialize and rebuild the active session instead of
    // crashing during startup.
    return index.value.characters?.[characterId] ?? null
  }

  function adoptPersistedIndex(latest: ChatSessionsIndex) {
    if (index.value?.userId === latest.userId || (!index.value && getCurrentUserId() === latest.userId))
      index.value = cloneSnapshot(latest)
  }

  async function latestSessionIndex(ownerId: string) {
    const stored = await chatSessionsRepo.getIndex(ownerId)
    return normalizeSessionsIndex(stored ?? { userId: ownerId, characters: {} }, ownerId)
  }

  function forgetMissingSession(sessionId: string, replacementActiveSessionId = '') {
    delete sessionMetas.value[sessionId]
    delete sessionMessages.value[sessionId]
    roomScriptCache.delete(sessionId)
    staleRoomScriptSessionIds.delete(sessionId)
    loadedSessions.delete(sessionId)
    loadingSessions.delete(sessionId)
    sessionAccessOrder.delete(sessionId)
    if (Object.hasOwn(sessionGenerations.value, sessionId))
      sessionGenerations.value[sessionId] += 1
    if (activeSessionId.value === sessionId)
      activeSessionId.value = replacementActiveSessionId
  }

  /** Called inside the session -> user-index locks. Only insert creates membership. */
  async function saveSessionWithIndex(record: ChatSessionRecord, options?: { insert?: boolean, setActive?: boolean }) {
    const meta = record.meta
    const latest = await latestSessionIndex(meta.userId)
    const existing = latest.characters[meta.characterId]
    if (!options?.insert && !existing?.sessions[meta.sessionId]) {
      adoptPersistedIndex(latest)
      forgetMissingSession(meta.sessionId, existing?.activeSessionId)
      return false
    }
    const characterIndex = existing ?? { activeSessionId: meta.sessionId, sessions: {} }
    characterIndex.sessions[meta.sessionId] = cloneSnapshot(meta)
    if (options?.setActive)
      characterIndex.activeSessionId = meta.sessionId
    latest.characters[meta.characterId] = characterIndex
    await chatSessionsRepo.saveSession(meta.sessionId, record)
    try {
      await chatSessionsRepo.saveIndex(latest)
    }
    catch (error) {
      // The record is durable already. Reload it before another script action;
      // a retry must repair metadata without repeating the durable command.
      staleRoomScriptSessionIds.add(meta.sessionId)
      throw error
    }
    adoptPersistedIndex(latest)
    return true
  }

  async function persistActiveSession(characterId: string, sessionId: string) {
    const ownerId = index.value?.userId
    if (!ownerId)
      return
    await enqueuePersist(() => withUserSessionIndexLock(ownerId, async () => {
      const latest = await latestSessionIndex(ownerId)
      const character = latest.characters[characterId]
      if (character?.sessions[sessionId]) {
        character.activeSessionId = sessionId
        await chatSessionsRepo.saveIndex(latest)
      }
      else {
        forgetMissingSession(sessionId, character?.activeSessionId)
      }
      adoptPersistedIndex(latest)
    }))
  }

  async function deleteSessionWithIndex(sessionId: string, ownerId: string) {
    const latest = await latestSessionIndex(ownerId)
    for (const [characterId, character] of Object.entries(latest.characters)) {
      if (!character.sessions[sessionId])
        continue
      delete character.sessions[sessionId]
      if (character.activeSessionId === sessionId)
        character.activeSessionId = Object.keys(character.sessions)[0] ?? ''
      if (Object.keys(character.sessions).length === 0)
        delete latest.characters[characterId]
    }
    await chatSessionsRepo.deleteSession(sessionId)
    try {
      await chatSessionsRepo.saveIndex(latest)
    }
    catch (error) {
      adoptPersistedIndex(latest)
      forgetMissingSession(sessionId)
      throw error
    }
    adoptPersistedIndex(latest)
  }

  /** Repair only existing membership, inside the session -> user-index locks. */
  async function reconcileSessionIndex(sessionId: string, ownerId: string, record?: ChatSessionRecord) {
    const latest = await latestSessionIndex(ownerId)
    let member = false
    let changed = false
    for (const [characterId, character] of Object.entries(latest.characters)) {
      const meta = character.sessions[sessionId]
      if (!meta)
        continue
      if (record?.meta.userId === ownerId && record.meta.characterId === characterId) {
        member = true
        if (JSON.stringify(meta) !== JSON.stringify(record.meta)) {
          character.sessions[sessionId] = cloneSnapshot(record.meta)
          changed = true
        }
      }
      else {
        delete character.sessions[sessionId]
        if (character.activeSessionId === sessionId)
          character.activeSessionId = Object.keys(character.sessions)[0] ?? ''
        changed = true
      }
    }
    if (changed)
      await chatSessionsRepo.saveIndex(latest)
    adoptPersistedIndex(latest)
    if (!member)
      forgetMissingSession(sessionId)
    return member
  }

  async function persistSessionNow(sessionId: string) {
    if (!sessionMetas.value[sessionId])
      return
    let savedRecord: ChatSessionRecord | undefined

    await enqueueSessionPersist(sessionId, async () => {
      // Capture the latest in-memory state when this queued write actually
      // runs. Group speakers stage their bubbles while earlier speech/typing
      // work is still draining; taking a snapshot before entering the
      // persistence queue lets an older write overwrite those later speaker
      // messages (most visible with three or more responders).
      const requestedMeta = sessionMetas.value[sessionId]
      if (!requestedMeta)
        return
      const messages = snapshotMessages(ensureSessionMessageIds(sessionId))
      const persistedRaw = await chatSessionsRepo.getSession(sessionId)
      const persisted = persistedRaw ? normalizeSessionRecord(persistedRaw) : undefined
      const persistedRevision = getRoomScriptRevision(persisted?.meta)
      const requestedRevision = getRoomScriptRevision(requestedMeta)
      const localCacheIsFresh = roomScriptCache.has(sessionId) && !staleRoomScriptSessionIds.has(sessionId)

      let roomScript = localCacheIsFresh ? roomScriptCache.get(sessionId) : undefined
      let roomScriptRevision = requestedMeta.roomScriptRevision
      if (persisted && (persistedRevision > requestedRevision || !localCacheIsFresh)) {
        roomScript = validateRecordRoomScript(persisted)
        roomScriptRevision = persisted.meta.roomScriptRevision
      }
      // A window that has not yet received a chapter transition must retain
      // its newly committed announcement. Ordinary message deletion keeps its
      // existing semantics once this window has the current script revision.
      if (persisted && persistedRevision > requestedRevision) {
        for (const message of persisted.messages) {
          if (message.id?.startsWith('script-act:') && !messages.some(item => item.id === message.id))
            messages.push(message)
        }
      }

      const updatedMeta = normalizeSessionMeta({
        ...requestedMeta,
        ...(roomScriptRevision === undefined ? {} : { roomScriptRevision }),
        updatedAt: Math.max(Date.now(), requestedMeta.updatedAt, persisted?.meta.updatedAt ?? 0),
      })
      savedRecord = {
        meta: cloneSnapshot(updatedMeta),
        messages,
        ...(roomScript ? { roomScript: cloneSnapshot(roomScript) } : {}),
      }
      if (!await saveSessionWithIndex(savedRecord)) {
        savedRecord = undefined
        return
      }
      setSessionMeta(updatedMeta)
      roomScriptCache.set(sessionId, roomScript ? cloneSnapshot(roomScript) : undefined)
      staleRoomScriptSessionIds.delete(sessionId)
    })

    if (!savedRecord)
      return
    // NOTICE: Snapshotting a long chat for BroadcastChannel can delay the provider request.
    // Keep durable persistence awaited, but move cross-window UI sync off the send critical path.
    setTimeout(() => broadcastSessionUpdate(sessionId, savedRecord!.meta, savedRecord!.messages), 0)
    scheduleSync(sessionId)
  }

  async function flushScheduledSessionPersist(sessionId: string) {
    const scheduled = scheduledSessionPersists.get(sessionId)
    if (scheduled) {
      clearTimeout(scheduled.timer)
      scheduledSessionPersists.delete(sessionId)
    }

    try {
      await persistSessionNow(sessionId)
      scheduled?.resolve()
    }
    catch (error) {
      scheduled?.reject(error)
      throw error
    }
  }

  function persistSessionMessages(sessionId: string, options?: { immediate?: boolean }) {
    if (options?.immediate)
      return flushScheduledSessionPersist(sessionId)

    const existing = scheduledSessionPersists.get(sessionId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => {
        flushScheduledSessionPersist(sessionId).catch((error) => {
          console.warn('Failed to persist chat session', error)
        })
      }, PERSIST_DEBOUNCE_MS)
      return existing.promise
    }

    let resolvePersist!: () => void
    let rejectPersist!: (error: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePersist = resolve
      rejectPersist = reject
    })

    scheduledSessionPersists.set(sessionId, {
      timer: setTimeout(() => {
        flushScheduledSessionPersist(sessionId).catch((error) => {
          console.warn('Failed to persist chat session', error)
        })
      }, PERSIST_DEBOUNCE_MS),
      promise,
      resolve: resolvePersist,
      reject: rejectPersist,
    })

    return promise
  }

  function setSessionMessages(sessionId: string, next: ChatHistoryItem[]) {
    sessionMessages.value[sessionId] = next
    void persistSessionMessages(sessionId)
  }

  async function deleteSessionMessage(target: string | DeleteSessionMessageTarget, sessionId = activeSessionId.value) {
    if (!sessionId)
      return undefined

    const messages = ensureSessionMessageIds(sessionId)
    const messageId = typeof target === 'string' ? target : target.messageId
    let messageIndex = messageId
      ? messages.findIndex(message => message.id === messageId)
      : -1

    if (messageIndex === -1 && typeof target !== 'string' && typeof target.index === 'number')
      messageIndex = target.index

    if (messageIndex < 0 || messageIndex >= messages.length)
      return undefined

    const deletedMessage = messages[messageIndex]
    if (!deletedMessage || deletedMessage.role === 'system')
      return undefined

    sessionMessages.value[sessionId] = messages.filter((_message, index) => index !== messageIndex)
    await persistSessionMessages(sessionId, { immediate: true })
    return deletedMessage
  }

  async function loadSession(sessionId: string) {
    if (loadedSessions.has(sessionId))
      return
    if (loadingSessions.has(sessionId)) {
      await loadingSessions.get(sessionId)
      return
    }

    const loadPromise = (async () => {
      const stored = await chatSessionsRepo.getSession(sessionId)
      if (!getIndexedSessionMeta(sessionId))
        return

      if (stored && getIndexedSessionMeta(sessionId)?.userId === stored.meta.userId) {
        const normalizedRecord = normalizeSessionRecord(stored)
        sessionMetas.value[sessionId] = normalizedRecord.meta
        const currentMessages = sessionMessages.value[sessionId] ?? []
        sessionMessages.value[sessionId] = mergeSessionMessages(normalizedRecord.messages, currentMessages)
        cacheRoomScriptFromRecord(sessionId, normalizedRecord)
        ensureGeneration(sessionId)
      }
      loadedSessions.add(sessionId)
      touchSessionAccess(sessionId)
      evictInactiveSessions([sessionId])
    })()

    loadingSessions.set(sessionId, loadPromise)
    await loadPromise
    loadingSessions.delete(sessionId)
  }

  async function resolveGroupRoomScript(sessionId: string) {
    const meta = getSessionMeta(sessionId)
    if (meta?.kind !== 'room')
      return undefined

    if (roomScriptCache.has(sessionId) && !staleRoomScriptSessionIds.has(sessionId)) {
      const cached = roomScriptCache.get(sessionId)
      return cached ? cloneSnapshot(cached) : undefined
    }

    let resolved: GroupRoomScriptState | undefined
    await enqueueSessionPersist(sessionId, async () => {
      const stored = await chatSessionsRepo.getSession(sessionId)
      if (!stored) {
        await reconcileSessionIndex(sessionId, meta.userId)
        return
      }

      const normalizedRecord = normalizeSessionRecord(stored)
      if (!await reconcileSessionIndex(sessionId, meta.userId, normalizedRecord))
        return
      const currentMeta = getSessionMeta(sessionId)
      if (!currentMeta || normalizedRecord.meta.updatedAt >= currentMeta.updatedAt
        || getRoomScriptRevision(normalizedRecord.meta) !== getRoomScriptRevision(currentMeta)) {
        setSessionMeta(normalizedRecord.meta)
      }
      resolved = cacheRoomScriptFromRecord(sessionId, normalizedRecord)
      sessionMessages.value[sessionId] = mergeSessionMessages(normalizedRecord.messages, sessionMessages.value[sessionId] ?? [])
    })

    return resolved ? cloneSnapshot(resolved) : undefined
  }

  async function persistGroupRoomScript(
    sessionId: string,
    state: GroupRoomScriptState | undefined,
    options?: {
      expectedRevision: number
      signal?: AbortSignal
      mutate?: (current: GroupRoomScriptState, messageIds: string[]) => GroupRoomScriptState
    },
  ) {
    const currentMeta = getSessionMeta(sessionId)
    if (currentMeta?.kind !== 'room')
      throw new Error('Group room scripts can only be attached to room sessions.')

    const validatedState = state
      ? parseGroupRoomScriptState(state, getRoomParticipantIds(currentMeta))
      : undefined
    let savedRecord: ChatSessionRecord | undefined

    await enqueueSessionPersist(sessionId, async () => {
      options?.signal?.throwIfAborted()
      const persistedRaw = await chatSessionsRepo.getSession(sessionId)
      const persisted = persistedRaw ? normalizeSessionRecord(persistedRaw) : undefined
      const latestMeta = persisted?.meta ?? currentMeta

      if (latestMeta.kind !== 'room')
        throw new Error('Group room scripts can only be attached to room sessions.')

      if (options && getRoomScriptRevision(persisted?.meta) !== options.expectedRevision)
        throw new Error('The group script changed. Reload its current revision before trying again.')

      const mergedMessages = persisted
        ? snapshotMessages(persisted.messages)
        : snapshotMessages(ensureSessionMessageIds(sessionId))
      const currentScript = persisted ? validateRecordRoomScript(persisted) : undefined
      const nextState = options?.mutate && currentScript
        ? options.mutate(currentScript, mergedMessages.flatMap(message => message.id ? [message.id] : []))
        : validatedState
      if (options?.mutate && nextState === currentScript && persisted) {
        if (!await reconcileSessionIndex(sessionId, latestMeta.userId, persisted))
          return
        savedRecord = persisted
        setSessionMeta(persisted.meta)
        sessionMessages.value[sessionId] = mergedMessages
        cacheRoomScriptFromRecord(sessionId, persisted)
        return
      }

      const latestValidatedState = nextState
        ? parseGroupRoomScriptState(nextState, getRoomParticipantIds(latestMeta))
        : undefined
      if (options?.mutate && !currentScript)
        throw new Error('The group script is no longer attached to this room.')
      const roomScriptRevision = nextRoomScriptRevision(latestMeta)
      if (latestValidatedState?.progress) {
        latestValidatedState.chapterRuntime = {
          ...latestValidatedState.chapterRuntime,
          evaluations: latestValidatedState.chapterRuntime?.evaluations ?? [],
          narrationEpoch: latestValidatedState.chapterRuntime?.narrationEpoch ?? roomScriptRevision,
        }
      }
      const progress = latestValidatedState?.progress
      const currentAct = latestValidatedState?.templateSnapshot.acts?.find(act => act.actId === progress?.currentActId)
      if (latestValidatedState && progress && currentAct
        && latestValidatedState.chapterSettings?.showActNarration !== false
        && latestValidatedState.chapterRuntime?.narratedRevision !== progress.revision) {
        const id = `script-act:${latestValidatedState.templateSnapshot.id}:${latestValidatedState.chapterRuntime!.narrationEpoch}:${progress.revision}`
        if (!mergedMessages.some(message => message.id === id)) {
          const text = `${currentAct.number} · ${currentAct.title}${currentAct.narration ? `\n${currentAct.narration}` : ''}`
          mergedMessages.push({
            id,
            createdAt: Date.now(),
            role: 'assistant',
            content: text,
            slices: [{ type: 'text', text }],
            tool_results: [],
            metadata: { messageKind: 'narration', typingCompleted: true, scriptAct: { number: currentAct.number, title: currentAct.title } },
          })
        }
        latestValidatedState.chapterRuntime = {
          ...latestValidatedState.chapterRuntime,
          evaluations: latestValidatedState.chapterRuntime?.evaluations ?? [],
          narratedRevision: progress.revision,
        }
      }
      const updatedMeta: ChatSessionMeta = {
        ...latestMeta,
        roomScriptRevision,
        updatedAt: Math.max(Date.now(), latestMeta.updatedAt, persisted?.meta.updatedAt ?? 0),
      }
      options?.signal?.throwIfAborted()
      savedRecord = {
        meta: cloneSnapshot(updatedMeta),
        messages: snapshotMessages(mergedMessages),
        ...(latestValidatedState ? { roomScript: cloneSnapshot(latestValidatedState) } : {}),
      }
      if (!await saveSessionWithIndex(savedRecord)) {
        savedRecord = undefined
        return
      }
      setSessionMeta(updatedMeta)
      sessionMessages.value[sessionId] = mergedMessages
      roomScriptCache.set(sessionId, latestValidatedState ? cloneSnapshot(latestValidatedState) : undefined)
      staleRoomScriptSessionIds.delete(sessionId)
    })

    if (!savedRecord)
      throw new Error('Failed to persist group room script state.')

    setTimeout(() => broadcastSessionUpdate(sessionId, savedRecord!.meta, savedRecord!.messages, savedRecord!.roomScript ?? null), 0)
    scheduleSync(sessionId)
    return savedRecord.roomScript ? cloneSnapshot(savedRecord.roomScript) : undefined
  }

  async function updateGroupRoomScript(sessionId: string, state: GroupRoomScriptState, expectedRevision?: number) {
    return await persistGroupRoomScript(sessionId, state, expectedRevision === undefined ? undefined : { expectedRevision })
  }

  async function mutateGroupRoomScript(
    sessionId: string,
    expectedRevision: number,
    mutate: (current: GroupRoomScriptState, messageIds: string[]) => GroupRoomScriptState,
    signal?: AbortSignal,
  ) {
    const saved = await persistGroupRoomScript(sessionId, undefined, { expectedRevision, mutate, signal })
    if (!saved)
      throw new Error('The group script is no longer attached to this room.')
    return saved
  }

  async function executeGroupScriptCommand(sessionId: string, expectedRevision: number, command: GroupScriptRuntimeCommand, signal?: AbortSignal) {
    return mutateGroupRoomScript(sessionId, expectedRevision, (current, messageIds) => reduceGroupScriptRuntimeCommand(current, command, messageIds), signal)
  }

  async function clearGroupRoomScript(sessionId: string) {
    await persistGroupRoomScript(sessionId, undefined)
  }

  async function persistGroupParticipantChange(sessionId: string, nextMeta: ChatSessionMeta) {
    const messages = snapshotMessages(ensureSessionMessageIds(sessionId))
    let savedRecord: ChatSessionRecord | undefined

    await enqueueSessionPersist(sessionId, async () => {
      const persistedRaw = await chatSessionsRepo.getSession(sessionId)
      const persisted = persistedRaw ? normalizeSessionRecord(persistedRaw) : undefined
      const persistedScript = persisted ? validateRecordRoomScript(persisted) : undefined
      const cachedScript = !staleRoomScriptSessionIds.has(sessionId) ? roomScriptCache.get(sessionId) : undefined
      const shouldDetachScript = Boolean(persistedScript || cachedScript)
      const currentRevision = Math.max(getRoomScriptRevision(nextMeta), getRoomScriptRevision(persisted?.meta))
      const roomScriptRevision = shouldDetachScript
        ? nextRoomScriptRevision(nextMeta, persisted?.meta)
        : currentRevision
      const updatedMeta: ChatSessionMeta = {
        ...nextMeta,
        ...((nextMeta.roomScriptRevision !== undefined || persisted?.meta.roomScriptRevision !== undefined || shouldDetachScript)
          ? { roomScriptRevision }
          : {}),
        updatedAt: Math.max(Date.now(), nextMeta.updatedAt, persisted?.meta.updatedAt ?? 0),
      }
      const mergedMessages = persisted
        ? mergeSessionMessages(messages, persisted.messages)
        : messages

      savedRecord = { meta: cloneSnapshot(updatedMeta), messages: snapshotMessages(mergedMessages) }
      if (!await saveSessionWithIndex(savedRecord)) {
        savedRecord = undefined
        return
      }
      setSessionMeta(updatedMeta)
      sessionMessages.value[sessionId] = mergedMessages
      roomScriptCache.set(sessionId, undefined)
      staleRoomScriptSessionIds.delete(sessionId)
    })

    if (!savedRecord)
      throw new Error('Failed to persist group participant change.')
    setTimeout(() => broadcastSessionUpdate(sessionId, savedRecord!.meta, savedRecord!.messages), 0)
    scheduleSync(sessionId)
  }

  async function createSession(characterId: string, options?: {
    setActive?: boolean
    messages?: ChatHistoryItem[]
    participants?: ChatRoomParticipantSnapshot[]
    primaryCharacterId?: string
    title?: string
  }) {
    const currentUserId = await resolveCurrentUserId()
    const sessionId = nanoid()
    const now = Date.now()
    const meta: ChatSessionMeta = {
      sessionId,
      userId: currentUserId,
      characterId,
      kind: options?.participants?.length ? 'room' : 'direct',
      participants: options?.participants,
      primaryCharacterId: options?.primaryCharacterId,
      title: options?.title,
      createdAt: now,
      updatedAt: now,
    }

    const initialMessages = options?.messages?.length
      ? options.messages
      : options?.participants?.length
        ? [generateInitialMessageFromPrompt('Group chat room. The selected character prompt is injected for each reply.')]
        : generateInitialMessages(characterId)

    const record: ChatSessionRecord = { meta, messages: initialMessages }
    await enqueueSessionPersist(sessionId, async () => {
      await saveSessionWithIndex(record, { insert: true, setActive: options?.setActive !== false })
    }, currentUserId)
    sessionMetas.value[sessionId] = meta
    sessionMessages.value[sessionId] = initialMessages
    ensureGeneration(sessionId)
    loadedSessions.add(sessionId)
    touchSessionAccess(sessionId)
    evictInactiveSessions([sessionId])
    scheduleSync(sessionId)

    if (options?.setActive !== false)
      activeSessionId.value = sessionId

    return sessionId
  }

  async function createGroupSession(participants: ChatRoomParticipantSnapshot[], title?: string) {
    const uniqueIds = normalizeGroupParticipantIds(participants.map(participant => participant.characterId))
    if (uniqueIds.length < GROUP_CHAT_MIN_PARTICIPANTS)
      throw new Error('A group chat needs at least one character')

    const snapshots = uniqueIds.map(characterId => participants.find(participant => participant.characterId === characterId)!)
    return await createSession('group', {
      participants: snapshots,
      primaryCharacterId: snapshots[0].characterId,
      title: title?.trim() || snapshots.map(participant => participant.displayName).join(', '),
    })
  }

  async function renameGroupSession(sessionId: string, title: string) {
    const meta = getSessionMeta(sessionId)
    const normalizedTitle = title.trim()
    if (meta?.kind !== 'room' || !normalizedTitle)
      return false
    if (normalizedTitle.length > 80)
      throw new Error('Group chat names cannot exceed 80 characters.')

    setSessionMeta({
      ...meta,
      title: normalizedTitle,
      updatedAt: Date.now(),
    })
    await persistSessionMessages(sessionId, { immediate: true })
    return true
  }

  async function addGroupParticipant(sessionId: string, participant: ChatRoomParticipantSnapshot) {
    const meta = getSessionMeta(sessionId)
    if (meta?.kind !== 'room' || !participant.characterId.trim())
      return false

    const participants = meta.participants ?? []
    if (participants.some(item => item.characterId === participant.characterId)
      || participants.length >= GROUP_CHAT_MAX_PARTICIPANTS) {
      return false
    }

    const nextMeta: ChatSessionMeta = {
      ...meta,
      participants: [...participants, { ...participant, characterId: participant.characterId.trim() }],
      updatedAt: Date.now(),
    }
    await persistGroupParticipantChange(sessionId, nextMeta)
    return true
  }

  async function removeGroupParticipant(sessionId: string, characterId: string) {
    const meta = getSessionMeta(sessionId)
    if (meta?.kind !== 'room')
      return false

    const participants = meta.participants ?? []
    if (participants.length <= GROUP_CHAT_MIN_PARTICIPANTS || !participants.some(item => item.characterId === characterId))
      return false

    const nextParticipants = participants.filter(item => item.characterId !== characterId)
    const nextMeta: ChatSessionMeta = {
      ...meta,
      participants: nextParticipants,
      primaryCharacterId: meta.primaryCharacterId === characterId
        ? nextParticipants[0]?.characterId
        : meta.primaryCharacterId,
      updatedAt: Date.now(),
    }
    await persistGroupParticipantChange(sessionId, nextMeta)
    return true
  }

  async function ensureActiveSessionForCharacter() {
    const currentUserId = await resolveCurrentUserId()
    const characterId = getCurrentCharacterId()

    if (!index.value || index.value.userId !== currentUserId)
      await loadIndexForUser(currentUserId)

    const characterIndex = getCharacterIndex(characterId)
    if (!characterIndex) {
      await createSession(characterId)
      return
    }

    if (!characterIndex.activeSessionId) {
      await createSession(characterId)
      return
    }

    activeSessionId.value = characterIndex.activeSessionId
    await loadSession(characterIndex.activeSessionId)
    ensureSession(characterIndex.activeSessionId)
  }

  async function selectOrCreateSessionForCharacter(characterId: string) {
    const nextCharacterId = characterId || 'default'
    activeCardId.value = nextCharacterId

    const currentUserId = await resolveCurrentUserId()
    if (!index.value || index.value.userId !== currentUserId)
      await loadIndexForUser(currentUserId)

    const characterIndex = getCharacterIndex(nextCharacterId)
    if (!characterIndex?.activeSessionId)
      return await createSession(nextCharacterId)

    const sessionId = characterIndex.activeSessionId
    activeSessionId.value = sessionId
    await loadSession(sessionId)
    ensureSession(sessionId)
    return sessionId
  }

  async function initialize() {
    if (ready.value)
      return
    if (initializePromise)
      return initializePromise
    initializing.value = true
    ensureCrossWindowSync()
    initializePromise = (async () => {
      await authStore.waitUntilReady()
      await ensureActiveSessionForCharacter()
      ready.value = true
    })()

    try {
      await initializePromise
    }
    finally {
      initializePromise = null
      initializing.value = false
    }
  }

  function ensureSessionLoaded(sessionId: string) {
    if (!ready.value || loadedSessions.has(sessionId) || loadingSessions.has(sessionId))
      return

    void loadSession(sessionId)
  }

  function ensureSession(sessionId: string, personaSystemPrompt?: string) {
    ensureGeneration(sessionId)
    const messages = sessionMessages.value[sessionId]
    const meta = getSessionMeta(sessionId)
    const characterId = meta?.characterId ?? getCurrentCharacterId()
    const currentSystemPrompt = resolveSessionSystemPrompt(sessionId, personaSystemPrompt)

    if (!messages) {
      if (sessionMetas.value[sessionId] || loadingSessions.has(sessionId) || hasIndexedSession(sessionId)) {
        sessionMessages.value[sessionId] = []
        return
      }

      // 会话为空，生成新的初始消息
      sessionMessages.value[sessionId] = generateInitialMessages(characterId, personaSystemPrompt)
      void persistSessionMessages(sessionId)
    }
    else if (messages.length === 0) {
      if (sessionMetas.value[sessionId] || loadingSessions.has(sessionId) || hasIndexedSession(sessionId))
        return

      sessionMessages.value[sessionId] = generateInitialMessages(characterId, personaSystemPrompt)
      void persistSessionMessages(sessionId)
    }
    else {
      // 会话存在，检查系统消息是否需要更新
      if (meta?.kind === 'room')
        return undefined

      const firstMessage = messages[0]

      if (firstMessage?.role === 'system' && firstMessage.content !== currentSystemPrompt) {
        // 系统提示词已变化，更新第一条消息
        messages[0] = {
          ...firstMessage,
          content: currentSystemPrompt,
        }
        void persistSessionMessages(sessionId)
      }
    }

    return meta?.kind === 'room' ? undefined : currentSystemPrompt
  }

  const messages = computed<ChatHistoryItem[]>({
    get: () => {
      if (!activeSessionId.value)
        return []
      return getSessionMessages(activeSessionId.value)
    },
    set: (value) => {
      if (!activeSessionId.value)
        return
      sessionMessages.value[activeSessionId.value] = value
      void persistSessionMessages(activeSessionId.value)
    },
  })

  const personaContactSessions = computed<PersonaContactSessionSummary[]>(() => {
    const summaries = new Map<string, PersonaContactSessionSummary>()

    function addMeta(meta: ChatSessionMeta) {
      if (meta.userId !== getCurrentUserId())
        return

      summaries.set(meta.sessionId, {
        characterId: meta.characterId,
        id: meta.sessionId,
        lastMessageAt: meta.updatedAt,
        lastMessagePreview: getSessionPreview(meta.sessionId, meta),
      })
    }

    if (index.value) {
      for (const character of Object.values(index.value.characters ?? {})) {
        for (const meta of Object.values(character.sessions))
          addMeta(meta)
      }
    }

    for (const meta of Object.values(sessionMetas.value))
      addMeta(meta)

    return Array.from(summaries.values())
  })

  const groupSessions = computed(() => {
    const metas = new Map<string, ChatSessionMeta>()
    if (index.value) {
      for (const character of Object.values(index.value.characters ?? {})) {
        for (const meta of Object.values(character.sessions)) {
          if (meta.kind === 'room' && meta.userId === getCurrentUserId())
            metas.set(meta.sessionId, meta)
        }
      }
    }
    for (const meta of Object.values(sessionMetas.value)) {
      if (meta.kind === 'room' && meta.userId === getCurrentUserId())
        metas.set(meta.sessionId, meta)
    }
    return Array.from(metas.values()).sort((left, right) => right.updatedAt - left.updatedAt)
  })

  function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId
    ensureSession(sessionId)
    touchSessionAccess(sessionId)
    evictInactiveSessions([sessionId])

    const characterId = sessionMetas.value[sessionId]?.characterId ?? getIndexedSessionMeta(sessionId)?.characterId ?? getCurrentCharacterId()
    const characterIndex = index.value?.characters?.[characterId]
    if (characterIndex) {
      characterIndex.activeSessionId = sessionId
      void persistActiveSession(characterId, sessionId)
    }

    ensureSessionLoaded(sessionId)
  }

  async function cleanupMessages(sessionId = activeSessionId.value) {
    if (!sessionId)
      return

    ensureGeneration(sessionId)
    sessionGenerations.value[sessionId] += 1
    const innerVoiceNotes = useAssistantInnerVoiceNoteStore()
    void innerVoiceNotes.deleteNotesForSession(sessionId).catch((error) => {
      console.warn('[ChatSession] Failed to delete inner voice notes for cleaned session:', error)
    })
    const meta = getSessionMeta(sessionId)
    setSessionMessages(sessionId, meta?.kind === 'room'
      ? [generateInitialMessageFromPrompt('Group chat room. The selected character prompt is injected for each reply.')]
      : generateInitialMessages(meta?.characterId))
    await persistSessionMessages(sessionId, { immediate: true })
    // Force the cleared state onto other windows. The normal update broadcast merges
    // by identity, so a removal would otherwise be re-added from stale local history.
    const resetMeta = sessionMetas.value[sessionId]
    if (resetMeta)
      broadcastSessionReset(sessionId, resetMeta, sessionMessages.value[sessionId] ?? [])
    void import('./context-providers')
      .then(({ resetConversationInitialization }) => resetConversationInitialization(sessionId))
      .catch((error) => {
        console.warn('[ChatSession] Failed to reset conversation initialization state:', error)
      })
  }

  function getAllSessions() {
    return cloneSnapshot(sessionMessages.value) as Record<string, ChatHistoryItem[]>
  }

  async function resetAllSessions() {
    const currentUserId = await resolveCurrentUserId()
    const characterId = getCurrentCharacterId()
    const sessionIds = new Set<string>()

    const latest = await withUserSessionIndexLock(currentUserId, () => latestSessionIndex(currentUserId))
    for (const character of Object.values(latest.characters)) {
      for (const sessionId of Object.keys(character.sessions))
        sessionIds.add(sessionId)
    }
    // Invalidate streams before deletion starts, and retain their tombstones.
    // Clearing generations to zero could make an old captured zero valid again.
    for (const sessionId of sessionIds) {
      ensureGeneration(sessionId)
      sessionGenerations.value[sessionId] += 1
    }

    for (const sessionId of sessionIds)
      await enqueueSessionPersist(sessionId, () => deleteSessionWithIndex(sessionId, currentUserId), currentUserId)

    for (const [sessionId, scheduled] of scheduledSessionPersists) {
      clearTimeout(scheduled.timer)
      scheduled.resolve()
      scheduledSessionPersists.delete(sessionId)
    }

    sessionAccessOrder.clear()

    sessionMessages.value = {}
    sessionMetas.value = {}
    roomScriptCache.clear()
    staleRoomScriptSessionIds.clear()
    loadedSessions.clear()
    loadingSessions.clear()

    // Reset removes the initial snapshot only. Sessions inserted while those
    // records were being deleted retain their durable membership.
    index.value = await withUserSessionIndexLock(currentUserId, () => latestSessionIndex(currentUserId))

    // 重置对话初始化状态，确保下次对话会重新初始化
    const { resetConversationInitialization } = await import('./context-providers')
    resetConversationInitialization()

    await createSession(characterId)
  }

  async function refreshFromPersistence() {
    if (!ready.value)
      return
    if (refreshFromPersistencePromise)
      return refreshFromPersistencePromise

    refreshFromPersistencePromise = (async () => {
      const currentUserId = await resolveCurrentUserId()
      const storedIndex = await withUserSessionIndexLock(currentUserId, () => latestSessionIndex(currentUserId))
      if (getCurrentUserId() !== currentUserId)
        return

      const sessionsToRefresh = new Set([...loadedSessions, activeSessionId.value].filter(Boolean))
      const records = new Map<string, ChatSessionRecord>()
      // Inspect durable members under the same locks as writers. This also
      // repairs record/index partial failures, including deleted records.
      for (const character of Object.values(storedIndex.characters)) {
        for (const sessionId of Object.keys(character.sessions)) {
          await enqueueSessionPersist(sessionId, async () => {
            const raw = await chatSessionsRepo.getSession(sessionId)
            const record = raw ? normalizeSessionRecord(raw) : undefined
            if (await reconcileSessionIndex(sessionId, currentUserId, record) && record)
              records.set(sessionId, record)
          }, currentUserId)
        }
      }
      if (getCurrentUserId() !== currentUserId)
        return

      const latest = await withUserSessionIndexLock(currentUserId, () => latestSessionIndex(currentUserId))
      adoptPersistedIndex(latest)
      const memberIds = new Set(Object.values(latest.characters).flatMap(character => Object.keys(character.sessions)))
      const knownIds = new Set([...Object.keys(sessionMetas.value), ...Object.keys(sessionMessages.value), ...loadedSessions, ...loadingSessions.keys(), ...roomScriptCache.keys(), ...sessionAccessOrder.keys()])
      for (const sessionId of knownIds) {
        if (!memberIds.has(sessionId))
          forgetMissingSession(sessionId)
      }
      if (!memberIds.has(activeSessionId.value)) {
        const character = latest.characters[getCurrentCharacterId()]
        activeSessionId.value = character?.sessions[character.activeSessionId]
          ? character.activeSessionId
          : Object.keys(character?.sessions ?? {})[0] ?? ''
      }
      if (activeSessionId.value)
        sessionsToRefresh.add(activeSessionId.value)
      for (const sessionId of sessionsToRefresh) {
        const stored = records.get(sessionId)
        if (!memberIds.has(sessionId) || !stored)
          continue
        const indexedMeta = latest.characters[stored.meta.characterId]?.sessions[sessionId]
        if (indexedMeta && (indexedMeta.updatedAt > stored.meta.updatedAt
          || getRoomScriptRevision(indexedMeta) > getRoomScriptRevision(stored.meta))) {
          staleRoomScriptSessionIds.add(sessionId)
          continue
        }

        const currentMeta = sessionMetas.value[sessionId]
        const storedRevision = getRoomScriptRevision(stored.meta)
        const currentRevision = getRoomScriptRevision(currentMeta)
        if (!currentMeta || stored.meta.updatedAt >= currentMeta.updatedAt || storedRevision > currentRevision)
          sessionMetas.value[sessionId] = stored.meta

        if (staleRoomScriptSessionIds.has(sessionId) || !roomScriptCache.has(sessionId) || storedRevision >= currentRevision)
          cacheRoomScriptFromRecord(sessionId, stored)

        const currentMessages = sessionMessages.value[sessionId] ?? []
        // Active messages may include an unfinished provider/voice draft. Keep
        // those objects on duplicate IDs while additively importing persisted data.
        sessionMessages.value[sessionId] = sessionId === activeSessionId.value
          ? mergeSessionMessages(currentMessages, stored.messages)
          : mergeSessionMessages(stored.messages, currentMessages)
        loadedSessions.add(sessionId)
        touchSessionAccess(sessionId)
      }

      evictInactiveSessions([activeSessionId.value])
    })()

    try {
      await refreshFromPersistencePromise
    }
    finally {
      refreshFromPersistencePromise = null
    }
  }

  async function deleteSession(sessionId: string) {
    const meta = getSessionMeta(sessionId)
    if (!meta)
      return false

    ensureGeneration(sessionId)
    sessionGenerations.value[sessionId] += 1

    const scheduled = scheduledSessionPersists.get(sessionId)
    if (scheduled) {
      clearTimeout(scheduled.timer)
      scheduledSessionPersists.delete(sessionId)
      scheduled.resolve()
    }

    const ownerId = meta.userId
    await enqueueSessionPersist(sessionId, () => deleteSessionWithIndex(sessionId, ownerId), ownerId)
    delete sessionMessages.value[sessionId]
    delete sessionMetas.value[sessionId]
    delete sessionGenerations.value[sessionId]
    roomScriptCache.delete(sessionId)
    staleRoomScriptSessionIds.delete(sessionId)
    loadedSessions.delete(sessionId)
    loadingSessions.delete(sessionId)
    sessionAccessOrder.delete(sessionId)

    if (activeSessionId.value === sessionId) {
      const characterIndex = getCharacterIndex(getCurrentCharacterId())
      const fallbackSessionId = characterIndex?.activeSessionId
      if (fallbackSessionId) {
        activeSessionId.value = fallbackSessionId
        await loadSession(fallbackSessionId)
        ensureSession(fallbackSessionId)
      }
      else {
        activeSessionId.value = ''
        await ensureActiveSessionForCharacter()
      }
    }

    return true
  }

  function getSessionMessages(sessionId: string) {
    ensureSession(sessionId)
    touchSessionAccess(sessionId)
    ensureSessionLoaded(sessionId)
    if (!sessionMessages.value[sessionId])
      sessionMessages.value[sessionId] = []
    return sessionMessages.value[sessionId]
  }

  function getSessionGeneration(sessionId: string) {
    ensureGeneration(sessionId)
    return sessionGenerations.value[sessionId] ?? 0
  }

  function bumpSessionGeneration(sessionId: string) {
    ensureGeneration(sessionId)
    sessionGenerations.value[sessionId] += 1
    return sessionGenerations.value[sessionId]
  }

  function getSessionGenerationValue(sessionId?: string) {
    const target = sessionId ?? activeSessionId.value
    return getSessionGeneration(target)
  }

  function getSessionMeta(sessionId: string) {
    return sessionMetas.value[sessionId] ?? getIndexedSessionMeta(sessionId)
  }

  async function forkSession(options: { fromSessionId: string, atIndex?: number, reason?: string, hidden?: boolean }) {
    const characterId = getCurrentCharacterId()
    const parentMessages = getSessionMessages(options.fromSessionId)
    const forkIndex = options.atIndex ?? parentMessages.length
    const nextMessages = snapshotMessages(parentMessages.slice(0, forkIndex))
      .map(message => ({ ...message, id: nanoid() }))
    return await createSession(characterId, { setActive: false, messages: nextMessages })
  }

  async function exportSessions(): Promise<ChatSessionsExport> {
    if (!ready.value)
      await initialize()

    const currentUserId = await resolveCurrentUserId()
    if (!index.value || index.value.userId !== currentUserId)
      await loadIndexForUser(currentUserId)

    if (!index.value) {
      return {
        format: 'chat-sessions-index:v1',
        index: { userId: currentUserId, characters: {} },
        sessions: {},
      }
    }

    const sessions: Record<string, ChatSessionRecord> = {}
    for (const character of Object.values(index.value.characters ?? {})) {
      for (const sessionId of Object.keys(character.sessions)) {
        const stored = await chatSessionsRepo.getSession(sessionId)
        if (stored) {
          sessions[sessionId] = normalizeSessionRecord(stored)
          continue
        }
        const meta = sessionMetas.value[sessionId]
        const messages = sessionMessages.value[sessionId]
        if (meta && messages) {
          const cachedRoomScript = !staleRoomScriptSessionIds.has(sessionId)
            ? roomScriptCache.get(sessionId)
            : undefined
          sessions[sessionId] = normalizeSessionRecord({
            meta,
            messages,
            ...(cachedRoomScript ? { roomScript: cachedRoomScript } : {}),
          })
        }
      }
    }

    return {
      format: 'chat-sessions-index:v1',
      index: normalizeSessionsIndex(index.value, currentUserId),
      sessions,
    }
  }

  async function importSessions(payload: ChatSessionsExport) {
    if (payload.format !== 'chat-sessions-index:v1')
      return

    index.value = normalizeSessionsIndex(payload.index, payload.index.userId)
    sessionMessages.value = {}
    sessionMetas.value = {}
    sessionGenerations.value = {}
    roomScriptCache.clear()
    staleRoomScriptSessionIds.clear()
    loadedSessions.clear()
    loadingSessions.clear()

    const normalizedRecords: Array<[string, ChatSessionRecord]> = []
    for (const [sessionId, record] of Object.entries(payload.sessions)) {
      const normalizedRecord = normalizeSessionRecord(record)
      setSessionMeta(normalizedRecord.meta)
      sessionMessages.value[sessionId] = normalizedRecord.messages
      cacheRoomScriptFromRecord(sessionId, normalizedRecord)
      ensureGeneration(sessionId)
      normalizedRecords.push([sessionId, normalizedRecord])
    }

    const replacement = index.value ? cloneSnapshot(index.value) as ChatSessionsIndex : undefined
    await enqueuePersist(async () => {
      for (const [sessionId, record] of normalizedRecords)
        await withSessionRecordLock(sessionId, () => chatSessionsRepo.saveSession(sessionId, record))
      if (replacement) {
        await withUserSessionIndexLock(replacement.userId, () => chatSessionsRepo.saveIndex(replacement))
      }
    })

    await ensureActiveSessionForCharacter()
  }

  const sessionScopeUserKey = computed(() => getCurrentUserId())
  let sessionScopeTransition = Promise.resolve()
  let sessionScopeTransitionVersion = 0

  watch(sessionScopeUserKey, () => {
    if (!ready.value)
      return

    // Hide the previous identity's active session synchronously. The queued
    // transition then loads the latest identity, so rapid auth changes cannot
    // paint one account's messages under another account.
    activeSessionId.value = ''
    index.value = null
    ready.value = false
    const transitionVersion = ++sessionScopeTransitionVersion
    sessionScopeTransition = sessionScopeTransition
      .then(async () => await ensureActiveSessionForCharacter())
      .catch(error => console.warn('[ChatSession] Failed to switch user scope:', error))
      .finally(() => {
        if (transitionVersion === sessionScopeTransitionVersion)
          ready.value = true
      })
  })

  watch(activeCardId, () => {
    if (ready.value)
      void ensureActiveSessionForCharacter()
  })

  return {
    ready,
    isReady,
    initialize,
    refreshFromPersistence,

    activeSessionId,
    personaContactSessions,
    groupSessions,
    messages,

    setActiveSession,
    createGroupSession,
    renameGroupSession,
    addGroupParticipant,
    removeGroupParticipant,
    resolveGroupRoomScript,
    updateGroupRoomScript,
    executeGroupScriptCommand,
    clearGroupRoomScript,
    deleteSession,
    selectOrCreateSessionForCharacter,
    cleanupMessages,
    getAllSessions,
    resetAllSessions,

    ensureSession,
    setSessionMessages,
    deleteSessionMessage,
    persistSessionMessages,
    getSessionMessages,
    getSessionGeneration,
    bumpSessionGeneration,
    getSessionGenerationValue,
    getSessionMeta,

    forkSession,
    exportSessions,
    importSessions,
  }
})
