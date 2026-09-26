/* eslint-disable style/indent-binary-ops */
/* eslint-disable style/operator-linebreak */

import type { WebSocketEventOf } from '@proj-airi/server-sdk'
import type { Store, StoreDefinition } from 'pinia'
import type { Mock } from 'vitest'
import type { UnwrapRef } from 'vue'
import type z from 'zod'

import type { StreamEvent } from '../../llm'
import type { AiriCard } from '../../modules'

import { createTestingPinia } from '@pinia/testing'
import { tool } from '@xsai/tool'
import { nanoid } from 'nanoid'
import { setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { sparkCommandSchema, useCharacterOrchestratorStore } from '.'
import { useCharacterStore } from '..'
import { useChatOrchestratorStore } from '../../chat'
import { useLLM } from '../../llm'
import { useAiriCardStore, useConsciousnessStore } from '../../modules'
import { useProvidersStore } from '../../providers'
import { useMemoryAdvancedSettingsStore } from '../../settings/memory-advanced'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@proj-airi/stage-ui-live2d', () => ({
  useLive2d: () => ({}),
}))

vi.mock('@proj-airi/stage-ui-live2d/stores/live2d', () => ({
  createLive2DPerformanceExpressionResourceId: () => '',
  createLive2DPerformanceMotionResourceId: () => '',
  filterLive2DCompositeExpressionPresetsByModel: () => [],
  useLive2d: () => ({
    activeActionModelId: undefined,
    broadcastLive2DActionRequest: vi.fn(),
    capabilitiesByModel: {},
    compositeExpressionPresets: {},
    performanceResourceMetadataByModel: {},
    setActiveActionModel: vi.fn(),
    waitForCapabilities: vi.fn().mockResolvedValue(false),
  }),
}))

vi.mock('@proj-airi/stage-ui-live2d/utils/action-debug', () => ({
  logLive2DActionEvent: vi.fn(),
  warnLive2DActionEvent: vi.fn(),
}))

vi.mock('../../chat', async () => {
  const { defineStore } = await import('pinia')
  return {
    useChatOrchestratorStore: defineStore('chat-orchestrator-test', () => {
      const beforeSendHandlers: Array<(message: unknown, context: unknown) => unknown> = []
      const turnCompleteHandlers: Array<(chat: unknown, context: unknown) => unknown> = []
      return {
        ingest: vi.fn().mockResolvedValue(undefined),
        onBeforeSend: (handler: (message: unknown, context: unknown) => unknown) => {
          beforeSendHandlers.push(handler)
          return () => undefined
        },
        onChatTurnComplete: (handler: (chat: unknown, context: unknown) => unknown) => {
          turnCompleteHandlers.push(handler)
          return () => undefined
        },
        emitBeforeSendHooks: async (message: unknown, context: unknown) => {
          for (const handler of beforeSendHandlers)
            await handler(message, context)
        },
        emitChatTurnCompleteHooks: async (chat: unknown, context: unknown) => {
          for (const handler of turnCompleteHandlers)
            await handler(chat, context)
        },
      }
    }),
  }
})

vi.mock('../../mods/api/channel-server', async () => {
  const { defineStore } = await import('pinia')
  return {
    useModsServerChannelStore: defineStore('mods-server-channel', () => ({
      onEvent: vi.fn(),
      send: vi.fn(),
    })),
  }
})

function mockedStore<TStoreDef extends () => unknown>(
  useStore: TStoreDef,
): TStoreDef extends StoreDefinition<
  infer Id,
  infer State,
  infer Getters,
  infer Actions
>
  ? Store<
    Id,
    State,
    Record<string, never>,
    {
      [K in keyof Actions]: Actions[K] extends (...args: any[]) => any
        ? // 👇 depends on your testing framework
        Mock<Actions[K]>
        : Actions[K]
    }
  > & {
    [K in keyof Getters]: UnwrapRef<Getters[K]>
  }
  : ReturnType<TStoreDef> {
  return useStore() as any
}

function getObjectSchema(schema?: Record<string, any>) {
  if (!schema)
    return undefined

  if (schema.type === 'object')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]
  return candidates.find((candidate: Record<string, any>) => candidate?.type === 'object')
}

