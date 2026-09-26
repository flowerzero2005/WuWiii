import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { UserMessage } from '@xsai/shared-chat'

import type { ChatHistoryItem, ChatStreamEvent, ChatStreamEventContext } from '../../../types/chat'
import type { ScopedContextMessage } from '../../chat/context-store'

import { isStageTamagotchi, isStageWeb } from '@proj-airi/stage-shared'
import { useBroadcastChannel } from '@vueuse/core'
import { Mutex } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { ref, toRaw, watch } from 'vue'

import { useChatOrchestratorStore } from '../../chat'
import { CHAT_STREAM_CHANNEL_NAME, CONTEXT_CHANNEL_NAME } from '../../chat/constants'
import { normalizeChatContextScope, resolveExternalChatContextScope, useChatContextStore } from '../../chat/context-store'
import { useChatSessionStore } from '../../chat/session-store'
import { useChatStreamStore } from '../../chat/stream-store'
import { useConsciousnessStore } from '../../modules/consciousness'
import { useProvidersStore } from '../../providers'
import { useModsServerChannelStore } from './channel-server'
import { prepareBroadcastTransport } from './context-bridge-transport'

/**
 * 创建一个可安全克隆的 context 副本
 * BroadcastChannel 只需要同步状态，不需要完整的 context 对象
 */
function createMinimalContext(context: Partial<ChatStreamEventContext>): ChatStreamEventContext {
  const message: ChatHistoryItem = {
    role: context.message?.role ?? 'user',
    content: typeof context.message?.content === 'string' ? context.message.content : '',
    createdAt: context.message?.createdAt ?? Date.now(),
    id: context.message?.id,
  } as ChatHistoryItem

  return {
    message,
    contexts: {},
    composedMessage: [],
    // Input events may contain runtime payloads that belong to the sending
    // window only. The receiving window only mirrors visible stream state.
    internal: context.internal
      ? {
          hiddenUserMessage: context.internal.hiddenUserMessage,
          memoryUserMessage: context.internal.memoryUserMessage,
          proactiveTopic: context.internal.proactiveTopic,
          runtimeSignal: context.internal.runtimeSignal,
          sourceSessionId: context.internal.sourceSessionId,
          sourceCreatedAt: context.internal.sourceCreatedAt,
          sourceUserMessageId: context.internal.sourceUserMessageId,
          sourceAssistantMessageId: context.internal.sourceAssistantMessageId,
          sourceAssistantMessageIds: context.internal.sourceAssistantMessageIds,
          sourceSurface: context.internal.sourceSurface,
          groupChat: context.internal.groupChat,
          groupTurnId: context.internal.groupTurnId,
          roomName: context.internal.roomName,
          personaCardId: context.internal.personaCardId,
          speech: context.internal.speech,
          speechTone: context.internal.speechTone,
          performance: context.internal.performance,
          // groupSpeechSynthesisBarrier and groupSpeechPlaybackBarrier are
          // local Promise barriers. They must remain in their source window.
        }
      : undefined,
    speech: context.speech
      ? {
          finalText: context.speech.finalText,
          intentId: context.speech.intentId,
          segmentation: context.speech.segmentation,
          selection: context.speech.selection,
          streamId: context.speech.streamId,
          turnId: context.speech.turnId,
        }
      : undefined,
    // Speech playback hooks use the frozen turn snapshot to resolve the
    // speaker-specific provider/model/voice. Preserve it across windows so a
    // mirrored group turn cannot fall back to the active global voice.
    turn: context.turn ? toRaw(context.turn) : undefined,
  }
}

function cloneContextsForTransport(contexts: ChatStreamEventContext['contexts']) {
  return Object.fromEntries(Object.entries(contexts).map(([contextId, messages]) => [
    contextId,
    messages.map(message => ({ ...message })),
  ]))
}

function resolveStreamSessionId(context: Partial<ChatStreamEventContext>, fallback: string) {
  return context.internal?.sourceSessionId || fallback
}

