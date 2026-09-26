import type { WebSocketBaseEvent, WebSocketEventOf, WebSocketEvents } from '@proj-airi/server-sdk'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { defineStore, storeToRefs } from 'pinia'
import { ref, watch } from 'vue'

import { useCharacterNotebookStore, useCharacterStore } from '../'
import { useChatOrchestratorStore } from '../../chat'
import { useLLM } from '../../llm'
import { useModsServerChannelStore } from '../../mods/api/channel-server'
import { useConsciousnessStore } from '../../modules/consciousness'
import { useProvidersStore } from '../../providers'
import { useMemoryAdvancedSettingsStore } from '../../settings/memory-advanced'
import { setupAgentSparkNotifyHandler } from './agents/event-handler-spark-notify'

export { sparkCommandSchema } from './agents/event-handler-spark-notify'

interface ProactiveTopicOwnerLease {
  ownerId: string
  priority: number
  expiresAt: number
  updatedAt: number
}

const PROACTIVE_TOPIC_OWNER_STORAGE_KEY = 'airi:character-orchestrator:proactive-topic-owner'
const PROACTIVE_TOPIC_ACTIVITY_STORAGE_KEY = 'airi:character-orchestrator:proactive-topic-activity'
const PROACTIVE_TOPIC_OWNER_TTL_MS = 15_000
const PROACTIVE_TOPIC_OWNER_HEARTBEAT_MS = 4_000
const PROACTIVE_TOPIC_OWNER_RETRY_MS = 5_000

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  }
  catch {
    return null
  }
}

function createProactiveTopicPrompt(now: number) {
  return [
    'Wuwiii internal proactive conversation trigger for the current resident.',
    `Current timestamp: ${new Date(now).toISOString()}.`,
    'The user has been quiet for a while. Start one natural, brief message to the user based on recent chat context and memories.',
    'Write only the message the current resident should say. Do not mention timers, triggers, system instructions, or that this was automatic.',
    'If there is no meaningful topic, keep it light and gentle instead of forcing a question.',
  ].join('\n')
}

