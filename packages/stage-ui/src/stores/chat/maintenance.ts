import { defineStore, storeToRefs } from 'pinia'

import { useAuthStore } from '../auth'
import { useChatOrchestratorStore } from '../chat'
import { useChatContextStore } from './context-store'
import { useChatPersonaRelationshipStore } from './persona-relationship-store'
import { useChatPersonaRuntimeStore } from './persona-runtime-store'
import { useChatSessionStore } from './session-store'
import { useChatStreamStore } from './stream-store'

export const useChatMaintenanceStore = defineStore('chat-maintenance', () => {
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatContext = useChatContextStore()
  const chatPersonaRuntime = useChatPersonaRuntimeStore()
  const chatRelationship = useChatPersonaRelationshipStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const { userId } = storeToRefs(useAuthStore())

  function clearRelationshipState(sessionId = chatSession.activeSessionId) {
    const characterId = chatSession.getSessionMeta(sessionId)?.characterId ?? 'default'
    chatRelationship.clearRelationshipState({
      userId: userId.value || 'local',
      characterId,
    })
    chatPersonaRuntime.clearLatestRelationshipState(sessionId)
  }

  async function cleanupMessages(sessionId = chatSession.activeSessionId) {
    await chatSession.cleanupMessages(sessionId)
    chatOrchestrator.cancelPendingSends(sessionId)
    chatStream.resetStream()
  }

  async function cleanupMessagesAndShortTermMemory(sessionId = chatSession.activeSessionId) {
    await cleanupMessages(sessionId)
    chatContext.resetContexts()
    chatPersonaRuntime.clearLatestEvaluation(sessionId)
    chatPersonaRuntime.clearLatestLive2DExpressionIntent(sessionId)
    chatPersonaRuntime.clearLatestSceneMode(sessionId)
    chatPersonaRuntime.clearLatestRelationshipState(sessionId)
    chatPersonaRuntime.clearLatestPersonaState(sessionId)
    chatPersonaRuntime.clearLatestAntiTemplateGuard(sessionId)
    chatPersonaRuntime.clearEmotionHistory(sessionId)
  }

  return {
    clearRelationshipState,
    cleanupMessages,
    cleanupMessagesAndShortTermMemory,
  }
})
