import type { CompletedChatTurnForMemory } from './memory-manager'

import { COMPLETED_MEMORY_WORK_PREFIX, isSessionMemoryWorkCancelled } from './session-memory-lifecycle'

const PREFIX = COMPLETED_MEMORY_WORK_PREFIX
const MAX_COMPLETED_RECEIPTS = 1024

function isCompletedReceipt(value: string | null) {
  return value === 'completed' || value?.startsWith('completed:') === true
}

/** Pending payloads and session-deletion tombstones are never eviction candidates. */
function pruneCompletedReceipts(storage: Storage, limit = MAX_COMPLETED_RECEIPTS) {
  const receipts: Array<{ key: string, completedAt: number }> = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(PREFIX))
      continue
    const value = storage.getItem(key)
    if (isCompletedReceipt(value))
      receipts.push({ key, completedAt: Number(value?.slice('completed:'.length)) || 0 })
  }
  receipts.sort((left, right) => right.completedAt - left.completedAt)
  for (const receipt of receipts.slice(limit))
    storage.removeItem(receipt.key)
}

export function memoryWorkKey(turn: CompletedChatTurnForMemory) {
  if (!turn.sourceSessionId || !turn.sourceAssistantMessageId)
    return undefined
  return PREFIX + JSON.stringify([turn.characterId, turn.sourceSessionId, turn.sourceUserMessageId, turn.sourceAssistantMessageId])
}

/** Only primary-completion candidates are journaled. Never persist a provider or replay chat. */
export function journalCompletedMemoryWork(turn: CompletedChatTurnForMemory) {
  try {
    if (isSessionMemoryWorkCancelled(turn.sourceSessionId))
      return false
    const key = memoryWorkKey(turn)
    // Legacy callers without stable message IDs can still persist candidates.
    if (!key)
      return true
    const storage = globalThis.localStorage
    if (!storage)
      throw new Error('Completed-turn memory storage is unavailable')
    if (isCompletedReceipt(storage.getItem(key)))
      return false
    pruneCompletedReceipts(storage)
    const { extractionRuntime, trace: _trace, ...source } = turn
    storage.setItem(key, JSON.stringify({
      ...source,
      extractionRuntime: { memoryCandidates: extractionRuntime?.memoryCandidates ?? [] },
    }))
  }
  catch (error) {
    // A journal quota/access failure must not turn a delivered reply into a
    // failed chat turn, or prevent the local notebook write from proceeding.
    console.warn('[MemoryJournal] Could not journal memory work; continuing local persistence:', error)
  }
  return true
}

export function completeMemoryWork(turn: CompletedChatTurnForMemory) {
  try {
    const key = memoryWorkKey(turn)
    if (!key)
      return
    const storage = globalThis.localStorage
    if (!storage)
      throw new Error('Completed-turn memory storage is unavailable')
    pruneCompletedReceipts(storage, MAX_COMPLETED_RECEIPTS - 1)
    storage.setItem(key, `completed:${Date.now()}`)
    pruneCompletedReceipts(storage)
  }
  catch (error) {
    // Candidate source keys in the notebook still make a later replay safe.
    console.warn('[MemoryJournal] Memory saved but completion receipt could not be written:', error)
  }
}

export function readPendingMemoryWork(): CompletedChatTurnForMemory[] {
  const storage = globalThis.localStorage
  if (!storage)
    return []
  try {
    pruneCompletedReceipts(storage)
  }
  catch (error) {
    console.warn('[MemoryJournal] Could not prune completion receipts:', error)
  }
  const pending: CompletedChatTurnForMemory[] = []
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(PREFIX))
      keys.push(key)
  }
  for (const key of keys) {
    const value = storage.getItem(key)
    if (!value || isCompletedReceipt(value))
      continue
    try {
      const turn = JSON.parse(value) as CompletedChatTurnForMemory
      if (memoryWorkKey(turn) !== key)
        continue
      if (isSessionMemoryWorkCancelled(turn.sourceSessionId)) {
        completeMemoryWork(turn)
        continue
      }
      pending.push(turn)
    }
    catch (error) {
      console.warn('[MemoryJournal] Could not read pending memory work:', error)
    }
  }
  return pending
}
