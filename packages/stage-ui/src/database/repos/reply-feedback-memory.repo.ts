import type {
  AiriReplyFeedbackMemoryPendingEntry,
  AiriReplyFeedbackMemorySnapshot,
  AiriReplyFeedbackMemorySummary,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { nanoid } from 'nanoid'

import { storage } from '../storage'

const scopeWriteQueues = new Map<string, Promise<void>>()

function safeKeyPart(value: string) {
  return encodeURIComponent(value || 'default')
}

function decodeKeyPart(value: string) {
  try {
    return decodeURIComponent(value || 'default')
  }
  catch {
    return value || 'default'
  }
}

function scopeKey(scope: AiriReplyFeedbackScope) {
  return `${safeKeyPart(scope.userId)}/${safeKeyPart(scope.personaCardId)}`
}

function summaryKey(scope: AiriReplyFeedbackScope) {
  return `local:reply-feedback-memory/summaries/${scopeKey(scope)}`
}

function pendingKey(scope: AiriReplyFeedbackScope) {
  return `local:reply-feedback-memory/pending/${scopeKey(scope)}`
}

function pendingPrefix() {
  return 'local:reply-feedback-memory/pending/'
}

function normalizeSnapshot(scope: AiriReplyFeedbackScope, snapshot?: AiriReplyFeedbackMemorySnapshot | null) {
  if (!snapshot)
    return null

  return {
    userId: snapshot.userId || scope.userId,
    personaCardId: snapshot.personaCardId || scope.personaCardId,
    summary: snapshot.summary || null,
    updatedAt: snapshot.updatedAt || snapshot.summary?.generatedAt || Date.now(),
  } satisfies AiriReplyFeedbackMemorySnapshot
}

function normalizePendingEntry(scope: AiriReplyFeedbackScope, entry?: AiriReplyFeedbackMemoryPendingEntry | null) {
  if (!entry)
    return null

  return {
    userId: entry.userId || scope.userId,
    personaCardId: entry.personaCardId || scope.personaCardId,
    token: entry.token || 'pending',
    updatedAt: entry.updatedAt || Date.now(),
  } satisfies AiriReplyFeedbackMemoryPendingEntry
}

function parseScopeFromKey(key: string) {
  const prefix = pendingPrefix()
  if (!key.startsWith(prefix))
    return null

  const suffix = key.slice(prefix.length)
  const [userId, personaCardId] = suffix.split('/')
  if (!userId || !personaCardId)
    return null

  return {
    userId: decodeKeyPart(userId),
    personaCardId: decodeKeyPart(personaCardId),
  } satisfies AiriReplyFeedbackScope
}

async function withScopeWriteQueue<T>(scope: AiriReplyFeedbackScope, task: () => Promise<T>): Promise<T> {
  const key = scopeKey(scope)
  const previous = scopeWriteQueues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  const stored = run.then(() => undefined, () => undefined)
  scopeWriteQueues.set(key, stored)

  try {
    return await run
  }
  finally {
    if (scopeWriteQueues.get(key) === stored)
      scopeWriteQueues.delete(key)
  }
}

export const replyFeedbackMemoryRepo = {
  async getSnapshot(scope: AiriReplyFeedbackScope) {
    return normalizeSnapshot(
      scope,
      await storage.getItemRaw<AiriReplyFeedbackMemorySnapshot>(summaryKey(scope)),
    )
  },

  async getSummary(scope: AiriReplyFeedbackScope) {
    return (await this.getSnapshot(scope))?.summary ?? null
  },

  async saveSnapshot(scope: AiriReplyFeedbackScope, summary: AiriReplyFeedbackMemorySummary | null) {
    return await withScopeWriteQueue(scope, async () => {
      const snapshot = {
        ...scope,
        summary,
        updatedAt: Date.now(),
      } satisfies AiriReplyFeedbackMemorySnapshot

      await storage.setItemRaw(summaryKey(scope), snapshot)
      return snapshot
    })
  },

  async getPending(scope: AiriReplyFeedbackScope) {
    return normalizePendingEntry(
      scope,
      await storage.getItemRaw<AiriReplyFeedbackMemoryPendingEntry>(pendingKey(scope)),
    )
  },

  async markPending(scope: AiriReplyFeedbackScope) {
    return await withScopeWriteQueue(scope, async () => {
      const entry = {
        ...scope,
        token: nanoid(),
        updatedAt: Date.now(),
      } satisfies AiriReplyFeedbackMemoryPendingEntry

      await storage.setItemRaw(pendingKey(scope), entry)
      return entry
    })
  },

  async listPendingScopes() {
    const keys = await storage.getKeys(pendingPrefix())
    const entries = await Promise.all(keys.map(async (key) => {
      const scope = parseScopeFromKey(key)
      if (!scope)
        return null

      const entry = await storage.getItemRaw<AiriReplyFeedbackMemoryPendingEntry>(key)
      return normalizePendingEntry(scope, entry)
    }))

    return entries
      .filter((entry): entry is AiriReplyFeedbackMemoryPendingEntry => Boolean(entry))
      .sort((left, right) => left.updatedAt - right.updatedAt)
  },

  async clearPending(scope: AiriReplyFeedbackScope, options?: { token?: string }) {
    return await withScopeWriteQueue(scope, async () => {
      const current = normalizePendingEntry(
        scope,
        await storage.getItemRaw<AiriReplyFeedbackMemoryPendingEntry>(pendingKey(scope)),
      )
      if (!current)
        return false

      if (options?.token && current.token !== options.token)
        return false

      await storage.removeItem(pendingKey(scope))
      return true
    })
  },

  async commitProcessedSummary(
    scope: AiriReplyFeedbackScope,
    summary: AiriReplyFeedbackMemorySummary | null,
    options?: { pendingToken?: string },
  ) {
    return await withScopeWriteQueue(scope, async () => {
      const snapshot = {
        ...scope,
        summary,
        updatedAt: Date.now(),
      } satisfies AiriReplyFeedbackMemorySnapshot

      await storage.setItemRaw(summaryKey(scope), snapshot)

      const currentPending = normalizePendingEntry(
        scope,
        await storage.getItemRaw<AiriReplyFeedbackMemoryPendingEntry>(pendingKey(scope)),
      )
      if (!currentPending)
        return { snapshot, stale: false }

      if (options?.pendingToken && currentPending.token !== options.pendingToken) {
        return {
          snapshot,
          stale: true,
          pending: currentPending,
        }
      }

      await storage.removeItem(pendingKey(scope))
      return { snapshot, stale: false }
    })
  },
}
