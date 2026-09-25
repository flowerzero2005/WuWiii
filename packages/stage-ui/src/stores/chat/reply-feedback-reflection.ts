import type {
  AiriReplyFeedbackMemoryState,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { replyFeedbackMemoryRepo } from '../../database/repos/reply-feedback-memory.repo'
import { replyFeedbackRepo } from '../../database/repos/reply-feedback.repo'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { useMemoryManager } from './memory-manager'
import {
  buildReplyFeedbackMemorySummary,
  DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_PRINCIPLES,
  DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_RECORDS,
  REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
} from './reply-feedback-summary'

function scopeKey(scope: AiriReplyFeedbackScope) {
  return `${scope.userId}::${scope.personaCardId}`
}

export const useReplyFeedbackReflectionStore = defineStore('reply-feedback-reflection', () => {
  const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
  const processingScopeKeys = ref<string[]>([])
  const processingByScope = new Map<string, Promise<void>>()

  let scheduledTimer: ReturnType<typeof setTimeout> | undefined
  let batchPromise: Promise<void> | null = null

  function setScopeProcessing(scope: AiriReplyFeedbackScope, active: boolean) {
    const key = scopeKey(scope)
    if (active) {
      if (!processingScopeKeys.value.includes(key))
        processingScopeKeys.value = [...processingScopeKeys.value, key]
      return
    }

    processingScopeKeys.value = processingScopeKeys.value.filter(item => item !== key)
  }

  function schedulePendingProcessing(delayMs = 80) {
    if (scheduledTimer)
      return

    scheduledTimer = setTimeout(() => {
      scheduledTimer = undefined
      void processPendingScopes()
    }, delayMs)
  }

  async function clearScopeLearning(scope: AiriReplyFeedbackScope) {
    const [snapshot, pending] = await Promise.all([
      replyFeedbackMemoryRepo.getSnapshot(scope),
      replyFeedbackMemoryRepo.getPending(scope),
    ])

    if (snapshot?.summary || pending)
      await replyFeedbackMemoryRepo.commitProcessedSummary(scope, null)

    try {
      const memoryManager = useMemoryManager()
      await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(scope, null)
      await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(scope, null)
    }
    catch (error) {
      console.warn('[ReplyFeedback] Failed to clear learning summary from notebook memory:', error)
    }
  }

  async function processScope(scope: AiriReplyFeedbackScope) {
    const key = scopeKey(scope)
    const existing = processingByScope.get(key)
    if (existing) {
      await existing
      return
    }

    const run = (async () => {
      const pending = await replyFeedbackMemoryRepo.getPending(scope)
      if (!pending)
        return

      setScopeProcessing(scope, true)

      try {
        if (!memoryAdvancedSettings.settings.enableReplyFeedbackLearning) {
          await clearScopeLearning(scope)
          return
        }

        const records = await replyFeedbackRepo.listRecords(scope, {
          limit: DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_RECORDS,
          includeDisabled: false,
        })
        const summary = buildReplyFeedbackMemorySummary({
          scope,
          records,
          maxPrinciples: DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_PRINCIPLES,
        })
        const result = await replyFeedbackMemoryRepo.commitProcessedSummary(scope, summary, {
          pendingToken: pending.token,
        })
        try {
          const memoryManager = useMemoryManager()
          await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(scope, summary)
          await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(scope, summary)
        }
        catch (error) {
          console.warn('[ReplyFeedback] Failed to sync learning summary into notebook memory:', error)
        }

        if (result.stale)
          schedulePendingProcessing(120)
      }
      catch (error) {
        console.warn('[ReplyFeedback] Failed to refresh learning summary:', error)
        schedulePendingProcessing(400)
      }
      finally {
        setScopeProcessing(scope, false)
      }
    })()

    processingByScope.set(key, run)

    try {
      await run
    }
    finally {
      if (processingByScope.get(key) === run)
        processingByScope.delete(key)
    }
  }

  async function processPendingScopes() {
    if (batchPromise) {
      await batchPromise
      return
    }

    const run = (async () => {
      const pendingScopes = await replyFeedbackMemoryRepo.listPendingScopes()
      for (const pendingScope of pendingScopes)
        await processScope(pendingScope)
    })()

    batchPromise = run

    try {
      await run
    }
    finally {
      if (batchPromise === run)
        batchPromise = null
    }
  }

  async function scheduleScopeRefresh(scope: AiriReplyFeedbackScope) {
    if (!memoryAdvancedSettings.settings.enableReplyFeedbackLearning) {
      await clearScopeLearning(scope)
      return
    }

    await replyFeedbackMemoryRepo.markPending(scope)
    schedulePendingProcessing()
  }

  async function ensureScopeRefreshScheduled(scope: AiriReplyFeedbackScope) {
    if (!memoryAdvancedSettings.settings.enableReplyFeedbackLearning) {
      await clearScopeLearning(scope)
      return
    }

    const pending = await replyFeedbackMemoryRepo.getPending(scope)
    if (!pending)
      await replyFeedbackMemoryRepo.markPending(scope)

    schedulePendingProcessing()
  }

  function buildMemoryState(
    scope: AiriReplyFeedbackScope,
    input: {
      summary: AiriReplyFeedbackMemoryState['summary']
      updatedAt?: number
      pendingUpdatedAt?: number
    },
  ): AiriReplyFeedbackMemoryState {
    const pending = Boolean(input.pendingUpdatedAt)
    const stale = Boolean(input.summary && pending && (!input.updatedAt || input.pendingUpdatedAt! >= input.updatedAt))

    return {
      ...scope,
      summary: input.summary,
      status: input.summary
        ? (stale ? 'stale' : pending ? 'refreshing' : 'ready')
        : (pending ? 'refreshing' : 'empty'),
      pending,
      stale,
      updatedAt: input.updatedAt,
      pendingUpdatedAt: input.pendingUpdatedAt,
    }
  }

  async function loadPersistedSummaryState(
    scope: AiriReplyFeedbackScope,
    options?: {
      warmIfMissing?: boolean
      waitForPending?: boolean
    },
  ) {
    if (!memoryAdvancedSettings.settings.enableReplyFeedbackLearning) {
      await clearScopeLearning(scope)

      return buildMemoryState(scope, {
        summary: null,
      })
    }

    let snapshot = await replyFeedbackMemoryRepo.getSnapshot(scope)
    let pending = await replyFeedbackMemoryRepo.getPending(scope)
    const schemaOutdated = Boolean(
      snapshot?.summary
      && snapshot.summary.schemaVersion !== REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    )
    const shouldWarm = (options?.warmIfMissing ?? true) && (!snapshot || pending || schemaOutdated)

    if (shouldWarm) {
      if (pending) {
        schedulePendingProcessing()
      }
      else {
        await ensureScopeRefreshScheduled(scope)
        pending = await replyFeedbackMemoryRepo.getPending(scope)
      }

      if (options?.waitForPending) {
        await processScope(scope)
        snapshot = await replyFeedbackMemoryRepo.getSnapshot(scope)
        pending = await replyFeedbackMemoryRepo.getPending(scope)
      }
    }

    return buildMemoryState(scope, {
      summary: snapshot?.summary ?? null,
      updatedAt: snapshot?.updatedAt,
      pendingUpdatedAt: pending?.updatedAt,
    })
  }

  async function loadPersistedSummary(
    scope: AiriReplyFeedbackScope,
    options?: {
      warmIfMissing?: boolean
      waitForPending?: boolean
    },
  ) {
    return (await loadPersistedSummaryState(scope, options)).summary
  }

  return {
    processingScopeKeys,

    loadPersistedSummary,
    loadPersistedSummaryState,
    processPendingScopes,
    processScope,
    scheduleScopeRefresh,
    clearScopeLearning,
  }
})