export const useCharacterOrchestratorStore = defineStore('character-orchestrator', () => {
  const { stream } = useLLM()
  const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
  const providersStore = useProvidersStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const characterStore = useCharacterStore()
  const notebookStore = useCharacterNotebookStore()
  const { systemPrompt } = storeToRefs(characterStore)
  const modsServerChannelStore = useModsServerChannelStore()

  const processing = ref(false)
  const pendingNotifies = ref<Array<WebSocketEventOf<'spark:notify'>>>([])
  const scheduledNotifies = ref<Array<{
    event: WebSocketEventOf<'spark:notify'>
    enqueuedAt: number
    nextRunAt: number
    attempts: number
    maxAttempts: number
    reason?: string
  }>>([])
  const attentionConfig = ref({
    tickIntervalMs: 2_000,
    taskNotifyWindowMs: 60_000,
    requeueDelayMs: 30_000,
    maxAttempts: 3,
  })
  let tickTimer: ReturnType<typeof setInterval> | undefined
  let proactiveTopicTimer: ReturnType<typeof setTimeout> | undefined
  let proactiveTopicOwnerHeartbeat: ReturnType<typeof setInterval> | undefined
  let proactiveTopicOwnerRetryTimer: ReturnType<typeof setTimeout> | undefined
  let proactiveTopicTimerVersion = 0
  let proactiveTopicWaitIntervalMs: number | undefined
  let proactiveTopicWaitStartedAt: number | undefined
  let proactiveTopicGenerationInFlight = false
  let proactiveTopicRestartRequested = false
  let proactiveTopicActivityTrackingStarted = false
  let proactiveTopicPriority = 0
  const proactiveTopicOwnerId = `proactive-topic-${Math.random().toString(36).slice(2)}`
  const lastProactiveTopicTime = ref<number>(0)
  const lastConversationActivityAt = ref(Date.now())
  const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
  const sparkNotifyAgent = setupAgentSparkNotifyHandler({
    stream,
    getActiveProvider: () => activeProvider.value,
    getActiveModel: () => activeModel.value,
    getProviderInstance: name => providersStore.getProviderInstance(name),
    onReactionDelta: (eventId, text) => characterStore.onSparkNotifyReactionStreamEvent(eventId, text),
    onReactionEnd: (eventId, text) => characterStore.onSparkNotifyReactionStreamEnd(eventId, text),
    getSystemPrompt: () => systemPrompt.value,
    getProcessing: () => processing.value,
    setProcessing: next => processing.value = next,
    getPending: () => pendingNotifies.value,
    setPending: next => pendingNotifies.value = next,
  })

  function computeNextRunAt(event: WebSocketEventOf<'spark:notify'>, attempts: number) {
    const now = Date.now()
    const baseDelay = (() => {
      switch (event.data.urgency) {
        case 'immediate':
          return 0
        case 'soon':
          return 10_000
        case 'later':
          return 60_000
        default:
          return 30_000
      }
    })()

    return now + baseDelay + (attempts * attentionConfig.value.requeueDelayMs)
  }

  function removePending(eventId: string) {
    pendingNotifies.value = pendingNotifies.value.filter(item => item.data.id !== eventId)
  }

  function enqueueSparkNotify(event: WebSocketEventOf<'spark:notify'>, options?: { reason?: string, nextRunAt?: number, maxAttempts?: number }) {
    if (!pendingNotifies.value.some(item => item.data.id === event.data.id)) {
      pendingNotifies.value = [...pendingNotifies.value, event]
    }

    scheduledNotifies.value = [...scheduledNotifies.value, {
      event,
      enqueuedAt: Date.now(),
      nextRunAt: options?.nextRunAt ?? computeNextRunAt(event, 0),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? attentionConfig.value.maxAttempts,
      reason: options?.reason,
    }]
  }

  async function processSparkNotify(event: WebSocketEventOf<'spark:notify'>) {
    const result = await sparkNotifyAgent.handle(event)
    if (!result?.commands?.length)
      return result

    for (const command of result.commands) {
      modsServerChannelStore.send({
        type: 'spark:command',
        data: command,
      })
    }

    return result
  }

  async function handleIncomingSparkNotify(event: WebSocketEventOf<'spark:notify'>) {
    if (event.data.urgency === 'immediate' && !processing.value) {
      return await processSparkNotify(event)
    }

    enqueueSparkNotify(event, { reason: 'spark:notify' })
    return undefined
  }

  function enqueueDueTasks(now: number) {
    const dueTasks = notebookStore.getDueTasks(now, attentionConfig.value.taskNotifyWindowMs)
    if (!dueTasks.length)
      return

    for (const task of dueTasks) {
      const event: WebSocketEventOf<'spark:notify'> = {
        type: 'spark:notify',
        source: 'character:task-scheduler',
        data: {
          id: `task-${task.id}`,
          eventId: task.id,
          kind: 'reminder',
          urgency: task.priority === 'critical' ? 'immediate' : 'soon',
          headline: `Task reminder: ${task.title}`,
          note: task.details,
          destinations: ['character'],
          payload: {
            taskId: task.id,
            dueAt: task.dueAt,
            priority: task.priority,
          },
        },
      }

      enqueueSparkNotify(event, { reason: 'task:due' })
      notebookStore.markTaskNotified(task.id, now + attentionConfig.value.requeueDelayMs)
    }
  }

  function isWithinAllowedTimeRange(now: number): boolean {
    const { start, end } = memoryAdvancedSettings.settings.proactiveTimeRange
    const currentHour = new Date(now).getHours()

    if (start <= end) {
      return currentHour >= start && currentHour < end
    }
    else {
      // Handle overnight range (e.g., 22:00 - 9:00)
      return currentHour >= start || currentHour < end
    }
  }

  function readLastConversationActivityAt() {
    const storage = getLocalStorage()
    const stored = storage ? Number(storage.getItem(PROACTIVE_TOPIC_ACTIVITY_STORAGE_KEY)) : Number.NaN
    return Number.isFinite(stored) && stored >= 0
      ? Math.max(lastConversationActivityAt.value, stored)
      : lastConversationActivityAt.value
  }

  function writeLastConversationActivityAt(at: number) {
    const activityAt = Math.max(lastConversationActivityAt.value, at)
    lastConversationActivityAt.value = activityAt

    try {
      getLocalStorage()?.setItem(PROACTIVE_TOPIC_ACTIVITY_STORAGE_KEY, String(activityAt))
    }
    catch {
      // A timer still works in private browsing or when storage is unavailable.
    }
  }

  function getProactiveTopicIntervalMs() {
    if (memoryAdvancedSettings.settings.proactiveRandomInterval) {
      const first = memoryAdvancedSettings.settings.proactiveMinInterval
      const second = memoryAdvancedSettings.settings.proactiveMaxInterval
      const min = Math.min(first, second)
      const max = Math.max(first, second)
      return (min + (Math.random() * (max - min))) * 60 * 1000
    }

    return memoryAdvancedSettings.settings.proactiveCheckInterval * 60 * 1000
  }

  function readProactiveTopicOwnerLease(): ProactiveTopicOwnerLease | null {
    const storage = getLocalStorage()
    if (!storage)
      return null

    const raw = storage.getItem(PROACTIVE_TOPIC_OWNER_STORAGE_KEY)
    if (!raw)
      return null

    try {
      const lease = JSON.parse(raw) as Partial<ProactiveTopicOwnerLease>
      if (!lease.ownerId || typeof lease.priority !== 'number' || typeof lease.expiresAt !== 'number')
        return null

      return {
        ownerId: lease.ownerId,
        priority: lease.priority,
        expiresAt: lease.expiresAt,
        updatedAt: typeof lease.updatedAt === 'number' ? lease.updatedAt : 0,
      }
    }
    catch {
      return null
    }
  }

  function writeProactiveTopicOwnerLease() {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const now = Date.now()
    storage.setItem(PROACTIVE_TOPIC_OWNER_STORAGE_KEY, JSON.stringify({
      ownerId: proactiveTopicOwnerId,
      priority: proactiveTopicPriority,
      expiresAt: now + PROACTIVE_TOPIC_OWNER_TTL_MS,
      updatedAt: now,
    } satisfies ProactiveTopicOwnerLease))

    return readProactiveTopicOwnerLease()?.ownerId === proactiveTopicOwnerId
  }

  function ownsProactiveTopicLease() {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const lease = readProactiveTopicOwnerLease()
    return lease?.ownerId === proactiveTopicOwnerId && lease.expiresAt > Date.now()
  }

  function tryAcquireProactiveTopicLease() {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const lease = readProactiveTopicOwnerLease()
    const now = Date.now()
    const canAcquire = !lease
      || lease.ownerId === proactiveTopicOwnerId
      || lease.expiresAt <= now
      || proactiveTopicPriority > lease.priority

    if (!canAcquire)
      return false

    return writeProactiveTopicOwnerLease()
  }

  function releaseProactiveTopicLease() {
    const storage = getLocalStorage()
    if (!storage)
      return

    if (readProactiveTopicOwnerLease()?.ownerId === proactiveTopicOwnerId)
      storage.removeItem(PROACTIVE_TOPIC_OWNER_STORAGE_KEY)
  }

  function stopProactiveTopicOwnerHeartbeat() {
    if (!proactiveTopicOwnerHeartbeat)
      return

    clearInterval(proactiveTopicOwnerHeartbeat)
    proactiveTopicOwnerHeartbeat = undefined
  }

  function scheduleProactiveTopicOwnerRetry() {
    if (proactiveTopicOwnerRetryTimer)
      return

    proactiveTopicOwnerRetryTimer = setTimeout(() => {
      proactiveTopicOwnerRetryTimer = undefined
      startProactiveTopicTimer()
    }, PROACTIVE_TOPIC_OWNER_RETRY_MS)
  }

  function stopProactiveTopicOwnerRetry() {
    if (!proactiveTopicOwnerRetryTimer)
      return

    clearTimeout(proactiveTopicOwnerRetryTimer)
    proactiveTopicOwnerRetryTimer = undefined
  }

  function startProactiveTopicOwnerHeartbeat() {
    if (proactiveTopicOwnerHeartbeat)
      return

    proactiveTopicOwnerHeartbeat = setInterval(() => {
      if (ownsProactiveTopicLease()) {
        writeProactiveTopicOwnerLease()
        return
      }

      if (tryAcquireProactiveTopicLease())
        return

      if (proactiveTopicTimer) {
        clearTimeout(proactiveTopicTimer)
        proactiveTopicTimer = undefined
      }
      stopProactiveTopicOwnerHeartbeat()
      scheduleProactiveTopicOwnerRetry()
    }, PROACTIVE_TOPIC_OWNER_HEARTBEAT_MS)
  }

  async function generateProactiveTopic(now: number) {
    if (!memoryAdvancedSettings.settings.enableProactiveTopic)
      return false

    if (!isWithinAllowedTimeRange(now)) {
      return false
    }

    const activeProviderId = activeProvider.value
    const activeModelId = activeModel.value
    if (!activeProviderId || !activeModelId)
      return false

    const prompt = createProactiveTopicPrompt(now)
    const chatProvider = await providersStore.getProviderInstance<ChatProvider>(activeProviderId)
    lastProactiveTopicTime.value = now

    await chatOrchestrator.ingest(prompt, {
      model: activeModelId,
      chatProvider,
      hiddenUserMessage: true,
      memoryUserMessage: 'The current resident initiated a proactive conversation while the user was idle.',
      proactiveTopic: true,
      sourceCreatedAt: now,
      sourceSurface: 'proactive-topic',
      input: {
        type: 'input:text',
        data: {
          text: prompt,
          textRaw: prompt,
        },
      },
    })

    recordConversationActivity(Date.now())
    return true
  }

  async function tick() {
    if (processing.value)
      return

    const now = Date.now()
    enqueueDueTasks(now)

    const nextIndex = scheduledNotifies.value.findIndex(item => item.nextRunAt <= now)
    if (nextIndex < 0)
      return

    const [next] = scheduledNotifies.value.splice(nextIndex, 1)
    removePending(next.event.data.id)

    try {
      await processSparkNotify(next.event)
    }
    catch (error) {
      if (next.attempts + 1 < next.maxAttempts) {
        scheduledNotifies.value = [...scheduledNotifies.value, {
          ...next,
          attempts: next.attempts + 1,
          nextRunAt: computeNextRunAt(next.event, next.attempts + 1),
        }]
        pendingNotifies.value = [...pendingNotifies.value, next.event]
      }
      else {
        console.warn('Dropped spark:notify after max attempts:', error)
      }
    }
  }

  function startTicker() {
    if (tickTimer)
      return

    tickTimer = setInterval(() => {
      void tick()
    }, attentionConfig.value.tickIntervalMs)
  }

  function stopTicker() {
    if (!tickTimer)
      return

    clearInterval(tickTimer)
    tickTimer = undefined
  }

  function scheduleProactiveTopicTimer(version = proactiveTopicTimerVersion) {
    if (proactiveTopicTimer || proactiveTopicGenerationInFlight)
      return

    if (!memoryAdvancedSettings.settings.enableProactiveTopic || !ownsProactiveTopicLease())
      return

    const activityAt = readLastConversationActivityAt()
    const waitStartedAt = Math.max(activityAt, proactiveTopicWaitStartedAt ?? 0)
    proactiveTopicWaitStartedAt = waitStartedAt
    const intervalMs = proactiveTopicWaitIntervalMs ?? getProactiveTopicIntervalMs()
    proactiveTopicWaitIntervalMs = intervalMs
    const delayMs = Math.max(0, waitStartedAt + intervalMs - Date.now())

    proactiveTopicTimer = setTimeout(() => {
      proactiveTopicTimer = undefined
      if (version !== proactiveTopicTimerVersion)
        return

      if (!tryAcquireProactiveTopicLease()) {
        stopProactiveTopicOwnerHeartbeat()
        scheduleProactiveTopicOwnerRetry()
        return
      }

      const now = Date.now()
      const activityAt = readLastConversationActivityAt()
      if (activityAt > waitStartedAt) {
        proactiveTopicWaitStartedAt = activityAt
        proactiveTopicWaitIntervalMs = undefined
        scheduleProactiveTopicTimer(version)
        return
      }

      if (now < waitStartedAt + intervalMs) {
        scheduleProactiveTopicTimer(version)
        return
      }

      proactiveTopicGenerationInFlight = true
      void generateProactiveTopic(now)
        .then((generated) => {
          if (!generated && version === proactiveTopicTimerVersion)
            proactiveTopicWaitStartedAt = Date.now()
        })
        .catch(error => console.warn('[Proactive Topic] Failed to generate proactive topic:', error))
        .finally(() => {
          proactiveTopicGenerationInFlight = false
          if (version !== proactiveTopicTimerVersion) {
            if (proactiveTopicRestartRequested) {
              proactiveTopicRestartRequested = false
              startProactiveTopicTimer()
            }
            return
          }

          proactiveTopicWaitIntervalMs = undefined
          scheduleProactiveTopicTimer(version)
        })
    }, delayMs)
  }

  function rescheduleProactiveTopicWait() {
    proactiveTopicTimerVersion += 1
    if (proactiveTopicTimer) {
      clearTimeout(proactiveTopicTimer)
      proactiveTopicTimer = undefined
    }

    proactiveTopicWaitIntervalMs = undefined
    scheduleProactiveTopicTimer()
  }

  function resetProactiveTopicWait(at = Date.now()) {
    writeLastConversationActivityAt(at)
    proactiveTopicWaitStartedAt = at
    rescheduleProactiveTopicWait()
  }

  function recordConversationActivity(at = Date.now()) {
    if (proactiveTopicGenerationInFlight) {
      proactiveTopicWaitIntervalMs = undefined
      proactiveTopicWaitStartedAt = at
      writeLastConversationActivityAt(at)
      return
    }

    resetProactiveTopicWait(at)
  }

  function startConversationActivityTracking() {
    if (proactiveTopicActivityTrackingStarted)
      return

    proactiveTopicActivityTrackingStarted = true
    chatOrchestrator.onBeforeSend(async (_message, context) => {
      if (!context.internal?.hiddenUserMessage)
        recordConversationActivity()
    })
    chatOrchestrator.onChatTurnComplete(async (chat, context) => {
      if (!chat.outputText.trim())
        return

      if (!context.internal?.hiddenUserMessage || context.internal.proactiveTopic)
        recordConversationActivity()
    })

    globalThis.addEventListener?.('storage', ((event: StorageEvent) => {
      if (event.key !== PROACTIVE_TOPIC_ACTIVITY_STORAGE_KEY)
        return

      const activityAt = Number(event.newValue)
      if (!Number.isFinite(activityAt) || activityAt < lastConversationActivityAt.value)
        return

      lastConversationActivityAt.value = activityAt
      if (proactiveTopicGenerationInFlight) {
        proactiveTopicWaitIntervalMs = undefined
        proactiveTopicWaitStartedAt = activityAt
        return
      }

      rescheduleProactiveTopicWait()
    }) as EventListener)
  }

  function startProactiveTopicTimer() {
    if (proactiveTopicTimer)
      return

    if (!memoryAdvancedSettings.settings.enableProactiveTopic)
      return

    if (proactiveTopicGenerationInFlight) {
      proactiveTopicRestartRequested = true
      return
    }

    if (!tryAcquireProactiveTopicLease()) {
      scheduleProactiveTopicOwnerRetry()
      return
    }

    stopProactiveTopicOwnerRetry()
    startProactiveTopicOwnerHeartbeat()
    scheduleProactiveTopicTimer()
  }

  function stopProactiveTopicTimer() {
    proactiveTopicTimerVersion += 1
    proactiveTopicRestartRequested = false
    if (proactiveTopicTimer) {
      clearTimeout(proactiveTopicTimer)
      proactiveTopicTimer = undefined
    }

    proactiveTopicWaitIntervalMs = undefined
    proactiveTopicWaitStartedAt = undefined
    writeLastConversationActivityAt(Date.now())
    stopProactiveTopicOwnerRetry()
    stopProactiveTopicOwnerHeartbeat()
    releaseProactiveTopicLease()
  }

  // Watch for settings changes
  watch(
    () => memoryAdvancedSettings.settings.enableProactiveTopic,
    (enabled) => {
      if (enabled) {
        resetProactiveTopicWait()
        startProactiveTopicTimer()
      }
      else {
        stopProactiveTopicTimer()
      }
    },
  )

  watch(
    () => [
      memoryAdvancedSettings.settings.proactiveCheckInterval,
      memoryAdvancedSettings.settings.proactiveRandomInterval,
      memoryAdvancedSettings.settings.proactiveMinInterval,
      memoryAdvancedSettings.settings.proactiveMaxInterval,
    ],
    () => {
      if (memoryAdvancedSettings.settings.enableProactiveTopic) {
        stopProactiveTopicTimer()
        startProactiveTopicTimer()
      }
    },
  )

  async function handleSparkEmit(_: WebSocketBaseEvent<'spark:emit', WebSocketEvents['spark:emit']>) {
    // Currently no-op
    return undefined
  }

  function initialize(options?: { proactiveTopicPriority?: number }) {
    proactiveTopicPriority = options?.proactiveTopicPriority ?? 0
    startConversationActivityTracking()

    modsServerChannelStore.onEvent('spark:notify', async (event) => {
      try {
        await handleIncomingSparkNotify(event)
      }
      catch (error) {
        console.warn('Failed to handle spark:notify event:', error)
      }
    })

    modsServerChannelStore.onEvent('spark:emit', async (event) => {
      try {
        await handleSparkEmit(event)
      }
      catch (error) {
        console.warn('Failed to handle spark:emit event:', error)
      }
    })

    startTicker()
    startProactiveTopicTimer()
  }

  return {
    processing,
    pendingNotifies,
    scheduledNotifies,
    attentionConfig,
    lastProactiveTopicTime,
    lastConversationActivityAt,

    initialize,
    startTicker,
    stopTicker,
    startProactiveTopicTimer,
    stopProactiveTopicTimer,

    handleSparkNotify: handleIncomingSparkNotify,
    handleSparkEmit,
  }
})
