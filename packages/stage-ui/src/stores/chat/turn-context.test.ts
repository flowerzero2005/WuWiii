import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it } from 'vitest'

import { createChatTurnContext } from './turn-context'

function context(contextId: string, text: string) {
  return {
    id: `${contextId}:${text}`,
    contextId,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: 1,
  }
}

describe('createChatTurnContext', () => {
  it('does not carry notebook memory from one session into another', () => {
    const first = createChatTurnContext({ sessionId: 'session-a', personaCardId: 'persona-a' }, {})
    first.ingestContextMessage(context('notebook-memory', 'A private memory'))

    const second = createChatTurnContext({ sessionId: 'session-b', personaCardId: 'persona-b' }, first.getContextsSnapshot())
    second.ingestContextMessage(context('notebook-memory', ''))

    expect(second.getContextsSnapshot()).toEqual({
      'notebook-memory': [context('notebook-memory', '')],
    })
    expect(second.scope).toEqual({ sessionId: 'session-b', personaCardId: 'persona-b' })
  })

  it('filters every context regenerated for a new turn', () => {
    const turn = createChatTurnContext({ sessionId: 'session-a', personaCardId: 'persona-a' }, {
      'memory-system-prompt': [context('memory-system-prompt', 'Persistent memory rules')],
      'persona:emotion-memory': [context('persona:emotion-memory', 'Stale emotion memory')],
    })

    expect(turn.getContextsSnapshot()).toEqual({})
  })

  it('can preserve the app capability contract while resetting group-turn context', () => {
    const capability = context('desktop:app-tools', 'No action exists without a successful tool result.')
    const turn = createChatTurnContext({ sessionId: 'group-a', personaCardId: 'persona-a' }, {
      'desktop:app-tools': [capability],
      'external:temporary': [context('external:temporary', 'Remove me')],
    })

    turn.resetContexts({ preserveContextIds: ['desktop:app-tools'] })

    expect(turn.getContextsSnapshot()).toEqual({
      'desktop:app-tools': [capability],
    })
  })
})