function resolveStreamTurnId(context: Partial<ChatStreamEventContext>) {
  return context.turn?.turnId ?? context.internal?.sourceUserMessageId
}

function resolveInputSourceUserMessageId(event: { data: unknown, metadata?: { event?: { id?: unknown } } }) {
  const data = event.data && typeof event.data === 'object'
    ? event.data as { sourceUserMessageId?: unknown }
    : {}
  const sourceUserMessageId = data.sourceUserMessageId ?? event.metadata?.event?.id
  return typeof sourceUserMessageId === 'string' && sourceUserMessageId.trim()
    ? sourceUserMessageId
    : undefined
}

export const useContextBridgeStore = defineStore('mods:api:context-bridge', () => {
  const mutex = new Mutex()

  const chatOrchestrator = useChatOrchestratorStore()
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const serverChannelStore = useModsServerChannelStore()
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

  const { post: postBroadcastContext, data: incomingContext } = useBroadcastChannel<ScopedContextMessage, ScopedContextMessage>({ name: CONTEXT_CHANNEL_NAME })
  const { post: postBroadcastStreamEvent, data: incomingStreamEvent } = useBroadcastChannel<ChatStreamEvent, ChatStreamEvent>({ name: CHAT_STREAM_CHANNEL_NAME })

  const disposeHookFns = ref<Array<() => void>>([])
  let remoteStreamGuard: { sessionId: string, generation: number, turnId?: string } | null = null
  const completedRemoteStreamTurns = new Set<string>()
  const INPUT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
  const MAX_INPUT_RECEIPTS_PER_SESSION = 512

  function claimInputSourceUserMessage(sessionId: string, sourceUserMessageId: string) {
    if (typeof localStorage === 'undefined')
      return true

    const receiptKey = `airi:context-bridge:input:${sessionId}`
    try {
      const stored = localStorage.getItem(receiptKey)
      const receipts = stored ? JSON.parse(stored) as Record<string, number> : {}
      const now = Date.now()
      const previousAt = receipts[sourceUserMessageId]
      if (typeof previousAt === 'number' && now - previousAt < INPUT_RECEIPT_TTL_MS)
        return false
      const retained = Object.entries(receipts)
        .filter(([, at]) => typeof at === 'number' && now - at < INPUT_RECEIPT_TTL_MS)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_INPUT_RECEIPTS_PER_SESSION - 1)
      localStorage.setItem(receiptKey, JSON.stringify(Object.fromEntries([
        ...retained,
        [sourceUserMessageId, now],
      ])))
      return true
    }
    catch {
      // Storage can be unavailable in private/browser-embedded contexts. The
      // source-specific Web Lock still prevents concurrent duplicate ingest.
      return true
    }
  }

  function postBroadcast<T>(post: (payload: T) => void, eventType: string, payload: T, sessionId?: string, turnId?: string) {
    const prepared = prepareBroadcastTransport(payload)
    if (prepared.droppedPaths.length) {
      console.warn('[ContextBridge] Removed non-transport fields from broadcast', {
        eventType,
        sessionId,
        turnId,
        fields: prepared.droppedPaths,
      })
    }
    if (prepared.cloneFailurePath) {
      console.warn('[ContextBridge] Broadcast structured-clone probe failed', {
        eventType,
        sessionId,
        turnId,
        field: prepared.cloneFailurePath,
      })
      return false
    }

    try {
      post(prepared.payload)
      return true
    }
    catch {
      // A failed mirror must never fail the source window's local turn.
      console.warn('[ContextBridge] Broadcast failed after structured-clone probe', {
        eventType,
        sessionId,
        turnId,
        field: 'payload',
      })
      return false
    }
  }

  function broadcastContext(context: ScopedContextMessage) {
    const contextScope = normalizeChatContextScope(context.contextScope)
    const sessionId = contextScope?.type === 'session' ? contextScope.sessionId : undefined
    return postBroadcast(postBroadcastContext, 'context:update', context, sessionId, contextScope?.type === 'turn' ? contextScope.turnId : undefined)
  }

  function broadcastStreamEvent(event: ChatStreamEvent) {
    return postBroadcast(postBroadcastStreamEvent, event.type, event, event.sessionId, event.context.turn?.turnId)
  }

  function remoteStreamTurnKey(sessionId: string, turnId?: string) {
    return turnId ? `${sessionId}:${turnId}` : undefined
  }

  function rememberCompletedRemoteStreamTurn(turnKey: string | undefined) {
    if (!turnKey)
      return
    completedRemoteStreamTurns.add(turnKey)
    // Stream mirrors are only short-lived UI events. Retain a bounded replay
    // fence so a long-running desktop session cannot accumulate every turn.
    if (completedRemoteStreamTurns.size > 256) {
      const oldestTurnKey = completedRemoteStreamTurns.values().next().value
      if (oldestTurnKey)
        completedRemoteStreamTurns.delete(oldestTurnKey)
    }
  }

  function acceptsRemoteStreamEvent(event: ChatStreamEvent) {
    if (!remoteStreamGuard)
      return false
    if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
      return false
    if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
      return false
    return remoteStreamGuard.turnId === resolveStreamTurnId(event.context)
  }

  async function initialize() {
    await mutex.acquire()

    try {
      let isProcessingRemoteStream = false

      const { stop } = watch(incomingContext, (event) => {
        if (event)
          chatContext.ingestContextMessage(event)
      })
      disposeHookFns.value.push(stop)

      disposeHookFns.value.push(serverChannelStore.onContextUpdate((event) => {
        const contextScope = normalizeChatContextScope((event.data as { contextScope?: unknown }).contextScope)
        if (!contextScope) {
          console.warn('[ContextBridge] Ignored unscoped context:update event')
          return
        }

        const contextMessage: ScopedContextMessage = {
          ...event.data,
          contextScope,
          metadata: event.metadata,
          createdAt: Date.now(),
        }
        chatContext.ingestContextMessage(contextMessage)
        broadcastContext(toRaw(contextMessage))
      }))

      disposeHookFns.value.push(serverChannelStore.onEvent('input:text', async (event) => {
        const {
          text,
          textRaw,
          overrides,
          contextUpdates,
        } = event.data
        const targetSessionId = overrides?.sessionId || chatSession.activeSessionId
        const sourceUserMessageId = resolveInputSourceUserMessageId(event)

        const normalizedContextUpdates = contextUpdates?.flatMap((update) => {
          const id = update.id ?? nanoid()
          const contextId = update.contextId ?? id
          const contextScope = resolveExternalChatContextScope(
            (update as { contextScope?: unknown }).contextScope,
            targetSessionId,
          )
          if (!contextScope)
            return []

          return [{
            ...update,
            contextScope,
            id,
            contextId,
          }]
        })

        if (normalizedContextUpdates?.length) {
          const createdAt = Date.now()
          for (const update of normalizedContextUpdates) {
            chatContext.ingestContextMessage({
              ...update,
              metadata: event.metadata,
              createdAt,
            })
          }
        }

        if (activeProvider.value && activeModel.value) {
          const chatProvider = await providersStore.getProviderInstance<ChatProvider>(activeProvider.value)

          let messageText = text
          if (overrides?.messagePrefix) {
            messageText = `${overrides.messagePrefix}${text}`
          }

          // TODO(@nekomeowww): This only guard for input:text events handling and doesn't cover the entire ingestion
          // process. Another critical path of spark:notify is affected too, I think for better future development
          // experience, we should discover and find either a leader election or distributed lock solution to
          // coordinate the modules that handles context bridge ingestion across multiple windows/tabs.
          //
          // Background behind this, as server-sdk is in fact integrated in every Stage Web window/tab, each
          // window/tab has its own connection & chat orchestrator instance, when multiple windows/tabs are open,
          // each of them will receive the same input:text event and process ingestion independently, causing
          // duplicated messages handling and output:* events emission.
          //
          // We don't have ability to control how many windows/tabs the user will open (sometimes) user will forget
          // to close the extra windows/tabs, so we need a way to coordinate the ingestion processing to
          // ensure only one window/tab is handling the ingestion at a time.
          //
          // SharedWorker solution was considered but it's completely disabled in Chromium based Android browsers
          // (which is a big portion of mobile Stage Web users as stage-ui serves as the unified / universal
          // api wrapper for most of the shared logic across Web, Pocket, and Tamagotchi).
          //
          // Read more here:
          // - https://chromestatus.com/feature/6265472244514816
          // - https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
          // - https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
          // Receipt updates share a per-session record, so serialize all
          // inputs for that session while the durable claim is made.
          const lockName = `context-bridge:event:input:text:${targetSessionId}`
          navigator.locks.request(lockName, async () => {
            try {
              if (sourceUserMessageId && !claimInputSourceUserMessage(targetSessionId, sourceUserMessageId))
                return

              await chatOrchestrator.ingest(messageText, {
                model: activeModel.value,
                chatProvider,
                sourceUserMessageId,
                input: {
                  type: 'input:text',
                  data: {
                    ...event.data,
                    text,
                    textRaw,
                    overrides,
                    contextUpdates: normalizedContextUpdates,
                  },
                },
              }, targetSessionId)
            }
            catch (err) {
              console.error('Error ingesting text input via context bridge:', err)
            }
          })
        }
      }))

      disposeHookFns.value.push(
        chatOrchestrator.onBeforeMessageComposed(async (message, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'before-compose',
            message,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onAfterMessageComposed(async (message, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'after-compose',
            message,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onBeforeSend(async (message, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'before-send',
            message,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onAfterSend(async (message, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'after-send',
            message,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onTokenLiteral(async (literal, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'token-literal',
            literal,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onTokenSpecial(async (special, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'token-special',
            special,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onStreamEnd(async (context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'stream-end',
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),
        chatOrchestrator.onAssistantResponseEnd(async (message, context) => {
          if (isProcessingRemoteStream)
            return

          broadcastStreamEvent({
            type: 'assistant-end',
            message,
            sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
            context: createMinimalContext(context),
          })
        }),

        chatOrchestrator.onAssistantMessage(async (message, _messageText, context) => {
          serverChannelStore.send({
            type: 'output:gen-ai:chat:message',
            data: {
              ...context.input?.data,
              message,
              'stage-web': isStageWeb(),
              'stage-tamagotchi': isStageTamagotchi(),
              'gen-ai:chat': {
                message: context.message as UserMessage,
                composedMessage: context.composedMessage,
                contexts: cloneContextsForTransport(context.contexts),
                input: context.input,
              },
            },
          })
        }),

        chatOrchestrator.onChatTurnComplete(async (chat, context) => {
          serverChannelStore.send({
            type: 'output:gen-ai:chat:complete',
            data: {
              ...context.input?.data,
              'message': chat.output,
              // TODO: tool calls should be captured properly
              'toolCalls': [],
              'stage-web': isStageWeb(),
              'stage-tamagotchi': isStageTamagotchi(),
              // TODO: Properly calculate usage data
              'usage': {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                source: 'estimate-based',
              },
              'gen-ai:chat': {
                message: context.message as UserMessage,
                composedMessage: context.composedMessage,
                contexts: cloneContextsForTransport(context.contexts),
                input: context.input,
              },
            },
          })

          if (!chat.outputText.trim()) {
            broadcastStreamEvent({
              type: 'turn-complete',
              message: chat.output,
              outputText: chat.outputText,
              sessionId: resolveStreamSessionId(context, chatSession.activeSessionId),
              context: createMinimalContext(context),
            })
          }
        }),
      )

      const { stop: stopIncomingStreamWatch } = watch(incomingStreamEvent, async (event) => {
        if (!event)
          return

        const needsGroupSpeechRegistration = event.type === 'before-compose'
          && event.context.internal?.groupChat === true
        // Stream events are UI mirrors, not a second ingestion path. A window
        // showing another contact must never enter the sender's loading state
        // or render the sender's draft. The group before-compose event is the
        // exception: its frozen speaker selection has to reach the window
        // holding the speech host lease before speech-bus tokens arrive.
        if (event.sessionId !== chatSession.activeSessionId && !needsGroupSpeechRegistration)
          return

        isProcessingRemoteStream = true

        try {
          // Use the receiver's active session to avoid clobbering chat state when events come from other windows/devtools.
          switch (event.type) {
            case 'before-compose':
              await chatOrchestrator.emitBeforeMessageComposedHooks(event.message, event.context)
              break
            case 'after-compose':
              await chatOrchestrator.emitAfterMessageComposedHooks(event.message, event.context)
              break
            case 'before-send':
            {
              const turnId = resolveStreamTurnId(event.context)
              const turnKey = remoteStreamTurnKey(event.sessionId, turnId)
              if (turnKey && completedRemoteStreamTurns.has(turnKey))
                break
              if (remoteStreamGuard?.sessionId === event.sessionId
                && remoteStreamGuard.generation === chatSession.getSessionGenerationValue(event.sessionId)
                && remoteStreamGuard.turnId === turnId) {
                break
              }
              await chatOrchestrator.emitBeforeSendHooks(event.message, event.context)
              remoteStreamGuard = {
                sessionId: event.sessionId,
                generation: chatSession.getSessionGenerationValue(event.sessionId),
                turnId,
              }
              chatOrchestrator.sending = true
              chatStream.beginStream(event.sessionId)
              break
            }
            case 'after-send':
              await chatOrchestrator.emitAfterSendHooks(event.message, event.context)
              break
            case 'token-literal':
              if (!acceptsRemoteStreamEvent(event))
                return
              chatStream.appendStreamLiteral(event.literal)
              await chatOrchestrator.emitTokenLiteralHooks(event.literal, event.context)
              break
            case 'token-special':
              if (!acceptsRemoteStreamEvent(event))
                return
              await chatOrchestrator.emitTokenSpecialHooks(event.special, event.context)
              break
            case 'stream-end':
              if (!acceptsRemoteStreamEvent(event))
                break
              await chatOrchestrator.emitStreamEndHooks(event.context)
              break
            case 'assistant-end':
              if (!acceptsRemoteStreamEvent(event) || !remoteStreamGuard)
                break
              {
                const guard = remoteStreamGuard
                const completedTurnKey = remoteStreamTurnKey(guard.sessionId, guard.turnId)
                remoteStreamGuard = null
                rememberCompletedRemoteStreamTurn(completedTurnKey)
                await chatOrchestrator.emitAssistantResponseEndHooks(event.message, event.context)
                chatStream.finalizeStream(event.message)
                chatOrchestrator.sending = false
                break
              }
            case 'turn-complete':
              if (!acceptsRemoteStreamEvent(event) || !remoteStreamGuard)
                break
              {
                const guard = remoteStreamGuard
                const completedTurnKey = remoteStreamTurnKey(guard.sessionId, guard.turnId)
                remoteStreamGuard = null
                rememberCompletedRemoteStreamTurn(completedTurnKey)
                await chatOrchestrator.emitChatTurnCompleteHooks({
                  output: event.message,
                  outputText: event.outputText,
                  toolCalls: [],
                }, event.context)
                chatStream.finalizeStream(event.outputText)
                chatOrchestrator.sending = false
                break
              }
          }
        }
        finally {
          isProcessingRemoteStream = false
        }
      })
      disposeHookFns.value.push(stopIncomingStreamWatch)
    }
    finally {
      mutex.release()
    }
  }

  async function dispose() {
    await mutex.acquire()

    try {
      for (const fn of disposeHookFns.value) {
        fn()
      }
    }
    finally {
      mutex.release()
    }

    disposeHookFns.value = []
  }

  return {
    initialize,
    dispose,
  }
})
