import type { ContextMessage } from '../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'

export type ChatContextScope
  = { type: 'global' }
    | { type: 'session', sessionId: string }
    | { type: 'persona', personaCardId: string }
    | { type: 'turn', turnId: string }

export interface ChatContextSnapshotScope {
  sessionId?: string
  personaCardId?: string
  turnId?: string
}

/** Context messages may carry scope over BroadcastChannel without changing the server SDK contract. */
export type ScopedContextMessage = ContextMessage & { contextScope?: ChatContextScope }

const GLOBAL_CONTEXT_SCOPE: ChatContextScope = Object.freeze({ type: 'global' })

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeChatContextScope(value: unknown): ChatContextScope | null {
  if (!value || typeof value !== 'object')
    return null

  const candidate = value as Record<string, unknown>
  switch (candidate.type) {
    case 'session':
      return isNonEmptyString(candidate.sessionId) ? { type: 'session', sessionId: candidate.sessionId } : null
    case 'persona':
      return isNonEmptyString(candidate.personaCardId) ? { type: 'persona', personaCardId: candidate.personaCardId } : null
    case 'turn':
      return isNonEmptyString(candidate.turnId) ? { type: 'turn', turnId: candidate.turnId } : null
    case 'global':
      return GLOBAL_CONTEXT_SCOPE
    default:
      return null
  }
}

export function resolveExternalChatContextScope(value: unknown, fallbackSessionId?: string): ChatContextScope | null {
  return normalizeChatContextScope(value)
    ?? (isNonEmptyString(fallbackSessionId) ? { type: 'session', sessionId: fallbackSessionId } : null)
}

function scopesEqual(left: ChatContextScope, right: ChatContextScope) {
  if (left.type !== right.type)
    return false
  if (left.type === 'session' && right.type === 'session')
    return left.sessionId === right.sessionId
  if (left.type === 'persona' && right.type === 'persona')
    return left.personaCardId === right.personaCardId
  if (left.type === 'turn' && right.type === 'turn')
    return left.turnId === right.turnId
  return true
}

function matchesSnapshotScope(scope: ChatContextScope, selection?: ChatContextSnapshotScope) {
  if (scope.type === 'global')
    return true
  if (!selection)
    return false
  if (scope.type === 'session')
    return selection.sessionId === scope.sessionId
  if (scope.type === 'persona')
    return selection.personaCardId === scope.personaCardId
  return selection.turnId === scope.turnId
}

function cloneMessage(message: ScopedContextMessage): ScopedContextMessage {
  const clone = { ...toRaw(message) }
  if (message.contextScope) {
    const scope = normalizeChatContextScope(message.contextScope)
    if (scope)
      clone.contextScope = scope
    else
      delete clone.contextScope
  }
  return clone
}

export const useChatContextStore = defineStore('chat-context', () => {
  interface StoredContext {
    message: ScopedContextMessage
    scope: ChatContextScope
  }
  const activeContexts = ref<Record<string, StoredContext[]>>({})

  function ingestContextMessage(envelope: ScopedContextMessage, explicitScope?: ChatContextScope) {
    // Use contextId as the key for grouping contexts
    const sourceKey = envelope.contextId || 'unknown'
    const scope = normalizeChatContextScope(explicitScope ?? envelope.contextScope)
    if (!scope)
      return false

    const stored = { message: cloneMessage(envelope), scope } satisfies StoredContext

    if (!activeContexts.value[sourceKey]) {
      activeContexts.value[sourceKey] = []
    }

    if (envelope.strategy === ContextUpdateStrategy.ReplaceSelf) {
      activeContexts.value[sourceKey] = activeContexts.value[sourceKey]
        .filter(entry => !scopesEqual(entry.scope, scope))
        .concat(stored)
    }
    else if (envelope.strategy === ContextUpdateStrategy.AppendSelf) {
      activeContexts.value[sourceKey] = [...activeContexts.value[sourceKey], stored]
    }

    return true
  }

  function resetContexts() {
    activeContexts.value = {}
  }

  function clearContextsForSession(sessionId: string) {
    for (const contextId of Object.keys(activeContexts.value))
      clearContext(contextId, { type: 'session', sessionId })
  }

  function clearContext(contextId: string, scope?: ChatContextScope) {
    if (!activeContexts.value[contextId])
      return

    if (scope) {
      const normalizedScope = normalizeChatContextScope(scope)
      if (!normalizedScope)
        return
      const remaining = activeContexts.value[contextId].filter(entry => !scopesEqual(entry.scope, normalizedScope))
      if (remaining.length) {
        activeContexts.value = { ...activeContexts.value, [contextId]: remaining }
      }
      else {
        const nextContexts = { ...activeContexts.value }
        delete nextContexts[contextId]
        activeContexts.value = nextContexts
      }
      return
    }

    const nextContexts = { ...activeContexts.value }
    delete nextContexts[contextId]
    activeContexts.value = nextContexts
  }

  function getContextsSnapshot(selection?: ChatContextSnapshotScope): Record<string, ContextMessage[]> {
    const snapshot: Record<string, ContextMessage[]> = {}
    for (const [contextId, entries] of Object.entries(toRaw(activeContexts.value))) {
      const messages = entries
        .filter(entry => matchesSnapshotScope(entry.scope, selection))
        .map(entry => Object.freeze(cloneMessage(entry.message)))
      if (messages.length)
        snapshot[contextId] = Object.freeze(messages) as unknown as ContextMessage[]
    }
    return Object.freeze(snapshot) as Record<string, ContextMessage[]>
  }

  return {
    ingestContextMessage,
    resetContexts,
    clearContextsForSession,
    clearContext,
    getContextsSnapshot,
  }
})
