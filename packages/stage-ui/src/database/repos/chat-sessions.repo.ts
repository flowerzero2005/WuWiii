import type { ChatSessionRecord, ChatSessionsIndex } from '../../types/chat-session'

import { isReactive, isReadonly, toRaw } from 'vue'

import { storage } from '../storage'

/**
 * IndexedDB uses the structured clone algorithm, which cannot clone Vue
 * reactive proxies. Session metadata can contain reactive participant
 * snapshots when it is assembled from the settings UI, so unwrap those
 * proxies at the persistence boundary before writing.
 */
function unwrapReactive<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object')
    return value

  const source = isReactive(value) || isReadonly(value) ? toRaw(value) : value
  if (source === null || typeof source !== 'object')
    return source as T

  const existing = seen.get(source)
  if (existing)
    return existing as T

  if (Array.isArray(source)) {
    const output: unknown[] = []
    seen.set(source, output)
    for (const item of source)
      output.push(unwrapReactive(item, seen))
    return output as T
  }

  // Preserve structured-clone-compatible built-ins (Date, Map, Blob, etc.).
  // Chat records otherwise contain plain objects and arrays only.
  const prototype = Object.getPrototypeOf(source)
  if (prototype !== Object.prototype && prototype !== null)
    return source as T

  const output: Record<string, unknown> = {}
  seen.set(source, output)
  for (const [key, item] of Object.entries(source as Record<string, unknown>))
    output[key] = unwrapReactive(item, seen)
  return output as T
}

function sanitizeForPersistence(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined)
    return value
  if (typeof value === 'function' || typeof value === 'symbol')
    return undefined
  if (value instanceof Date)
    return value.toISOString()
  if (value instanceof URL)
    return value.toString()
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack }
  if (typeof Window !== 'undefined' && value instanceof Window)
    return '[Window]'
  if (typeof Document !== 'undefined' && value instanceof Document)
    return '[Document]'
  if (typeof Node !== 'undefined' && value instanceof Node)
    return '[DOMNode]'
  if (typeof value !== 'object')
    return value
  if (seen.has(value))
    return '[Circular]'

  seen.add(value)
  if (Array.isArray(value)) {
    const output = value.map(item => sanitizeForPersistence(item, seen))
    seen.delete(value)
    return output
  }

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeForPersistence(item, seen)
    if (sanitized !== undefined)
      output[key] = sanitized
  }
  seen.delete(value)
  return output
}

function cloneForPersistence<T>(value: T): T {
  const unwrapped = unwrapReactive(value)
  try {
    if (typeof structuredClone === 'function')
      return structuredClone(unwrapped)
  }
  catch {
    // A tool result can still contain a browser-native value that IndexedDB
    // cannot clone. Reduce it to a plain data snapshot as a final fallback.
  }
  return sanitizeForPersistence(unwrapped) as T
}

export const chatSessionsRepo = {
  async getIndex(userId: string) {
    const key = `local:chat/index/${userId}`
    return await storage.getItemRaw<ChatSessionsIndex>(key)
  },

  async saveIndex(index: ChatSessionsIndex) {
    // Explicit replacement only. Incremental callers read and patch the latest
    // index under the user index lock; deleted entries must never be unioned.
    const key = `local:chat/index/${index.userId}`
    await storage.setItemRaw(key, cloneForPersistence(index))
  },

  async getSession(sessionId: string) {
    const key = `local:chat/sessions/${sessionId}`
    return await storage.getItemRaw<ChatSessionRecord>(key)
  },

  async saveSession(sessionId: string, record: ChatSessionRecord) {
    const key = `local:chat/sessions/${sessionId}`
    await storage.setItemRaw(key, cloneForPersistence(record))
  },

  // Cleanup
  async deleteSession(sessionId: string) {
    await storage.removeItem(`local:chat/sessions/${sessionId}`)
  },
}
