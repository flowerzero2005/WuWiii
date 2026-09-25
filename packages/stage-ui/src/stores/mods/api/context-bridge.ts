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
    input: context.input ? toRaw(context.input) : undefined,
    internal: context.internal ? { ...context.internal } : undefined,
    speech: context.speech ? { ...context.speech } : undefined,
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

  const { post: broadcastContext, data: incomingContext } = useBroadcastChannel<ScopedContextMessage, ScopedContextMessage>({ name: CONTEXT_CHANNEL_NAME })
  const { post: broadcastStreamEvent, data: incomingStreamEvent } = useBroadcastChannel<ChatStreamEvent, ChatStreamEvent>({ name: CHAT_STREAM_CHANNEL_NAME })

  const disposeHookFns = ref<Array<() => void>>([])
  let remoteStreamGuard: { sessionId: string, generation: number } | null = null

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
          navigator.locks.request('context-bridge:event:input:text', async () => {
            try {
              await chatOrchestrator.ingest(messageText, {
                model: activeModel.value,
                chatProvider,
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
              await chatOrchestrator.emitBeforeSendHooks(event.message, event.context)
              remoteStreamGuard = {
                sessionId: event.sessionId,
                generation: chatSession.getSessionGenerationValue(event.sessionId),
              }
              chatOrchestrator.sending = true
              chatStream.beginStream(event.sessionId)
              break
            case 'after-send':
              await chatOrchestrator.emitAfterSendHooks(event.message, event.context)
              break
            case 'token-literal':
              if (!remoteStreamGuard)
                return
              if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
                return
              if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
                return
              chatStream.appendStreamLiteral(event.literal)
              await chatOrchestrator.emitTokenLiteralHooks(event.literal, event.context)
              break
            case 'token-special':
              if (!remoteStreamGuard)
                return
              if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
                return
              if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
                return
              await chatOrchestrator.emitTokenSpecialHooks(event.special, event.context)
              break
            case 'stream-end':
              if (!remoteStreamGuard)
                break
              if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
                break
              if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
                break
              await chatOrchestrator.emitStreamEndHooks(event.context)
              break
            case 'assistant-end':
              if (!remoteStreamGuard)
                break
              if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
                break
              if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
                break
              await chatOrchestrator.emitAssistantResponseEndHooks(event.message, event.context)
              chatStream.finalizeStream(event.message)
              chatOrchestrator.sending = false
              remoteStreamGuard = null
              break
            case 'turn-complete':
              if (!remoteStreamGuard)
                break
              if (remoteStreamGuard.sessionId !== chatSession.activeSessionId)
                break
              if (chatSession.getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation)
                break
              await chatOrchestrator.emitChatTurnCompleteHooks({
                output: event.message,
                outputText: event.outputText,
                toolCalls: [],
              }, event.context)
              chatStream.finalizeStream(event.outputText)
              chatOrchestrator.sending = false
              remoteStreamGuard = null
              break
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
