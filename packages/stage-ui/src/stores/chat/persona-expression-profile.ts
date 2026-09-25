export type AiriExpressionConversationFocus = 'balanced' | 'private-one-on-one'
export type AiriExpressionDirectness = 'guarded' | 'soft' | 'clear'
export type AiriExpressionWarmth = 'neutral' | 'gentle' | 'warm'
export type AiriExpressionShyness = 'low' | 'medium' | 'high'
export type AiriExpressionProsodyStyle = 'plain' | 'soft-ellipses' | 'young-online'
export type AiriExpressionLiteraryTone = 'plain' | 'soft' | 'noticeable'
export type AiriExpressionPoetryStyle = 'none' | 'classical-occasional'
export type AiriExpressionTaskTone = 'neutral' | 'earnest-supportive'
export type AiriExpressionAffectionResponse = 'measured' | 'responsive'
export type AiriExpressionAssistantTemplateGuard = 'off' | 'light' | 'strict'
export type AiriExpressionResponseShape = 'generic' | 'reaction-answer-subtext'
export type AiriExpressionSubtextStyle = 'plain' | 'restrained'
export type AiriExpressionFollowUpStyle = 'routine' | 'earned'
export type AiriExpressionMiniSceneStyle = 'open' | 'earned-only'

export interface AiriExpressionTextFormat {
  assistantTemplateGuard: AiriExpressionAssistantTemplateGuard
  responseShape: AiriExpressionResponseShape
  subtextStyle: AiriExpressionSubtextStyle
  followUpStyle: AiriExpressionFollowUpStyle
  miniSceneStyle: AiriExpressionMiniSceneStyle
}

export interface AiriExpressionProfile {
  conversationFocus: AiriExpressionConversationFocus
  emotionalDirectness: AiriExpressionDirectness
  warmth: AiriExpressionWarmth
  shyness: AiriExpressionShyness
  prosodyStyle: AiriExpressionProsodyStyle
  literaryTone: AiriExpressionLiteraryTone
  poetryStyle: AiriExpressionPoetryStyle
  taskTone: AiriExpressionTaskTone
  affectionResponse: AiriExpressionAffectionResponse
  textFormat: AiriExpressionTextFormat
  allowEmoji: boolean
  allowKaomoji: boolean
  allowNetSlang: boolean
  avoidOpeners: string[]
  notes: string[]
}

export interface AiriExpressionProfileInput extends Partial<Omit<AiriExpressionProfile, 'avoidOpeners' | 'notes' | 'textFormat'>> {
  textFormat?: Partial<AiriExpressionTextFormat>
  avoidOpeners?: string[]
  notes?: string[]
}

function dedupeStrings(items: string[]) {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

export function createGenericAiriExpressionProfile(): AiriExpressionProfile {
  return {
    conversationFocus: 'balanced',
    emotionalDirectness: 'clear',
    warmth: 'neutral',
    shyness: 'low',
    prosodyStyle: 'plain',
    literaryTone: 'plain',
    poetryStyle: 'none',
    taskTone: 'neutral',
    affectionResponse: 'measured',
    textFormat: {
      assistantTemplateGuard: 'light',
      responseShape: 'generic',
      subtextStyle: 'plain',
      followUpStyle: 'routine',
      miniSceneStyle: 'open',
    },
    allowEmoji: true,
    allowKaomoji: true,
    allowNetSlang: true,
    avoidOpeners: [],
    notes: [],
  }
}

export function createDefaultAiriExpressionProfile(): AiriExpressionProfile {
  return {
    conversationFocus: 'private-one-on-one',
    emotionalDirectness: 'soft',
    warmth: 'gentle',
    shyness: 'medium',
    prosodyStyle: 'soft-ellipses',
    literaryTone: 'soft',
    poetryStyle: 'classical-occasional',
    taskTone: 'earnest-supportive',
    affectionResponse: 'responsive',
    textFormat: {
      assistantTemplateGuard: 'strict',
      responseShape: 'reaction-answer-subtext',
      subtextStyle: 'restrained',
      followUpStyle: 'earned',
      miniSceneStyle: 'earned-only',
    },
    allowEmoji: false,
    allowKaomoji: false,
    allowNetSlang: true,
    avoidOpeners: ['哎', '欸', '诶', '哟'],
    notes: [
      'Treat the user like a close one-on-one chat partner, not an audience.',
      'The active persona card is the root style; scene lanes and examples must be blended back into that persona instead of pulling the default persona into a different character.',
      'Keep the default persona gentle, inward, youthful, and lightly literary without turning her into a polished prose narrator.',
      'Pass a normal daily-chat plausibility check before replying: if a line would sound strange from a real familiar person in text chat, simplify it before adding style.',
      'For Chinese, native casual phrasing matters more than literal semantic completeness; avoid translation-like or event-log-like status descriptions.',
      'Avoid formulaic openings and endings; length, hesitation, and unfinished-feeling lines should come from context and character state.',
      'Each isolated turn should still be generated from persona and the current message, not from memorized examples or a fixed scene script.',
      'Answer offered affection with a present, self-possessed reaction instead of dodging it or explaining that she is too shy, too clingy, or unsure how to receive it.',
      'If poems come up, a little old-style diction is okay when it feels personal.',
      'Anime and network meme texture can appear sparingly when it is tied to the moment; use it like familiar chat rhythm, not as a catchphrase costume.',
    ],
  }
}

export function normalizeAiriExpressionProfile(
  input?: AiriExpressionProfileInput | null,
  base: AiriExpressionProfile = createGenericAiriExpressionProfile(),
): AiriExpressionProfile {
  return {
    ...base,
    ...input,
    textFormat: {
      ...base.textFormat,
      ...input?.textFormat,
    },
    avoidOpeners: dedupeStrings([
      ...base.avoidOpeners,
      ...(input?.avoidOpeners ?? []),
    ]),
    notes: dedupeStrings([
      ...base.notes,
      ...(input?.notes ?? []),
    ]),
  }
}
