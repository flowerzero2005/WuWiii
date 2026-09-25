import type { ToolMessage } from '@xsai/shared-chat'

import type { ChatStreamEventContext, StreamingAssistantMessage } from '../../types/chat'

export type ChatToolPhaseEvent
  = | { type: 'waiting', acknowledgement: string }
    | { type: 'result' }
    | { type: 'conclusion-start' }

export interface ChatHookRegistry {
  onBeforeMessageComposed: (cb: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>) => () => void
  onAfterMessageComposed: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onBeforeSend: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onAfterSend: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onTokenLiteral: (cb: (literal: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onTokenSpecial: (cb: (special: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onStreamEnd: (cb: (context: ChatStreamEventContext) => Promise<void>) => () => void
  onGroupWholeSpeechOpen: (cb: (context: ChatStreamEventContext) => Promise<void>) => () => void
  onAssistantResponseEnd: (cb: (message: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onAssistantMessage: (cb: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>) => () => void
  onChatTurnComplete: (cb: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>) => () => void
  onToolPhase: (cb: (event: ChatToolPhaseEvent, context: ChatStreamEventContext) => Promise<void>) => () => void
  emitBeforeMessageComposedHooks: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>
  emitAfterMessageComposedHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitBeforeSendHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitAfterSendHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitTokenLiteralHooks: (literal: string, context: ChatStreamEventContext) => Promise<void>
  emitTokenSpecialHooks: (special: string, context: ChatStreamEventContext) => Promise<void>
  emitStreamEndHooks: (context: ChatStreamEventContext) => Promise<void>
  emitGroupWholeSpeechOpenHooks: (context: ChatStreamEventContext) => Promise<void>
  emitAssistantResponseEndHooks: (message: string, context: ChatStreamEventContext) => Promise<void>
  emitAssistantMessageHooks: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>
  emitChatTurnCompleteHooks: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>
  emitToolPhaseHooks: (event: ChatToolPhaseEvent, context: ChatStreamEventContext) => Promise<void>
  clearHooks: () => void
}

export function createChatHooks(): ChatHookRegistry {
  const onBeforeMessageComposedHooks: Array<(message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>> = []
  const onAfterMessageComposedHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onBeforeSendHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onAfterSendHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onTokenLiteralHooks: Array<(literal: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onTokenSpecialHooks: Array<(special: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onStreamEndHooks: Array<(context: ChatStreamEventContext) => Promise<void>> = []
  const onGroupWholeSpeechOpenHooks: Array<(context: ChatStreamEventContext) => Promise<void>> = []
  const onAssistantResponseEndHooks: Array<(message: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onAssistantMessageHooks: Array<(message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>> = []
  const onChatTurnCompleteHooks: Array<(chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>> = []
  const onToolPhaseHooks: Array<(event: ChatToolPhaseEvent, context: ChatStreamEventContext) => Promise<void>> = []

  function onBeforeMessageComposed(cb: (message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) => Promise<void>) {
    onBeforeMessageComposedHooks.push(cb)
    return () => {
      const index = onBeforeMessageComposedHooks.indexOf(cb)
      if (index >= 0)
        onBeforeMessageComposedHooks.splice(index, 1)
    }
  }

  function onAfterMessageComposed(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAfterMessageComposedHooks.push(cb)
    return () => {
      const index = onAfterMessageComposedHooks.indexOf(cb)
      if (index >= 0)
        onAfterMessageComposedHooks.splice(index, 1)
    }
  }

  function onBeforeSend(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onBeforeSendHooks.push(cb)
    return () => {
      const index = onBeforeSendHooks.indexOf(cb)
      if (index >= 0)
        onBeforeSendHooks.splice(index, 1)
    }
  }

  function onAfterSend(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAfterSendHooks.push(cb)
    return () => {
      const index = onAfterSendHooks.indexOf(cb)
      if (index >= 0)
        onAfterSendHooks.splice(index, 1)
    }
  }

  function onTokenLiteral(cb: (literal: string, context: ChatStreamEventContext) => Promise<void>) {
    onTokenLiteralHooks.push(cb)
    return () => {
      const index = onTokenLiteralHooks.indexOf(cb)
      if (index >= 0)
        onTokenLiteralHooks.splice(index, 1)
    }
  }

  function onTokenSpecial(cb: (special: string, context: ChatStreamEventContext) => Promise<void>) {
    onTokenSpecialHooks.push(cb)
    return () => {
      const index = onTokenSpecialHooks.indexOf(cb)
      if (index >= 0)
        onTokenSpecialHooks.splice(index, 1)
    }
  }

  function onStreamEnd(cb: (context: ChatStreamEventContext) => Promise<void>) {
    onStreamEndHooks.push(cb)
    return () => {
      const index = onStreamEndHooks.indexOf(cb)
      if (index >= 0)
        onStreamEndHooks.splice(index, 1)
    }
  }

  function onGroupWholeSpeechOpen(cb: (context: ChatStreamEventContext) => Promise<void>) {
    onGroupWholeSpeechOpenHooks.push(cb)
    return () => {
      const index = onGroupWholeSpeechOpenHooks.indexOf(cb)
      if (index >= 0)
        onGroupWholeSpeechOpenHooks.splice(index, 1)
    }
  }

  function onAssistantResponseEnd(cb: (message: string, context: ChatStreamEventContext) => Promise<void>) {
    onAssistantResponseEndHooks.push(cb)
    return () => {
      const index = onAssistantResponseEndHooks.indexOf(cb)
      if (index >= 0)
        onAssistantResponseEndHooks.splice(index, 1)
    }
  }

  function onAssistantMessage(cb: (message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) => Promise<void>) {
    onAssistantMessageHooks.push(cb)
    return () => {
      const index = onAssistantMessageHooks.indexOf(cb)
      if (index >= 0)
        onAssistantMessageHooks.splice(index, 1)
    }
  }

  function onChatTurnComplete(cb: (chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) => Promise<void>) {
    onChatTurnCompleteHooks.push(cb)
    return () => {
      const index = onChatTurnCompleteHooks.indexOf(cb)
      if (index >= 0)
        onChatTurnCompleteHooks.splice(index, 1)
    }
  }

  function onToolPhase(cb: (event: ChatToolPhaseEvent, context: ChatStreamEventContext) => Promise<void>) {
    onToolPhaseHooks.push(cb)
    return () => {
      const index = onToolPhaseHooks.indexOf(cb)
      if (index >= 0)
        onToolPhaseHooks.splice(index, 1)
    }
  }

  function clearHooks() {
    onBeforeMessageComposedHooks.length = 0
    onAfterMessageComposedHooks.length = 0
    onBeforeSendHooks.length = 0
    onAfterSendHooks.length = 0
    onTokenLiteralHooks.length = 0
    onTokenSpecialHooks.length = 0
    onStreamEndHooks.length = 0
    onGroupWholeSpeechOpenHooks.length = 0
    onAssistantResponseEndHooks.length = 0
    onAssistantMessageHooks.length = 0
    onChatTurnCompleteHooks.length = 0
    onToolPhaseHooks.length = 0
  }

  async function emitBeforeMessageComposedHooks(message: string, context: Omit<ChatStreamEventContext, 'composedMessage'>) {
    for (let i = 0; i < onBeforeMessageComposedHooks.length; i++) {
      const hook = onBeforeMessageComposedHooks[i]
      try {
        await hook(message, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onBeforeMessageComposed hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitAfterMessageComposedHooks(message: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onAfterMessageComposedHooks.length; i++) {
      const hook = onAfterMessageComposedHooks[i]
      try {
        await hook(message, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onAfterMessageComposed hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitBeforeSendHooks(message: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onBeforeSendHooks.length; i++) {
      const hook = onBeforeSendHooks[i]
      try {
        await hook(message, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onBeforeSend hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitAfterSendHooks(message: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onAfterSendHooks.length; i++) {
      const hook = onAfterSendHooks[i]
      try {
        await hook(message, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onAfterSend hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitTokenLiteralHooks(literal: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onTokenLiteralHooks.length; i++) {
      const hook = onTokenLiteralHooks[i]
      try {
        await hook(literal, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onTokenLiteral hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitTokenSpecialHooks(special: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onTokenSpecialHooks.length; i++) {
      const hook = onTokenSpecialHooks[i]
      try {
        await hook(special, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onTokenSpecial hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitStreamEndHooks(context: ChatStreamEventContext) {
    for (let i = 0; i < onStreamEndHooks.length; i++) {
      const hook = onStreamEndHooks[i]
      try {
        await hook(context)
      }
      catch (error) {
        console.error(`[ChatHooks] onStreamEnd hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitGroupWholeSpeechOpenHooks(context: ChatStreamEventContext) {
    for (let i = 0; i < onGroupWholeSpeechOpenHooks.length; i++) {
      const hook = onGroupWholeSpeechOpenHooks[i]
      try {
        await hook(context)
      }
      catch (error) {
        console.error(`[ChatHooks] onGroupWholeSpeechOpen hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitAssistantResponseEndHooks(message: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onAssistantResponseEndHooks.length; i++) {
      const hook = onAssistantResponseEndHooks[i]
      try {
        await hook(message, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onAssistantResponseEnd hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitAssistantMessageHooks(message: StreamingAssistantMessage, messageText: string, context: ChatStreamEventContext) {
    for (let i = 0; i < onAssistantMessageHooks.length; i++) {
      const hook = onAssistantMessageHooks[i]
      try {
        await hook(message, messageText, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onAssistantMessage hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitChatTurnCompleteHooks(chat: { output: StreamingAssistantMessage, outputText: string, toolCalls: ToolMessage[] }, context: ChatStreamEventContext) {
    for (let i = 0; i < onChatTurnCompleteHooks.length; i++) {
      const hook = onChatTurnCompleteHooks[i]
      try {
        await hook(chat, context)
      }
      catch (error) {
        console.error(`[ChatHooks] Hook ${i + 1} execution failed:`, error)
      }
    }
  }

  async function emitToolPhaseHooks(event: ChatToolPhaseEvent, context: ChatStreamEventContext) {
    await Promise.all(onToolPhaseHooks.map(async (hook, index) => {
      try {
        await hook(event, context)
      }
      catch (error) {
        console.error(`[ChatHooks] onToolPhase hook ${index + 1} execution failed:`, error)
      }
    }))
  }

  return {
    onBeforeMessageComposed,
    onAfterMessageComposed,
    onBeforeSend,
    onAfterSend,
    onTokenLiteral,
    onTokenSpecial,
    onStreamEnd,
    onGroupWholeSpeechOpen,
    onAssistantResponseEnd,
    onAssistantMessage,
    onChatTurnComplete,
    onToolPhase,
    emitBeforeMessageComposedHooks,
    emitAfterMessageComposedHooks,
    emitBeforeSendHooks,
    emitAfterSendHooks,
    emitTokenLiteralHooks,
    emitTokenSpecialHooks,
    emitStreamEndHooks,
    emitGroupWholeSpeechOpenHooks,
    emitAssistantResponseEndHooks,
    emitAssistantMessageHooks,
    emitChatTurnCompleteHooks,
    emitToolPhaseHooks,
    clearHooks,
  }
}
