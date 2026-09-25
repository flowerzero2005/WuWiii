import type {
  AiriReplyFeedbackIndex,
  AiriReplyFeedbackRecord,
  AiriReplyFeedbackRecordPatch,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { nanoid } from 'nanoid'

import { storage } from '../storage'

const REPLY_FEEDBACK_INDEX_VERSION = 1

const scopeWriteQueues = new Map<string, Promise<void>>()

function safeKeyPart(value: string) {
  return encodeURIComponent(value || 'default')
}

function scopeKey(scope: AiriReplyFeedbackScope) {
  return `${safeKeyPart(scope.userId)}/${safeKeyPart(scope.personaCardId)}`
}

function recordsPrefix(scope: AiriReplyFeedbackScope) {
  return `local:reply-feedback/records/${scopeKey(scope)}`
}

function recordKey(scope: AiriReplyFeedbackScope, feedbackId: string) {
  return `${recordsPrefix(scope)}/${safeKeyPart(feedbackId)}`
}

function indexKey(scope: AiriReplyFeedbackScope) {
  return `local:reply-feedback/index/${scopeKey(scope)}`
}

function createEmptyIndex(scope: AiriReplyFeedbackScope): AiriReplyFeedbackIndex {
  return {
    version: REPLY_FEEDBACK_INDEX_VERSION,
    userId: scope.userId,
    personaCardId: scope.personaCardId,
    recordIds: [],
    byAssistantMessageId: {},
    byAssistantTurnId: {},
    bySessionId: {},
    updatedAt: Date.now(),
  }
}

function uniquePush(list: string[], value: string) {
  if (!list.includes(value))
    list.push(value)
}

function uniqueUnshift(list: string[], value: string) {
  const existingIndex = list.indexOf(value)
  if (existingIndex !== -1)
    list.splice(existingIndex, 1)
  list.unshift(value)
}

function getIndexedAssistantMessageIds(record: Pick<AiriReplyFeedbackRecord, 'assistantMessageId' | 'siblingAssistantMessageIds'>) {
  return Array.from(new Set([
    record.assistantMessageId,
    ...(record.siblingAssistantMessageIds || []),
  ].filter(Boolean)))
}

function removeValue(list: string[] | undefined, value: string) {
  if (!list)
    return []

  return list.filter(item => item !== value)
}

function normalizeIndex(scope: AiriReplyFeedbackScope, index?: AiriReplyFeedbackIndex | null): AiriReplyFeedbackIndex {
  if (!index)
    return createEmptyIndex(scope)

  return {
    version: index.version || REPLY_FEEDBACK_INDEX_VERSION,
    userId: index.userId || scope.userId,
    personaCardId: index.personaCardId || scope.personaCardId,
    recordIds: Array.isArray(index.recordIds) ? [...index.recordIds] : [],
    byAssistantMessageId: { ...index.byAssistantMessageId },
    byAssistantTurnId: { ...index.byAssistantTurnId },
    bySessionId: { ...index.bySessionId },
    updatedAt: index.updatedAt || Date.now(),
    dirty: index.dirty,
  }
}

interface ListRecordsOptions {
  limit?: number
  includeDisabled?: boolean
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

function removeRecordFromIndex(index: AiriReplyFeedbackIndex, record: AiriReplyFeedbackRecord) {
  index.recordIds = removeValue(index.recordIds, record.id)

  for (const assistantMessageId of getIndexedAssistantMessageIds(record)) {
    if (index.byAssistantMessageId[assistantMessageId] === record.id)
      delete index.byAssistantMessageId[assistantMessageId]
  }

  if (record.assistantTurnId) {
    const nextTurnRecords = removeValue(index.byAssistantTurnId[record.assistantTurnId], record.id)
    if (nextTurnRecords.length)
      index.byAssistantTurnId[record.assistantTurnId] = nextTurnRecords
    else
      delete index.byAssistantTurnId[record.assistantTurnId]
  }

  const nextSessionRecords = removeValue(index.bySessionId[record.sessionId], record.id)
  if (nextSessionRecords.length)
    index.bySessionId[record.sessionId] = nextSessionRecords
  else
    delete index.bySessionId[record.sessionId]
}

function addRecordToIndex(index: AiriReplyFeedbackIndex, record: AiriReplyFeedbackRecord) {
  uniqueUnshift(index.recordIds, record.id)

  for (const assistantMessageId of getIndexedAssistantMessageIds(record))
    index.byAssistantMessageId[assistantMessageId] = record.id

  if (record.assistantTurnId) {
    index.byAssistantTurnId[record.assistantTurnId] ||= []
    uniquePush(index.byAssistantTurnId[record.assistantTurnId], record.id)
  }

  index.bySessionId[record.sessionId] ||= []
  uniquePush(index.bySessionId[record.sessionId], record.id)
}

async function deleteRecordById(scope: AiriReplyFeedbackScope, feedbackId: string) {
  return await withScopeWriteQueue(scope, async () => {
    const index = normalizeIndex(
      scope,
      await storage.getItemRaw<AiriReplyFeedbackIndex>(indexKey(scope)),
    )
    const record = await storage.getItemRaw<AiriReplyFeedbackRecord>(recordKey(scope, feedbackId))
    if (!record)
      return undefined

    removeRecordFromIndex(index, record)
    index.updatedAt = Date.now()
    await storage.removeItem(recordKey(scope, feedbackId))
    await storage.setItemRaw(indexKey(index), {
      ...index,
      updatedAt: index.updatedAt,
    })

    return record
  })
}

export const replyFeedbackRepo = {
  async getIndex(scope: AiriReplyFeedbackScope) {
    const raw = await storage.getItemRaw<AiriReplyFeedbackIndex>(indexKey(scope))
    return normalizeIndex(scope, raw)
  },

  async saveIndex(index: AiriReplyFeedbackIndex) {
    await storage.setItemRaw(indexKey(index), {
      ...index,
      updatedAt: Date.now(),
    })
  },

  async getRecord(scope: AiriReplyFeedbackScope, feedbackId: string) {
    return await storage.getItemRaw<AiriReplyFeedbackRecord>(recordKey(scope, feedbackId))
  },

  async getRecordsByIds(scope: AiriReplyFeedbackScope, feedbackIds: string[]) {
    const records = await Promise.all(feedbackIds.map(id => this.getRecord(scope, id)))
    return records.filter((record): record is AiriReplyFeedbackRecord => Boolean(record && !record.deletedAt))
  },

  async listRecords(scope: AiriReplyFeedbackScope, options?: ListRecordsOptions) {
    const index = await this.getIndex(scope)
    const includeDisabled = options?.includeDisabled ?? true

    if (!options?.limit && includeDisabled) {
      return await this.getRecordsByIds(scope, index.recordIds)
    }

    const records: AiriReplyFeedbackRecord[] = []

    for (const feedbackId of index.recordIds) {
      const record = await this.getRecord(scope, feedbackId)
      if (!record || record.deletedAt)
        continue

      if (!includeDisabled && record.disabledAt)
        continue

      records.push(record)

      if (options?.limit && records.length >= options.limit)
        break
    }

    return records
  },

  async getFeedbackForAssistantMessages(scope: AiriReplyFeedbackScope, assistantMessageIds: string[]) {
    const index = await this.getIndex(scope)
    const feedbackIds = Array.from(new Set(assistantMessageIds
      .map(id => index.byAssistantMessageId[id])
      .filter((id): id is string => Boolean(id))))
    return await this.getRecordsByIds(scope, feedbackIds)
  },

  async upsertFeedback(record: Omit<AiriReplyFeedbackRecord, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string
    createdAt?: number
    updatedAt?: number
  }) {
    return await withScopeWriteQueue(record, async () => {
      const now = Date.now()
      const index = await this.getIndex(record)
      const existingId = index.byAssistantMessageId[record.assistantMessageId]
      const id = existingId || record.id || nanoid()
      const existing = existingId ? await this.getRecord(record, existingId) : undefined
      const nextRecord: AiriReplyFeedbackRecord = {
        ...existing,
        ...record,
        id,
        createdAt: existing?.createdAt || record.createdAt || now,
        updatedAt: now,
      }

      if (existing)
        removeRecordFromIndex(index, existing)

      addRecordToIndex(index, nextRecord)
      index.updatedAt = now
      index.dirty = false

      await storage.setItemRaw(recordKey(record, id), nextRecord)
      await this.saveIndex(index)

      return nextRecord
    })
  },

  async updateFeedback(scope: AiriReplyFeedbackScope, feedbackId: string, patch: AiriReplyFeedbackRecordPatch) {
    const existing = await this.getRecord(scope, feedbackId)
    if (!existing || existing.deletedAt)
      return undefined

    return await this.upsertFeedback({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
    })
  },

  async deleteFeedbackForAssistantMessage(scope: AiriReplyFeedbackScope, assistantMessageId: string) {
    const index = await this.getIndex(scope)
    const feedbackId = index.byAssistantMessageId[assistantMessageId]
    if (!feedbackId)
      return undefined

    return await deleteRecordById(scope, feedbackId)
  },

  async deleteFeedback(scope: AiriReplyFeedbackScope, feedbackId: string) {
    return await deleteRecordById(scope, feedbackId)
  },

  async rebuildIndex(scope: AiriReplyFeedbackScope) {
    return await withScopeWriteQueue(scope, async () => {
      const nextIndex = createEmptyIndex(scope)
      const keys = await storage.getKeys(recordsPrefix(scope))
      const records = await Promise.all(keys.map(async (key) => {
        return await storage.getItemRaw<AiriReplyFeedbackRecord>(key)
      }))

      for (const record of records) {
        if (!record || record.deletedAt)
          continue
        addRecordToIndex(nextIndex, record)
      }

      nextIndex.updatedAt = Date.now()
      await this.saveIndex(nextIndex)
      return nextIndex
    })
  },
}