function getArraySchema(schema?: Record<string, any>) {
  if (!schema)
    return undefined

  if (schema.type === 'array')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]
  return candidates.find((candidate: Record<string, any>) => candidate?.type === 'array')
}

describe('sparkCommandSchema', () => {
  it('emits strict objects in the json schema', async () => {
    const sparkTool = await tool({
      name: 'builtIn_sparkCommand',
      description: 'test',
      parameters: sparkCommandSchema,
      execute: async () => undefined,
    })

    const schema = sparkTool.function.parameters as Record<string, any>
    const commandsSchema = getArraySchema(schema.properties?.commands)
    const commandItemSchema = getObjectSchema(commandsSchema?.items)
    const guidanceSchema = getObjectSchema(commandItemSchema?.properties?.guidance)
    const personaSchema = getArraySchema(guidanceSchema?.properties?.persona)
    const personaItemSchema = getObjectSchema(personaSchema?.items)
    const optionsSchema = getArraySchema(guidanceSchema?.properties?.options)
    const optionsItemSchema = getObjectSchema(optionsSchema?.items)

    expect(schema.additionalProperties).toBe(false)
    expect(commandItemSchema?.additionalProperties).toBe(false)
    expect(guidanceSchema?.additionalProperties).toBe(false)
    expect(personaItemSchema?.additionalProperties).toBe(false)
    expect(optionsItemSchema?.additionalProperties).toBe(false)
  })
})

