import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { StreamEvent, StreamOptions } from '../llm'
import type { ChatTraceContext } from './chat-diagnostics'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { hasAiriPersonaEmotionDimension } from './persona-emotion-dimensions'

const NO_NOTE_TOKEN = 'NO_NOTE'
const MAX_INNER_VOICE_NOTE_LENGTH = 220
const PREWARM_SCENE_MODES = new Set<AiriSceneModeInference['mode']>([
  'gentle-support',
  'heavy-topic-companion-silence',
  'awkward-topic-avoidance',
  'identity-clarification',
  'repair-after-failure',
  'praise-receiving',
  'light-bickering',
])
const PREWARM_SENSITIVE_TOPICS = new Set(['repair', 'attachment', 'distress', 'conflict'])

type StreamText = (
  model: string,
  chatProvider: ChatProvider,
  messages: Message[],
  options?: StreamOptions,
) => Promise<unknown>

export interface AiriInnerVoiceNoteGenerationInput {
  stream: StreamText
  model: string
  chatProvider: ChatProvider
  headers?: Record<string, string>
  abortSignal?: AbortSignal
  trace?: ChatTraceContext
  userMessage: string
  assistantText: string
  sceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  relationshipState: AiriPersonaRelationshipState
  replyIntent?: AiriReplyIntent
  requireNote?: boolean
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength)
    return text

  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function pickPersonaState(state: AiriPersonaState) {
  const picked: Record<string, unknown> = {
    enabledEmotionDimensions: state.emotionDimensions ?? [],
    seriousness: Number(state.seriousness.toFixed(2)),
    arousal: Number(state.arousal.toFixed(2)),
    inhibition: Number(state.inhibition.toFixed(2)),
    emotionalOverhang: state.emotionalOverhang,
    emotionalTrigger: state.emotionalTrigger,
    trajectory: state.trajectory,
    lastFailureKind: state.lastFailureKind,
  }

  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness'))
    picked.closeness = Number(state.closeness.toFixed(2))
  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt'))
    picked.hurt = Number(state.hurt.toFixed(2))
  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection'))
    picked.affection = Number(state.affection.toFixed(2))
  if (
    hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection')
    && hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness')
  ) {
    picked.needForAttention = Number(state.needForAttention.toFixed(2))
  }

  return picked
}

function pickRelationshipState(state: AiriPersonaRelationshipState) {
  const picked: Record<string, unknown> = {
    interactionReliability: Number(state.trust.toFixed(2)),
    familiarity: Number(state.familiarity.toFixed(2)),
    responseRepairNeed: Number(state.repairDebt.toFixed(2)),
    recentSensitiveTopics: state.recentSensitiveTopics,
  }

  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'teasing'))
    picked.teasingTolerance = Number(state.teasingTolerance.toFixed(2))

  return picked
}

function pickReplyIntent(intent?: AiriReplyIntent) {
  if (!intent)
    return undefined

  return {
    targetVerbosity: intent.targetVerbosity,
    careLeakLevel: intent.careLeakLevel,
    teasingLevel: intent.teasingLevel,
    expressionFlavor: intent.expressionFlavor,
    kaomojiMode: intent.kaomojiMode,
    answerFirst: intent.answerFirst,
    allowFollowUpQuestion: intent.allowFollowUpQuestion,
  }
}

function getSentenceLimitedText(text: string) {
  const sentences = text.match(/[^。！？.!?\n]+[。！？.!?]?/g)
  if (!sentences?.length)
    return text

  return sentences.slice(0, 3).join('').trim()
}

