import type { AiriAntiTemplateGuard } from './anti-template-guard'
import type { Live2DExpressionIntent } from './live2d-expression-intent'
import type { AiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import type { AiriPersonaRelationshipState, AiriPersonaRelationshipStateSnapshot } from './persona-relationship-state'
import type { AiriSceneModeConfidence, AiriSceneModeInference } from './persona-scene-mode'
import type { AiriEmotionalOverhang, AiriEmotionalTrajectory, AiriEmotionalTrigger, AiriPersonaState, AiriPersonaStateSnapshot } from './persona-state'

import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface AiriSceneModeSnapshot extends AiriSceneModeInference {
  updatedAt: number
}

export interface AiriAntiTemplateGuardSnapshot extends AiriAntiTemplateGuard {
  updatedAt: number
}

export interface AiriPersonaRuntimeEvaluationSnapshot {
  evaluatedAt: number
  messageTextPreview: string
}

export interface AiriEmotionBeatSnapshot {
  emotionDimensions?: AiriPersonaEmotionDimension[]
  personaCardId?: string
  messageTextPreview: string
  sceneMode: AiriSceneModeInference['mode']
  sceneConfidence: AiriSceneModeConfidence
  emotionalOverhang: AiriEmotionalOverhang
  emotionalTrigger: AiriEmotionalTrigger
  trajectory: AiriEmotionalTrajectory
  closeness: number
  seriousness: number
  affection: number
  hurt: number
  arousal: number
  inhibition: number
  capturedAt: number
}

export interface AiriPersonaRuntimeSnapshot {
  sessionId: string
  evaluation?: AiriPersonaRuntimeEvaluationSnapshot
  sceneMode?: AiriSceneModeSnapshot
  relationshipState?: AiriPersonaRelationshipStateSnapshot
  personaState?: AiriPersonaStateSnapshot
  antiTemplateGuard?: AiriAntiTemplateGuardSnapshot
  emotionHistory?: AiriEmotionBeatSnapshot[]
}

interface RecordEmotionBeatInput {
  messageText: string
  inferredSceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
}

interface CommitAcceptedTurnInput extends RecordEmotionBeatInput {
  relationshipState: AiriPersonaRelationshipState
}

function createMessagePreview(messageText: string, maxLength = 160) {
  const normalizedText = messageText.trim().replace(/\s+/g, ' ')

  if (normalizedText.length <= maxLength) {
    return normalizedText
  }

  return `${normalizedText.slice(0, maxLength - 3)}...`
}

export const useChatPersonaRuntimeStore = defineStore('chat-persona-runtime', () => {
  const latestSceneModes = ref<Record<string, AiriSceneModeSnapshot>>({})
  const latestRelationshipStates = ref<Record<string, AiriPersonaRelationshipStateSnapshot>>({})
  const latestPersonaStates = ref<Record<string, AiriPersonaStateSnapshot>>({})
  const latestAntiTemplateGuards = ref<Record<string, AiriAntiTemplateGuardSnapshot>>({})
  const latestEvaluations = ref<Record<string, AiriPersonaRuntimeEvaluationSnapshot>>({})
  const latestEmotionHistories = ref<Record<string, AiriEmotionBeatSnapshot[]>>({})
  const latestLive2DExpressionIntents = ref<Record<string, Live2DExpressionIntent>>({})

  function setLatestSceneMode(sessionId: string, sceneMode: AiriSceneModeInference) {
    latestSceneModes.value[sessionId] = {
      ...sceneMode,
      alternatives: [...sceneMode.alternatives],
      updatedAt: Date.now(),
    }
  }

  function getLatestSceneMode(sessionId: string) {
    return latestSceneModes.value[sessionId]
  }

  function setLatestRelationshipState(sessionId: string, relationshipState: AiriPersonaRelationshipState) {
    latestRelationshipStates.value[sessionId] = {
      ...relationshipState,
      emotionDimensions: relationshipState.emotionDimensions
        ? [...relationshipState.emotionDimensions]
        : undefined,
      recentSensitiveTopics: [...relationshipState.recentSensitiveTopics],
      updatedAt: Date.now(),
    }
  }

  function getLatestRelationshipState(sessionId: string) {
    return latestRelationshipStates.value[sessionId]
  }

  function setLatestPersonaState(sessionId: string, personaState: AiriPersonaState) {
    latestPersonaStates.value[sessionId] = {
      ...personaState,
      emotionDimensions: personaState.emotionDimensions
        ? [...personaState.emotionDimensions]
        : undefined,
      updatedAt: Date.now(),
    }
  }

  function getLatestPersonaState(sessionId: string) {
    return latestPersonaStates.value[sessionId]
  }

  function setLatestAntiTemplateGuard(sessionId: string, antiTemplateGuard: AiriAntiTemplateGuard) {
    latestAntiTemplateGuards.value[sessionId] = {
      ...antiTemplateGuard,
      repeatedOpenings: [...antiTemplateGuard.repeatedOpenings],
      repeatedEndings: [...antiTemplateGuard.repeatedEndings],
      repeatedSelfReferences: [...antiTemplateGuard.repeatedSelfReferences],
      repeatedPragmaticPatterns: [...antiTemplateGuard.repeatedPragmaticPatterns],
      updatedAt: Date.now(),
    }
  }

  function getLatestAntiTemplateGuard(sessionId: string) {
    return latestAntiTemplateGuards.value[sessionId]
  }

  function setLatestEvaluation(sessionId: string, messageText: string) {
    latestEvaluations.value[sessionId] = {
      evaluatedAt: Date.now(),
      messageTextPreview: createMessagePreview(messageText),
    }
  }

  function getLatestEvaluation(sessionId: string) {
    return latestEvaluations.value[sessionId]
  }

  function setLatestLive2DExpressionIntent(sessionId: string, intent: Live2DExpressionIntent) {
    latestLive2DExpressionIntents.value[sessionId] = {
      ...intent,
      primary: { ...intent.primary, reasons: [...intent.primary.reasons] },
      alternatives: intent.alternatives.map(candidate => ({ ...candidate, reasons: [...candidate.reasons] })),
      semanticReviewReasons: [...intent.semanticReviewReasons],
      debug: { ...intent.debug, assistantTextSignals: [...intent.debug.assistantTextSignals] },
    }
  }

  function getLatestLive2DExpressionIntent(sessionId: string) {
    return latestLive2DExpressionIntents.value[sessionId]
  }

  function recordEmotionBeat(sessionId: string, input: RecordEmotionBeatInput) {
    const nextBeat: AiriEmotionBeatSnapshot = {
      emotionDimensions: input.personaState.emotionDimensions
        ? [...input.personaState.emotionDimensions]
        : undefined,
      personaCardId: input.personaState.personaCardId,
      messageTextPreview: createMessagePreview(input.messageText, 72),
      sceneMode: input.inferredSceneMode.mode,
      sceneConfidence: input.inferredSceneMode.confidence,
      emotionalOverhang: input.personaState.emotionalOverhang,
      emotionalTrigger: input.personaState.emotionalTrigger,
      trajectory: input.personaState.trajectory,
      closeness: input.personaState.closeness,
      seriousness: input.personaState.seriousness,
      affection: input.personaState.affection,
      hurt: input.personaState.hurt,
      arousal: input.personaState.arousal,
      inhibition: input.personaState.inhibition,
      capturedAt: Date.now(),
    }

    const history = latestEmotionHistories.value[sessionId] ?? []
    latestEmotionHistories.value[sessionId] = [...history, nextBeat].slice(-8)
  }

  function commitAcceptedTurn(sessionId: string, input: CommitAcceptedTurnInput) {
    setLatestSceneMode(sessionId, input.inferredSceneMode)
    setLatestRelationshipState(sessionId, input.relationshipState)
    setLatestPersonaState(sessionId, input.personaState)
    recordEmotionBeat(sessionId, input)
  }

  function getEmotionHistory(sessionId: string) {
    return latestEmotionHistories.value[sessionId] ?? []
  }

  function getLatestRuntimeSnapshot(sessionId: string): AiriPersonaRuntimeSnapshot | null {
    const evaluation = latestEvaluations.value[sessionId]
    const sceneMode = latestSceneModes.value[sessionId]
    const relationshipState = latestRelationshipStates.value[sessionId]
    const personaState = latestPersonaStates.value[sessionId]
    const antiTemplateGuard = latestAntiTemplateGuards.value[sessionId]
    const emotionHistory = latestEmotionHistories.value[sessionId]

    if (!evaluation && !sceneMode && !relationshipState && !personaState && !antiTemplateGuard && !emotionHistory?.length) {
      return null
    }

    return {
      sessionId,
      evaluation,
      sceneMode,
      relationshipState,
      personaState,
      antiTemplateGuard,
      emotionHistory: emotionHistory ? [...emotionHistory] : undefined,
    }
  }

  function clearLatestSceneMode(sessionId: string) {
    if (!latestSceneModes.value[sessionId]) {
      return
    }

    delete latestSceneModes.value[sessionId]
  }

  function clearLatestRelationshipState(sessionId: string) {
    if (!latestRelationshipStates.value[sessionId]) {
      return
    }

    delete latestRelationshipStates.value[sessionId]
  }

  function clearLatestPersonaState(sessionId: string) {
    if (!latestPersonaStates.value[sessionId]) {
      return
    }

    delete latestPersonaStates.value[sessionId]
  }

  function clearLatestAntiTemplateGuard(sessionId: string) {
    if (!latestAntiTemplateGuards.value[sessionId]) {
      return
    }

    delete latestAntiTemplateGuards.value[sessionId]
  }

  function clearLatestEvaluation(sessionId: string) {
    if (!latestEvaluations.value[sessionId]) {
      return
    }

    delete latestEvaluations.value[sessionId]
  }

  function clearLatestLive2DExpressionIntent(sessionId: string) {
    if (!latestLive2DExpressionIntents.value[sessionId])
      return

    delete latestLive2DExpressionIntents.value[sessionId]
  }

  function clearEmotionHistory(sessionId: string) {
    if (!latestEmotionHistories.value[sessionId]) {
      return
    }

    delete latestEmotionHistories.value[sessionId]
  }

  function resetLatestSceneModes() {
    latestSceneModes.value = {}
    latestRelationshipStates.value = {}
    latestPersonaStates.value = {}
    latestAntiTemplateGuards.value = {}
    latestEvaluations.value = {}
    latestEmotionHistories.value = {}
    latestLive2DExpressionIntents.value = {}
  }

  return {
    latestSceneModes,
    latestRelationshipStates,
    latestPersonaStates,
    latestAntiTemplateGuards,
    latestEvaluations,
    latestEmotionHistories,
    latestLive2DExpressionIntents,
    setLatestSceneMode,
    getLatestSceneMode,
    setLatestRelationshipState,
    getLatestRelationshipState,
    setLatestPersonaState,
    getLatestPersonaState,
    setLatestAntiTemplateGuard,
    getLatestAntiTemplateGuard,
    setLatestEvaluation,
    getLatestEvaluation,
    setLatestLive2DExpressionIntent,
    getLatestLive2DExpressionIntent,
    recordEmotionBeat,
    commitAcceptedTurn,
    getEmotionHistory,
    getLatestRuntimeSnapshot,
    clearLatestSceneMode,
    clearLatestRelationshipState,
    clearLatestPersonaState,
    clearLatestAntiTemplateGuard,
    clearLatestEvaluation,
    clearLatestLive2DExpressionIntent,
    clearEmotionHistory,
    resetLatestSceneModes,
  }
})
