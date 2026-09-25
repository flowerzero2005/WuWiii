import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatContextStore } from './context-store'

describe('chat context store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('clears a previously ingested context bucket', () => {
    const store = useChatContextStore()

    store.ingestContextMessage({
      id: 'ctx-1',
      contextId: 'persona:reply-feedback-memory',
      contextScope: { type: 'global' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'feedback summary',
      createdAt: 123,
    })

    expect(store.getContextsSnapshot()).toEqual({
      'persona:reply-feedback-memory': [{
        id: 'ctx-1',
        contextId: 'persona:reply-feedback-memory',
        contextScope: { type: 'global' },
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: 'feedback summary',
        createdAt: 123,
      }],
    })

    store.clearContext('persona:reply-feedback-memory')

    expect(store.getContextsSnapshot()).toEqual({})
  })

  it('requires global scope explicitly and selects only matching scoped messages', () => {
    const store = useChatContextStore()

    expect(store.ingestContextMessage({
      id: 'unscoped',
      contextId: 'shared',
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'must not leak globally',
      createdAt: 122,
    })).toBe(false)
    store.ingestContextMessage({
      id: 'global',
      contextId: 'shared',
      contextScope: { type: 'global' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'global context',
      createdAt: 123,
    })
    store.ingestContextMessage({
      id: 'session-a',
      contextId: 'shared',
      contextScope: { type: 'session', sessionId: 'session-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'session A context',
      createdAt: 124,
    })
    store.ingestContextMessage({
      id: 'persona-a',
      contextId: 'shared',
      contextScope: { type: 'persona', personaCardId: 'persona-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'persona A context',
      createdAt: 125,
    })
    store.ingestContextMessage({
      id: 'turn-a',
      contextId: 'shared',
      contextScope: { type: 'turn', turnId: 'turn-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'turn A context',
      createdAt: 126,
    })

    expect(store.getContextsSnapshot()).toMatchObject({
      shared: [{ id: 'global', text: 'global context' }],
    })
    expect(store.getContextsSnapshot({ sessionId: 'session-a' })).toMatchObject({
      shared: [
        { id: 'global', text: 'global context' },
        { id: 'session-a', text: 'session A context' },
      ],
    })
    expect(store.getContextsSnapshot({ sessionId: 'session-b' })).toMatchObject({
      shared: [{ id: 'global', text: 'global context' }],
    })
    expect(store.getContextsSnapshot({ personaCardId: 'persona-a' })).toMatchObject({
      shared: [
        { id: 'global', text: 'global context' },
        { id: 'persona-a', text: 'persona A context' },
      ],
    })
    expect(store.getContextsSnapshot({ turnId: 'turn-a' })).toMatchObject({
      shared: [
        { id: 'global', text: 'global context' },
        { id: 'turn-a', text: 'turn A context' },
      ],
    })
  })

  it('does not expose one session context to another session', () => {
    const store = useChatContextStore()

    store.ingestContextMessage({
      id: 'private-a',
      contextId: 'external-private',
      contextScope: { type: 'session', sessionId: 'session-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'session A only',
      createdAt: 123,
    })

    expect(store.getContextsSnapshot({ sessionId: 'session-a' })).toHaveProperty('external-private')
    expect(store.getContextsSnapshot({ sessionId: 'session-b' })).toEqual({})
  })

  it('replaces only the matching scope and returns an immutable snapshot', () => {
    const store = useChatContextStore()

    store.ingestContextMessage({
      id: 'session-old',
      contextId: 'scoped',
      contextScope: { type: 'session', sessionId: 'session-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'old',
      createdAt: 123,
    })
    store.ingestContextMessage({
      id: 'session-new',
      contextId: 'scoped',
      contextScope: { type: 'session', sessionId: 'session-a' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'new',
      createdAt: 124,
    })
    store.ingestContextMessage({
      id: 'session-b',
      contextId: 'scoped',
      contextScope: { type: 'session', sessionId: 'session-b' },
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: 'B',
      createdAt: 125,
    })

    const snapshot = store.getContextsSnapshot({ sessionId: 'session-a' })
    expect(snapshot.scoped).toHaveLength(1)
    expect(snapshot.scoped?.[0].id).toBe('session-new')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.scoped)).toBe(true)
    expect(Object.isFrozen(snapshot.scoped?.[0])).toBe(true)
  })
})
