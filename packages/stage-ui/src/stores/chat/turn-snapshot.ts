import type { ChatTurnPersonaSnapshot, ChatTurnSnapshot, TurnIdentitySnapshot } from '../../types/chat'
import type { SpeechToneSnapshot } from '../../utils/speech-tone'
import type { SpeechSelectionSnapshot } from '../modules/speech'
import type { PersonaLanguagePolicy } from './persona-language-policy'

export interface CreateChatTurnSnapshotInput {
  turnId: string
  sessionId: string
  sourceSurface?: string
  assistantMessageIds: readonly string[]
  language: PersonaLanguagePolicy
  persona?: ChatTurnPersonaSnapshot
  speaker?: TurnIdentitySnapshot & { speech?: SpeechSelectionSnapshot }
  speech?: {
    intentId?: string
    streamId?: string
    segmentation: 'streaming' | 'whole'
    selection: SpeechSelectionSnapshot
    tone?: SpeechToneSnapshot | null
  }
}

function freezeSelection(selection: SpeechSelectionSnapshot): Readonly<SpeechSelectionSnapshot> {
  return Object.freeze({ ...selection })
}

function freezePersona(persona: ChatTurnPersonaSnapshot | undefined) {
  if (!persona)
    return undefined

  return Object.freeze({
    affectDefinition: Object.freeze(Object.fromEntries(
      Object.entries(persona.affectDefinition).map(([axis, definition]) => [axis, Object.freeze({ ...definition })]),
    )) as ChatTurnPersonaSnapshot['affectDefinition'],
    emotionDimensions: Object.freeze([...persona.emotionDimensions]),
    modelId: persona.modelId,
    personaCardId: persona.personaCardId,
    providerId: persona.providerId,
    systemPrompt: persona.systemPrompt,
  })
}

export function createChatTurnSnapshot(input: CreateChatTurnSnapshotInput): ChatTurnSnapshot {
  const speaker = input.speaker
    ? Object.freeze({
        avatarUrl: input.speaker.avatarUrl,
        characterId: input.speaker.characterId,
        displayName: input.speaker.displayName,
        stageModelRevision: input.speaker.stageModelRevision,
        groupTurnId: input.speaker.groupTurnId,
        roomName: input.speaker.roomName,
        sourceUserMessageId: input.speaker.sourceUserMessageId,
      })
    : undefined
  const speech = input.speech
    ? Object.freeze({
        intentId: input.speech.intentId ?? input.turnId,
        streamId: input.speech.streamId ?? `${input.turnId}:speech`,
        segmentation: input.speech.segmentation,
        selection: freezeSelection(input.speech.selection),
        tone: input.speech.tone ? Object.freeze({ ...input.speech.tone }) : null,
      })
    : undefined
  const persona = freezePersona(input.persona)

  return Object.freeze({
    turnId: input.turnId,
    sessionId: input.sessionId,
    sourceSurface: input.sourceSurface ?? 'chat',
    assistantMessageIds: Object.freeze([...input.assistantMessageIds]),
    language: Object.freeze({ ...input.language }),
    persona,
    speaker,
    speech,
  })
}
