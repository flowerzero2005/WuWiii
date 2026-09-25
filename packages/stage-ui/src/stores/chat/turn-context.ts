import type { ContextMessage } from '../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'

export interface ChatTurnContextScope {
  personaCardId: string
  sessionId: string
}

type ContextBuckets = Record<string, ContextMessage[]>

/** Context ids computed for one chat turn and never retained for the next turn. */
export const TURN_CONTEXT_IDS = new Set([
  'character:performance-actions',
  'conversation-init',
  'memory-system-prompt',
  'memory-capture-prompt',
  'notebook-memory',
  'persona:anti-template-guard',
  'persona:emotion-chain',
  'persona:emotion-memory',
  'persona:psychological-cue',
  'persona:relationship-state',
  'persona:reply-feedback-memory',
  'persona:reply-intent',
  'persona:runtime-state',
  'persona:scene-mode',
  'persona:writing-craft',
  'system:datetime',
])

function copyContexts(source: Readonly<Record<string, readonly ContextMessage[]>>) {
  return Object.fromEntries(Object.entries(source)
    .filter(([contextId]) => !TURN_CONTEXT_IDS.has(contextId))
    .map(([contextId, messages]) => [contextId, messages.map(message => ({ ...message }))])) as ContextBuckets
}

function snapshotContexts(contexts: ContextBuckets) {
  return Object.fromEntries(Object.entries(contexts)
    .map(([contextId, messages]) => [contextId, messages.map(message => ({ ...message }))])) as Readonly<Record<string, readonly ContextMessage[]>>
}

/**
 * Owns only contexts calculated while composing one turn. Long-lived module
 * contexts are copied in, while stale turn contexts are deliberately excluded.
 */
export function createChatTurnContext(
  scope: ChatTurnContextScope,
  persistentContexts: Readonly<Record<string, readonly ContextMessage[]>>,
) {
  const contexts = copyContexts(persistentContexts)

  function ingestContextMessage(envelope: ContextMessage) {
    const contextId = envelope.contextId || 'unknown'
    const existing = contexts[contextId] ?? []

    contexts[contextId] = envelope.strategy === ContextUpdateStrategy.ReplaceSelf
      ? [{ ...envelope }]
      : [...existing, { ...envelope }]
  }

  function clearContext(contextId: string) {
    delete contexts[contextId]
  }

  function resetContexts(options?: { preserveContextIds?: readonly string[] }) {
    const preserved = new Set(options?.preserveContextIds ?? [])
    for (const contextId of Object.keys(contexts)) {
      if (!preserved.has(contextId))
        delete contexts[contextId]
    }
  }

  function getContextsSnapshot() {
    return snapshotContexts(contexts)
  }

  return {
    clearContext,
    getContextsSnapshot,
    ingestContextMessage,
    resetContexts,
    scope: Object.freeze({ ...scope }),
  }
}