describe('store character-orchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 26, 10))
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })

    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    setActivePinia(pinia)

    const mockGetProviderInstance = vi.fn()
    mockedStore(useProvidersStore).getProviderInstance = mockGetProviderInstance
    mockedStore(useProvidersStore).getProviderInstance.mockResolvedValue({ chat: (_model: string) => ({} as any) })

    const consciousnessStore = useConsciousnessStore(pinia)
    consciousnessStore.activeProvider = 'mock-provider'
    consciousnessStore.activeModel = 'mock-model'

    const airiCardStore = useAiriCardStore(pinia)
    // @ts-expect-error - testing purpose
    airiCardStore.systemPrompt = 'You are a brave adventurer in Minecraft.'
    // @ts-expect-error - testing purpose
    airiCardStore.activeCard = {
      name: 'Hero',
      version: '1.0',
      extensions: {
        airi: {
          agents: {},
          modules: {
            consciousness: {
              provider: 'mock-provider',
              model: 'mock-model',
            },
            speech: {
              provider: 'mock-speech-provider',
              model: 'mock-speech-model',
              voice_id: 'alloy',
            },
          },
        },
      },
    } satisfies AiriCard
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('handles immediate spark:notify with reaction and commands', async () => {
    const mockStream = vi.fn()
    mockedStore(useLLM).stream = mockStream
    mockedStore(useLLM).stream.mockImplementation(async (_model: string, _provider: unknown, _messages: unknown, options: any) => {
      if (options?.tools?.length) {
        await options.tools[1].execute({ commands: [{
          destinations: ['minecraft'],
          intent: 'action',
          priority: 'critical',
          interrupt: 'false',
          ack: 'ok',
          guidance: null,
        }] } satisfies z.infer<typeof sparkCommandSchema>)
      }

      await options?.onStreamEvent?.({ type: 'text-delta', text: 'Ahhh, got hit by zombie!' } satisfies StreamEvent)
      await options?.onStreamEvent?.({ type: 'finish' } satisfies StreamEvent)
      return undefined
    })

    const mockOnSparkNotifyReactionStreamEvent = vi.fn()
    mockedStore(useCharacterStore).onSparkNotifyReactionStreamEvent = mockOnSparkNotifyReactionStreamEvent
    const mockOnSparkNotifyReactionStreamEnd = vi.fn()
    mockedStore(useCharacterStore).onSparkNotifyReactionStreamEnd = mockOnSparkNotifyReactionStreamEnd

    const store = useCharacterOrchestratorStore()
    const event: WebSocketEventOf<'spark:notify'> = {
      type: 'spark:notify',
      source: 'minecraft',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'alarm',
        urgency: 'immediate',
        headline: 'Hit by zombie',
        destinations: ['character'],
      },
    }

    const result = await store.handleSparkNotify(event)

    expect(result?.commands).toHaveLength(1)
    expect(result?.commands?.[0].destinations).toEqual([event.source])
    expect(result?.commands?.[0].parentEventId).toBe(event.data.id)
    expect(result?.commands?.[0].intent).toBe('action')
    expect(result?.commands?.[0].priority).toBe('critical')

    expect(mockStream).toBeCalledTimes(1)
    expect(mockStream.mock.calls).toHaveLength(1)
    expect(mockStream.mock.calls[0][0]).toEqual('mock-model')
    expect(mockStream.mock.calls[0][1]).not.toBeNull()
    expect(mockStream.mock.calls[0][2]).toHaveLength(2)
    expect(mockStream.mock.calls[0][3]).toHaveProperty('tools')

    expect(mockOnSparkNotifyReactionStreamEvent).toBeCalledWith(event.data.id, 'Ahhh, got hit by zombie!')
    expect(mockOnSparkNotifyReactionStreamEnd).toBeCalledTimes(1)
  })

  it('restarts the proactive wait after user activity and a normal assistant reply', async () => {
    const memorySettings = useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableProactiveTopic = true
    memorySettings.settings.proactiveCheckInterval = 1
    const ingest = vi.fn().mockResolvedValue(undefined)
    mockedStore(useChatOrchestratorStore).ingest = ingest

    const store = useCharacterOrchestratorStore()
    store.initialize()
    const chat = useChatOrchestratorStore()

    await vi.advanceTimersByTimeAsync(30_000)
    await chat.emitBeforeSendHooks('hello', { internal: {} } as any)
    expect(store.lastConversationActivityAt).toBe(Date.now())

    await vi.advanceTimersByTimeAsync(30_000)
    expect(ingest).not.toHaveBeenCalled()

    await chat.emitChatTurnCompleteHooks({
      output: {} as any,
      outputText: 'A normal reply.',
      toolCalls: [],
    }, { internal: {} } as any)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(ingest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it('restarts the proactive wait after its own completed turn', async () => {
    const memorySettings = useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableProactiveTopic = true
    memorySettings.settings.proactiveCheckInterval = 1
    const ingest = vi.fn().mockResolvedValue(undefined)
    mockedStore(useChatOrchestratorStore).ingest = ingest

    const store = useCharacterOrchestratorStore()
    store.initialize()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(ingest).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(ingest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ingest).toHaveBeenCalledTimes(2)
  })

  it('samples a random proactive interval once for each wait', async () => {
    const memorySettings = useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableProactiveTopic = true
    memorySettings.settings.proactiveRandomInterval = true
    memorySettings.settings.proactiveMinInterval = 1
    memorySettings.settings.proactiveMaxInterval = 3
    const store = useCharacterOrchestratorStore()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    store.initialize()
    await nextTick()
    expect(random).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh wait after a pause and proactive setting change', async () => {
    const memorySettings = useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableProactiveTopic = true
    memorySettings.settings.proactiveCheckInterval = 1
    const ingest = vi.fn().mockResolvedValue(undefined)
    mockedStore(useChatOrchestratorStore).ingest = ingest

    const store = useCharacterOrchestratorStore()
    store.initialize()
    await vi.advanceTimersByTimeAsync(30_000)
    store.stopProactiveTopicTimer()
    store.startProactiveTopicTimer()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(ingest).not.toHaveBeenCalled()

    memorySettings.settings.proactiveCheckInterval = 2
    await nextTick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ingest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ingest).toHaveBeenCalledTimes(1)
  })

  it('defers to the existing proactive-topic lease owner', async () => {
    const memorySettings = useMemoryAdvancedSettingsStore()
    memorySettings.settings.enableProactiveTopic = true
    memorySettings.settings.proactiveCheckInterval = 1
    localStorage.setItem('airi:character-orchestrator:proactive-topic-owner', JSON.stringify({
      ownerId: 'another-window',
      priority: 0,
      expiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    }))
    const ingest = vi.fn().mockResolvedValue(undefined)
    mockedStore(useChatOrchestratorStore).ingest = ingest

    const store = useCharacterOrchestratorStore()
    store.initialize()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ingest).not.toHaveBeenCalled()
  })
})