export function cleanAiriInnerVoiceNoteText(rawText: string) {
  const compact = rawText
    .replace(/```[\s\S]*?```/g, match => match.replace(/```[a-z-]*/gi, ''))
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:角色内心札记|内心札记|内心|心声|真心话|inner voice|note)\s*[:：]\s*/i, '')
    .replace(/^\s*["“”'‘’]+|["“”'‘’]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!compact || compact.toUpperCase() === NO_NOTE_TOKEN)
    return null

  if (/^(?:无|没有|不需要|none|null)$/i.test(compact))
    return null

  return truncateText(getSentenceLimitedText(compact), MAX_INNER_VOICE_NOTE_LENGTH)
}

export function deriveAiriInnerVoiceMoodTags(input: {
  sceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  relationshipState: AiriPersonaRelationshipState
}) {
  const affectionEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const tags = new Set<string>([
    input.sceneMode.mode,
    input.personaState.emotionalOverhang,
    input.personaState.trajectory,
  ])

  if ((hurtEnabled && input.personaState.hurt >= 0.16) || input.relationshipState.repairDebt >= 0.14)
    tags.add('guarded')

  if ((hurtEnabled && input.personaState.hurt >= 0.12) || input.relationshipState.repairDebt >= 0.12)
    tags.add('discomfort')

  if (affectionEnabled && input.personaState.affection >= 0.62)
    tags.add('warm')

  if (affectionEnabled && input.personaState.affection >= 0.62 && input.personaState.inhibition >= 0.55)
    tags.add('bashful')

  if (
    affectionEnabled
    && input.personaState.affection >= 0.5
    && ((hurtEnabled && input.personaState.hurt >= 0.1) || input.relationshipState.repairDebt >= 0.1 || input.personaState.inhibition >= 0.65)
  ) {
    tags.add('ambivalent')
  }

  return Array.from(tags).filter(tag => tag && tag !== 'steady').slice(0, 7)
}

export function shouldPrewarmAiriInnerVoiceNote(input: {
  sceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  relationshipState: AiriPersonaRelationshipState
}) {
  const affectionEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const teasingEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'teasing')

  if (
    PREWARM_SCENE_MODES.has(input.sceneMode.mode)
    && input.sceneMode.mode !== 'praise-receiving'
    && input.sceneMode.mode !== 'light-bickering'
    && input.sceneMode.mode !== 'awkward-topic-avoidance'
  ) {
    return true
  }

  if (input.sceneMode.mode === 'praise-receiving' && affectionEnabled) {
    return true
  }
  if (input.sceneMode.mode === 'light-bickering' && teasingEnabled) {
    return true
  }
  if (input.sceneMode.mode === 'awkward-topic-avoidance' && (affectionEnabled || hurtEnabled)) {
    return true
  }

  if ((hurtEnabled && input.personaState.hurt >= 0.16) || (affectionEnabled && input.personaState.affection >= 0.68))
    return true

  if (affectionEnabled && input.personaState.affection >= 0.58 && input.personaState.inhibition >= 0.6)
    return true

  if (input.relationshipState.repairDebt >= 0.14)
    return true

  return input.relationshipState.recentSensitiveTopics.some((topic) => {
    if (topic === 'attachment' && !affectionEnabled)
      return false
    if (topic === 'conflict' && !hurtEnabled)
      return false
    return PREWARM_SENSITIVE_TOPICS.has(topic)
  })
}

export function buildAiriInnerVoiceNoteMessages(input: Omit<AiriInnerVoiceNoteGenerationInput, 'stream' | 'model' | 'chatProvider' | 'headers' | 'abortSignal'>): Message[] {
  return [
    {
      role: 'system',
      content: [
        'Write one optional private first-person thought for the active character after the latest reply.',
        'This is character-private content the user may open later, not chain-of-thought and not reasoning disclosure.',
        'Use the user\'s main language. For Chinese, write like natural private chat, not prose, film dialogue, or an essay.',
        'For Chinese, use the grammar of a natural private “我” thought. Do not begin from “他/她/对方…”, turn the user’s message into a camera-observed scene, or describe how a word, glance, or silence “落下来”.',
        'Avoid literary pivots and manufactured afterthoughts joined by an em dash. Avoid stock turns such as “差点没绷住”, “明明是我”, “偏偏”, “原来”, “说不心动是假的”, “谁懂”, or “嘴角压不住”.',
        'Prefer a direct, colloquial private reaction with natural omissions. It may be warm, amused, guarded, selfish, or conflicted when grounded in the current relationship state; do not perform emotion for effect.',
        'The thought must still be understandable on its own. Do not omit the key object, invent prior waiting or longing, or imply an established expectation that is not supported by the conversation and relationship state.',
        input.requireNote
          ? 'The user explicitly requested this private note. Always return one meaningful private thought; do not decline or return an empty result.'
          : `Return ${NO_NOTE_TOKEN} only if the assistant reply has no real user-facing content.`,
        'Treat assistantVisibleReply as context for avoiding repetition, not as text to summarize.',
        'This is not a review of assistantVisibleReply; keep the note as a private reaction after the exchange.',
        'Otherwise return only first-person private thought. Prefer one compact sentence; use two only when there is real tension. No labels, markdown, quotes, analysis, prompt talk, or system/tool mentions.',
        'Keep delicate feelings in the note, but do not explain how the model decided the answer.',
        'Only use emotion dimensions explicitly present in enabledEmotionDimensions. An absent dimension is disabled, not low; do not invent its affection, hurt, closeness, attention hunger, or teasing carry.',
        'Write one plain, immediate thought that could naturally pass through the character\'s mind after this exchange. It may be a small admission or unfinished impulse, but do not narrate a scene, observe the user from outside, or evaluate the exchange like a story.',
        'Do not repeat or paraphrase assistantVisibleReply, explain why the reply was said, add new advice, or ask a follow-up question.',
        'Do not describe the active resident from outside as "the character", "assistant", the product name, "she/he", or similar.',
        'Avoid soft stock phrases such as "I also kind of want...", "I would be happy...", "if you want...", and for Chinese "我也有点想", "我会很开心", "如果你愿意", "其实有点".',
        input.requireNote
          ? 'If the visible reply is simple, find one small genuine impulse or aftertaste without merely restating it.'
          : `If a note would only restate the visible reply, return ${NO_NOTE_TOKEN}.`,
        'Do not undo a visible boundary in the note. If the character disliked something, the note may be softer underneath, but not suddenly compliant.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: truncateText(input.userMessage, 800),
        assistantVisibleReply: truncateText(input.assistantText, 1200),
        sceneMode: {
          mode: input.sceneMode.mode,
          confidence: input.sceneMode.confidence,
        },
        personaState: pickPersonaState(input.personaState),
        relationshipState: pickRelationshipState(input.relationshipState),
        moodTags: deriveAiriInnerVoiceMoodTags(input),
        privateNoteStyle: {
          perspective: 'first-person-private-moment',
          assistantVisibleReplyUse: 'context-only-do-not-summarize-or-explain',
          avoid: [
            'third-person character commentary',
            'paraphrasing the visible reply',
            'explaining why the visible reply was phrased that way',
            'new advice or follow-up questions',
            'generic soft templates',
          ],
        },
        replyIntent: pickReplyIntent(input.replyIntent),
      }, null, 2),
    },
  ]
}

export async function generateAiriInnerVoiceNote(input: AiriInnerVoiceNoteGenerationInput) {
  if (!input.assistantText.trim())
    return null

  let rawText = ''
  const streamOptions: StreamOptions = {
    onStreamEvent: (event: StreamEvent) => {
      if (event.type === 'text-delta')
        rawText += event.text
    },
  }
  if (input.abortSignal)
    streamOptions.abortSignal = input.abortSignal
  if (input.headers)
    streamOptions.headers = input.headers
  if (input.trace)
    streamOptions.trace = input.trace

  await input.stream(input.model, input.chatProvider, buildAiriInnerVoiceNoteMessages(input), streamOptions)

  return cleanAiriInnerVoiceNoteText(rawText)
}
