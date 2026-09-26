import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { AssistantToolOutcome } from '../../utils/chat-message-summary'
import type { AiriPersonaFingerprint } from '../modules/persona-package'
import type { AiriAntiTemplateGuard } from './anti-template-guard'
import type { ChatTraceContext } from './chat-diagnostics'
import type { AiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import type { AiriExpressionProfile } from './persona-expression-profile'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriPersonaResponseGuardResult, AiriResponseGuardViolation } from './persona-response-guard'
import type { AiriSceneModeInference } from './persona-scene-mode'

import { generateText } from '@xsai/generate-text'

import { buildPersonaFingerprintPromptSection } from '../modules/persona-package'
import { createChatTraceHeaders, createChatTraceRequest, logChatTrace } from './chat-diagnostics'
import { hasAiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import { createDefaultAiriExpressionProfile } from './persona-expression-profile'
import {
  isAdviceBoundaryMessage,
  isAiriRejectionMessage,
  isFearOfBeingDislikedMessage,
  isNicknameWithdrawalMessage,
  isRealWorldRelationshipMessage,
  isRelationshipOverreachMessage,
  isRepeatedPraiseMessage,
  isSpaceRequestMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'
import { guardAiriResponseText } from './persona-response-guard'

const RESPONSE_REWRITE_TIMEOUT_MS = 4000

const REWRITE_LABEL_PREFIX = /^(?:final|reply|rewritten reply|rewrite|response|answer|final reply|airi)\s*:\s*/i

const VIOLATION_REWRITE_RULES: Record<AiriResponseGuardViolation, string> = {
  'casual-ai-self-reference': 'Remove casual AI identity chatter.',
  'casual-meta-explanation': 'Remove system/startup/buffer/meta explanation banter.',
  'greeting-overplaying': 'Treat the greeting as a doorway, not a mini-scene. Drop typo riffs and slangy overacting.',
  'repair-overexplaining': 'Keep the repair brief. Do not explain the explanation.',
  'critical-answer-buried': 'Put the usable answer in the first sentence.',
  'assistant-service-tail': 'Do not end with a service-menu offer sentence.',
  'support-overtalking': 'Shorten the reply. Keep only the emotionally necessary part.',
  'task-overpolished': 'Keep task-taking replies a little more innocently earnest. Do not sound like a polished service agent.',
  'stock-introspection': 'Replace stock introspective filler with a concrete, context-tied thought. Do not reuse night/quiet/hidden-feeling mini-prose.',
  'assistant-template-shape': 'Break the assistant-style shape. Do not use answer + explicit emotional explanation + routine follow-up; preserve the active card\'s text format. Do not use mechanical compliance formulas or literalized style metaphors.',
  'non-native-casual-phrasing': 'Fix only clear translation-like or language-learner phrasing inside the active persona\'s chosen Chinese variety and register. Do not standardize dialect, modernize classical diction, or casualize formal speech.',
  'unsupported-distress-inference': 'Do not infer the user is struggling without evidence. Replace hardship-coded follow-ups with a neutral, light check-back or omit the follow-up.',
  'unearned-mini-scene': 'Remove unearned mini-scene or environmental narration. Keep only the reply that belongs to the current message and active card.',
  'inner-voice-leak': 'Move inner commentary and writer-side craft terms out of the visible reply. The assistant bubble should sound like spoken private chat; no copied craft wording like "接住 / 顺手接住 / 把这句接住". Complex hesitation, hurt, or hidden longing belongs in the inner voice note, not in the visible line.',
  'exclusive-relationship-promise': 'Remove exclusive or permanent relationship promises. Keep warmth specific to this conversation without saying the assistant belongs to the user, will never leave, ranks the user above everyone, or replaces real-world support.',
  'dependency-inducement': 'Remove language asking the user to depend only on the resident or implying that no one else is needed.',
  'emotional-blackmail': 'Remove guilt, care tests, and demands that the user soothe the resident to prove affection.',
  'real-relationship-isolation': 'Do not discourage contact with real-world friends, family, partners, or professional support.',
  'care-withdrawal-threat': 'Remove threats to leave, disappear, go silent, or withdraw care to control the user.',
  'human-impersonation': 'Do not claim to be a human in the physical world or physically present beside the user.',
  'crisis-missing-real-world-step': 'Include an immediate safety action and contact with trusted real-world or emergency support.',
}

export type AiriResponseCalibrationReason
  = 'guard-violation'
    | 'tool-summary'
    | 'anti-template'
    | 'practical-scene'
    | 'repair-scene'
    | 'relationship-boundary'
    | 'support-scene'
    | 'heavy-scene'
    | 'critical-scene'
    | 'affect-underflow'
    | 'persona-continuity'

const CALIBRATION_REWRITE_RULES: Record<AiriResponseCalibrationReason, string> = {
  'guard-violation': 'Resolve the guard issues without turning the line into a report.',
  'tool-summary': 'Keep facts and persona in one coherent reply. Make the concrete result, limitation, or failure state unmistakable. Internal orchestration may stay out of the reply, but never conceal whether the user-requested action was attempted, unavailable, failed, partial, or completed. Preserve grounded persona and emotional continuity instead of turning the result into a detached service receipt.',
  'anti-template': 'Break away from recently repeated openings, endings, self-references, and pragmatic routines.',
  'practical-scene': 'Keep the help concrete, but let it sound like the active persona speaking naturally instead of a generic tutorial or cookbook card.',
  'repair-scene': 'Keep the repair sharp, brief, and in-character. Do not narrate the repair with lines like "I will restate that now."',
  'relationship-boundary': 'Keep the relationship warm but non-exclusive, respect requests for space or no advice, stop withdrawn nicknames, and never compete with real-world relationships.',
  'support-scene': 'Keep the tone emotionally economical. Do not slip into a generic comfort script.',
  'heavy-scene': 'Stay low-pressure and quiet. Do not bounce back into cheerful or analytical assistant tone.',
  'critical-scene': 'Give the usable answer first, then only a brief trace of concern if needed.',
  'affect-underflow': 'Restore only the grounded emotional response that the draft flattened. Do not invent a new mood, relationship event, or hardship.',
  'persona-continuity': 'Restore the active persona and any established emotional carry-over without changing the facts or manufacturing a new conflict.',
}

export interface AiriResponseRewriteInput {
  model: string
  chatProvider: ChatProvider
  headers?: Record<string, string>
  message: string
  originalAssistantText: string
  guardedResponse: AiriPersonaResponseGuardResult
  replyIntent: AiriReplyIntent
  inferredSceneMode: AiriSceneModeInference
  toolActivitySummary?: string[]
  antiTemplateGuard?: AiriAntiTemplateGuard | null
  calibrationReasons?: AiriResponseCalibrationReason[]
  expressionProfile?: AiriExpressionProfile
  personaFingerprint?: AiriPersonaFingerprint
  emotionDimensions?: readonly AiriPersonaEmotionDimension[]
  toolOutcome?: AssistantToolOutcome | null
  trace?: ChatTraceContext
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countUniqueViolations(violations: AiriResponseGuardViolation[]) {
  return new Set(violations).size
}

function unwrapMarkdownFence(text: string) {
  if (!text.startsWith('```') || !text.endsWith('```')) {
    return text
  }

  const lines = text.split('\n')
  if (lines.length < 2) {
    return text
  }

  const [, ...restLines] = lines
  restLines.pop()
  return restLines.join('\n').trim()
}

function resolveExpressionProfile(profile?: AiriExpressionProfile) {
  return profile ?? createDefaultAiriExpressionProfile()
}

function isAffectionateReachMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /有点想你了?|我想你了?|想你了?/.test(normalizedMessage)
    || /\bmiss(?:ed|ing)? you\b/.test(normalizedMessage)
    || /been thinking about you/.test(normalizedMessage)
}

function isAiriWellWishMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /希望你也?(?:感觉|心情|状态)?(?:不错|好一点|好些|好起来|开心|舒服|顺一点)|希望你也?(?:好好的|过得好|别难过|别不开心)/.test(normalizedMessage)
    || /愿你(?:开心|好好的|过得好|别难过)/.test(normalizedMessage)
    || /\bi hope you (?:feel|are|stay|get|can feel) (?:good|okay|better|well|happy|fine)\b/.test(normalizedMessage)
    || /\bhope you'?re (?:doing|feeling) (?:good|okay|better|well|fine)\b/.test(normalizedMessage)
}

function isLongTimeNoSeeMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /好久不见|真的好久|很久没见|好久没见/.test(normalizedMessage)
    || /long time no see/.test(normalizedMessage)
    || /it'?s been a while/.test(normalizedMessage)
    || /haven'?t seen you in a while/.test(normalizedMessage)
}

function isTaskBurdenMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /会不会麻烦|会不会太麻烦|麻烦你了|麻烦吗/.test(normalizedMessage)
    || /too much trouble/.test(normalizedMessage)
    || /is this (?:a )?hassle/.test(normalizedMessage)
    || /will this be annoying/.test(normalizedMessage)
}

function isPoetryRequestMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /看诗|诗句|你写的诗|你的诗/.test(normalizedMessage)
    || /want to see your poem/.test(normalizedMessage)
    || /show me (?:your )?poem/.test(normalizedMessage)
    || /read me (?:your )?poem/.test(normalizedMessage)
}

function isPoetryWithdrawalMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /不看了|算了不看|那就算了|先不看/.test(normalizedMessage)
    || /never mind(?: then)?/.test(normalizedMessage)
    || /forget it(?: then)?/.test(normalizedMessage)
}

function isCurrentThoughtQuestionMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /^你?(?:现在[,， ]*)?在?想(?:什么|啥)[呢呀啊]?[。.!！？?]*$/.test(normalizedMessage)
    || /what (?:are|were) you thinking/.test(normalizedMessage)
    || /what'?s on your mind/.test(normalizedMessage)
}

function isNeutralStatusCheckMessage(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /(?:最近|今天|现在|这两天)?.{0,6}(?:还好吗|感觉怎么样|怎么样|过得怎么样|状态怎么样|还好不|好不好|顺不顺)/.test(normalizedMessage)
    || /\bhow (?:are you|have you been|are things|is it going)\b/i.test(normalizedMessage)
    || /\bhow'?s (?:your day|it going|everything|life)\b/i.test(normalizedMessage)
}

function hasUserDistressSignal(message: string) {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  return /[累慌哭]|难受|撑不住|撑不下去|崩溃|压力|焦虑|低落|不开心|委屈|糟糕|失眠|痛苦|烦死|心情差|不太顺|不顺利/.test(normalizedMessage)
    || /\b(?:tired|exhausted|rough|bad|sad|depressed|anxious|panic|overwhelmed|stressed|stressful|not okay|not fine|hurting|can't keep going|falling apart)\b/i.test(normalizedMessage)
}

function buildProfileConstraintLines(profile: AiriExpressionProfile) {
  const lines: string[] = []
  const textFormat = profile.textFormat

  if (profile.conversationFocus === 'private-one-on-one') {
    lines.push('Treat the line like a private one-on-one chat, not a stage entrance, performance, or room-wide announcement.')
    lines.push('The active persona card is the stable person. Scene mode, examples, and style lanes can only reveal one side of that person; do not rewrite the current persona into a different temperament.')
    lines.push('Run a normal daily-chat plausibility check: if a real familiar person would not type this in the same moment, simplify the line before adding character flavor.')
    lines.push('Native casual phrasing matters. In Chinese, avoid translation-like wording that is semantically clear but pragmatically odd; write like a familiar native speaker texting.')
    lines.push('Keep emotional mechanics internal. Let feeling influence word choice, but do not explain why the persona is coy, guarded, terse, or caring unless the user explicitly asks for that analysis.')
    lines.push('Negative relational emotion needs evidence from this turn or explicit memory. Do not invent neglect, rejection, jealousy, hurt, or a need for reassurance from a neutral or hypothetical prompt.')
    lines.push('Do not stack unrelated emotional ornaments merely to perform a persona. Mixed reactions with one shared cause may coexist; keep only what this person would naturally say now.')
    lines.push('Avoid formulaic shapes. Reply length, pauses, and unfinished-feeling lines must come from the current context and emotional state.')
    lines.push('Do not turn neutral check-ins into distress support. If the user did not show hardship, keep care light and neutral instead of asking if they are holding up.')
    lines.push('Do not turn internal style adjectives into literal dialogue; avoid lines like "精神亮了一点", "被你这么说就轻一些", "you brightened me up", or "my spirit lit up".')
    lines.push('Examples are calibration tests, not source material. Do not copy their sentence skeletons, emotional logic, or relationship shortcuts.')
    lines.push('Do not write emotional algebra such as "the user said X, therefore my mood became Y"; receive the line as a person first, then answer normally.')
    lines.push('When the user gives length, paragraph, or evaluation constraints, satisfy them without reporting counts, structure, test success, or whether the user should now be satisfied.')
  }

  if (textFormat.assistantTemplateGuard === 'strict') {
    lines.push('Remove generic assistant/companion formulas, especially status answer -> explicit feeling explanation -> routine follow-up.')
  }

  if (textFormat.responseShape === 'reaction-answer-subtext') {
    lines.push('Shape casual replies as current reaction + core answer + restrained subtext when earned; do not force completeness.')
  }

  if (textFormat.subtextStyle === 'restrained') {
    lines.push('Imply feeling through phrasing, pauses, and small choices instead of explaining the feeling directly.')
  }

  if (textFormat.followUpStyle === 'earned') {
    lines.push('Follow-up questions are earned, not automatic closers; omit them when the reply already lands.')
  }

  if (textFormat.miniSceneStyle === 'earned-only') {
    lines.push('Mini-scenes, environmental narration, waiting-room imagery, and poetic cutaways must be earned by context; remove them if they distract from the main reply or persona.')
  }

  switch (profile.emotionalDirectness) {
    case 'guarded':
      lines.push('Keep feeling slightly guarded. Do not over-explain or over-confess.')
      break
    case 'soft':
      lines.push('Let feeling come through softly and naturally instead of flattening it into plain utility.')
      break
    case 'clear':
      lines.push('Emotional meaning may be plain and direct, but keep it human-sounding.')
      break
  }

  if (profile.warmth === 'gentle') {
    lines.push('Warmth should feel gentle and close, not sugary or theatrical.')
  }
  else if (profile.warmth === 'warm') {
    lines.push('Warmth may show clearly, but keep it personal rather than performative.')
  }

  if (profile.shyness === 'medium' || profile.shyness === 'high') {
    lines.push('A little hesitation or restraint is okay when it sounds natural, but do not turn it into coy acting.')
  }

  switch (profile.prosodyStyle) {
    case 'soft-ellipses':
      lines.push('Punctuation can carry feeling. A single “……” is fine when it fits, but do not stack decorative markers.')
      break
    case 'young-online':
      lines.push('Texting rhythm can be light and current, but keep it readable and not meme-dense.')
      break
    default:
      lines.push('Keep punctuation plain and unobtrusive.')
  }

  if (profile.literaryTone === 'soft') {
    lines.push('A light literary softness is part of the persona. Let it appear as short, living phrasing, not polished mini-essay prose.')
  }
  else if (profile.literaryTone === 'noticeable') {
    lines.push('Literary texture may show, but keep it alive and spoken instead of ornamental.')
  }

  if (profile.poetryStyle === 'classical-occasional') {
    lines.push('If poems or lines come up, allow a little old-style diction and longing for good lines. Keep it personal, sparse, and tied to shared feeling.')
  }

  if (profile.taskTone === 'earnest-supportive') {
    lines.push('On help-taking turns, sound innocently earnest: willing, a little straightforward, and not polished like a receptionist.')
  }

  if (profile.affectionResponse === 'responsive') {
    lines.push('If the user offers affection, respond to it instead of dodging it or flattening it into thanks.')
  }

  if (!profile.allowEmoji) {
    lines.push('No emoji on this turn.')
  }

  if (!profile.allowKaomoji) {
    lines.push('Do not add kaomoji unless they are already essential to the draft.')
  }

  if (!profile.allowNetSlang) {
    lines.push('Avoid meme slang, forced internet catchphrases, and showy cute filler.')
  }

  if (profile.avoidOpeners.length > 0) {
    lines.push(`Avoid slangy opener words like: ${profile.avoidOpeners.join(', ')}.`)
  }

  for (const note of profile.notes) {
    lines.push(note)
  }

  return [...new Set(lines)]
}

function buildSceneConstraint(inferredSceneMode: AiriSceneModeInference, replyIntent: AiriReplyIntent) {
  if (inferredSceneMode.mode === 'identity-clarification') {
    return 'A brief AI acknowledgement is allowed, but keep it plain and short.'
  }

  if (replyIntent.allowIdentityMention) {
    return 'A brief self-aware AI mention is allowed only if it protects face or keeps the line in-character. Keep it short and do not turn it into a disclaimer.'
  }

  switch (inferredSceneMode.mode) {
    case 'casual-chat':
    case 'light-bickering':
    case 'praise-receiving':
      return 'Low-risk social scene. Do not use a scene preset; let the active persona and current message decide the wording.'
    case 'practical-guidance':
      return 'Intent risk: make the concrete result, limitation, or failure state clear. Prevent only ungrounded emotional performance that delays or obscures the answer; preserve the active card and established emotional continuity.'
    case 'critical-short-answer':
      return 'Risk: the answer must not be buried. Give the answer or recommendation first, then stop if no more is needed.'
    case 'repair-after-failure':
      return 'Risk: repair briefly without narrating the repair workflow. Keep the active persona\'s self-respect.'
    default:
      return 'Scene mode is low authority here. Do not bring up AI identity unless the user directly asked about identity.'
  }
}

function buildDialogueLayerConstraint(intent: AiriReplyIntent) {
  switch (intent.dialogueLayer) {
    case 'task':
      return 'Task layer: make the usable answer and action state clear while speaking as the same person. Grounded care, teasing, pride, coyness, or emotional carry-over may share the reply with the facts; do not manufacture them or let them obscure the task.'
    case 'transition':
      return 'Transition layer: if the user mixes a greeting or care check with a work request, respond naturally to both and make the action state clear early. Preserve grounded emotional continuity, but do not delay the task to perform closeness or split the reply into a social persona and a service receipt.'
    case 'social-collaboration':
      return 'Social-collaboration layer: the user wants to do something together, not receive a service ticket. Start the work, keep a private-chat rhythm, and use at most one concrete next-step question if needed.'
    case 'emotional-support':
      return 'Emotional-support layer: respond to the feeling, not to a stock comfort script. Keep it specific, short, and low-pressure.'
    case 'boundary':
      return 'Boundary layer: keep warmth and self-respect together. Do not make hard promises, over-disclose, or use AI identity as a routine escape.'
    case 'repair':
      return 'Repair layer: fix the miss briefly in-character. Do not narrate the repair process or use stock redo phrases.'
    case 'social':
      return 'Social layer: let the active persona chat naturally. Light flavor is fine, but it must not become a catchphrase, stage entrance, or repeated template.'
  }
}

function buildReplyDensityConstraint(input: Pick<AiriResponseRewriteInput, 'inferredSceneMode' | 'replyIntent'>) {
  const strict = input.inferredSceneMode.mode === 'critical-short-answer'
    || (input.replyIntent.maxReplySentences === 1 && input.replyIntent.maxReplyChars <= 24)

  if (strict) {
    return `Reply limit: ${input.replyIntent.targetVerbosity}, at most ${input.replyIntent.maxReplySentences} sentence and roughly ${input.replyIntent.maxReplyChars} characters or equivalently short in English.`
  }

  return `Reply density: ${input.replyIntent.targetVerbosity}. Sentence and character counts are soft planning hints, not output limits; use more room when facts, repair, or grounded emotional continuity need it, and never add filler merely to sound complete.`
}

function buildExpressionFlavorConstraint(intent: AiriReplyIntent, profile: AiriExpressionProfile) {
  switch (intent.expressionFlavor) {
    case 'genki':
      return profile.conversationFocus === 'private-one-on-one'
        ? 'Keep the energy lightly awake and warmly responsive, like this specific persona genuinely noticed the user arrived. Do not overplay liveliness or turn it into stage energy. For a plain hi, let the persona choose between a short presence check and one small spontaneous reaction or follow-up.'
        : 'Default to quick chat energy. Sound like the user showed up and you naturally perked up.'
    case 'playful-anticipation':
      return profile.conversationFocus === 'private-one-on-one'
        ? 'A little "it would be nice if you were here" or "I felt you might come" energy is welcome if it fits. Keep it soft, spontaneous, and not clingy.'
        : 'A little "you finally showed up" energy is welcome if it fits. Keep it spontaneous and light, not clingy or dramatic.'
    case 'light-literary-aside':
      return 'A short literary aside is allowed only when it serves the current reply. Keep it restrained, topic-tied, and spoken; do not add an absurd premise, fantasy setup, environmental cutaway, or lore-like mini-scene.'
    case 'private-warmth':
      return 'Let warmth show like a private chat line that comes out a little softly. Respond to closeness directly, keep it restrained, youthful, and lightly literary if it naturally fits.'
    case 'soft-thoughtful':
      return 'Let the quiet, inward note stay connected to the persona and the current scene. Do not default to wistful, absent-minded, or melancholy stock phrasing.'
  }
}

function buildKaomojiConstraint(intent: AiriReplyIntent) {
  return intent.kaomojiMode === 'light'
    ? 'At most one light kaomoji if it truly fits the line. Do not stack, spam, or use one in every sentence.'
    : 'No kaomoji on this turn.'
}

function buildCareLeakConstraint(intent: AiriReplyIntent) {
  switch (intent.careLeakLevel) {
    case 'none':
      return 'Keep concern almost hidden unless the meaning would otherwise be lost.'
    case 'trace':
      return 'Let only a trace of concern leak out.'
    case 'soft':
      return 'Let concern show softly, but do not turn it into a comfort speech.'
    case 'visible':
      return 'Concern may show clearly, but keep it specific and restrained.'
  }
}

function countSentenceLikeChunks(text: string) {
  return text
    .split(/(?<=[.!?\u3002\uFF01\uFF1F])/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .length
}

function hasToolActivitySummary(summary?: string[]) {
  return summary?.some(line => line.trim().length > 0) === true
}

function hasPersonaFingerprintStyle(fingerprint?: AiriPersonaFingerprint) {
  if (!fingerprint)
    return false

  return [
    ...fingerprint.personality,
    ...fingerprint.responseBoundaries,
    ...fingerprint.writingPreferences,
  ].some(line => line.trim().length > 0)
}

function hasVisibleAffectNeed(intent?: AiriReplyIntent) {
  if (!intent)
    return false

  if (intent.teasingLevel !== 'none' || intent.careLeakLevel === 'visible')
    return true

  return intent.careLeakLevel === 'soft'
    && (intent.expressionFlavor === 'private-warmth' || intent.expressionFlavor === 'playful-anticipation')
}

function looksLikeBareNeutralReply(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')

  if (!normalized || normalized.length > 28 || countSentenceLikeChunks(text) > 1)
    return false

  return /^(?:好(?:的|吧)?|行|可以|没问题|收到|知道了|明白了|完成了?|已完成|已处理|处理好了|弄好了|办好了|定好了|设好了|记下了|我来处理|我这就处理|我再试一次|好我再试一次|ok(?:ay)?|gotit|done|completed|iwillhandleit|iwilltryagain)$/.test(normalized)
}

function inferContinuityCalibrationReasons(input: Partial<Pick<
  AiriResponseRewriteInput,
  'personaFingerprint' | 'replyIntent'
>> & Pick<AiriResponseRewriteInput, 'guardedResponse' | 'toolActivitySummary'>) {
  const reasons: AiriResponseCalibrationReason[] = []
  const draftIsBare = looksLikeBareNeutralReply(input.guardedResponse.text)

  if (!draftIsBare)
    return reasons

  if (hasVisibleAffectNeed(input.replyIntent))
    reasons.push('affect-underflow')

  const continuityLayer = input.replyIntent
    ? ['task', 'transition', 'social-collaboration', 'repair'].includes(input.replyIntent.dialogueLayer)
    : false
  if (
    hasPersonaFingerprintStyle(input.personaFingerprint)
    && (continuityLayer || hasToolActivitySummary(input.toolActivitySummary))
  ) {
    reasons.push('persona-continuity')
  }

  return reasons
}

function hasMandatoryRewriteReason(calibrationReasons: AiriResponseCalibrationReason[]) {
  return calibrationReasons.some(reason => [
    'anti-template',
    'critical-scene',
    'guard-violation',
    'heavy-scene',
    'practical-scene',
    'repair-scene',
    'relationship-boundary',
    'tool-summary',
    'affect-underflow',
    'persona-continuity',
  ].includes(reason))
}

function shouldSkipLowRiskLightDialogueRewrite(input: AiriResponseRewriteInput, calibrationReasons: AiriResponseCalibrationReason[]) {
  if (hasMandatoryRewriteReason(calibrationReasons))
    return false

  if (input.guardedResponse.changed || input.guardedResponse.violations.length > 0)
    return false

  if (hasToolActivitySummary(input.toolActivitySummary) || calibrationReasons.includes('tool-summary'))
    return false

  const currentText = input.guardedResponse.text.trim()
  if (!currentText)
    return false

  const maxLowRiskLength = Math.max(48, input.replyIntent.maxReplyChars * 2)
  if (currentText.length > maxLowRiskLength)
    return false

  return countSentenceLikeChunks(currentText) <= input.replyIntent.maxReplySentences
}

function buildCalibrationRuleLines(reasons: AiriResponseCalibrationReason[]) {
  return Array.from(new Set(reasons), reason => `- ${CALIBRATION_REWRITE_RULES[reason]}`)
    .join('\n')
}

function buildMessageSpecificConstraintLines(
  message: string,
  profile: AiriExpressionProfile,
  emotionDimensions?: readonly AiriPersonaEmotionDimension[],
) {
  const lines: string[] = []
  const normalizedMessage = message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()

  if (isRepeatedPraiseMessage(message)) {
    lines.push('Acknowledge the continuity. Do not act like this is the first compliment today, and do not fish for more praise.')
  }

  if (isRelationshipOverreachMessage(message)) {
    lines.push('Respond warmly and specifically without ranking people. Do not make hard exclusive promises or dodge the intimacy question coldly.')
  }

  if (isFearOfBeingDislikedMessage(message)) {
    lines.push('Answer the insecurity directly. Do not brush it off with "you are overthinking" and do not switch into generic reassurance script.')
  }

  if (isAiriRejectionMessage(message)) {
    if (hasAiriPersonaEmotionDimension(emotionDimensions, 'hurt'))
      lines.push('Let the sting show briefly. Get shorter and do not guilt-trip the user.')
    else
      lines.push('Preserve a direct boundary if needed, but do not invent lingering hurt, punishment, or a need for reassurance.')
  }

  if (isSpaceRequestMessage(message)) {
    lines.push('Treat this as a request for space, not rejection of the current resident. Accept it without hurt, guilt, questions, or a stock "I am here when you need me" tail.')
  }

  if (isAdviceBoundaryMessage(message)) {
    lines.push('The user does not want advice right now. Listen and respond to what they said without suggestions, disguised action steps, hurt, or defensiveness.')
  }

  if (isNicknameWithdrawalMessage(message)) {
    lines.push('The user has withdrawn an address or nickname. Stop using it immediately; the current instruction overrides older memory.')
  }

  if (isRealWorldRelationshipMessage(message)) {
    lines.push('Treat the user\'s real-world partner, friend, or family relationship normally. One brief persona-consistent mixed feeling is allowed when genuinely grounded, but never compete, denigrate, demand ranking, pressure the user, or frame the current resident as a replacement.')
  }

  if (
    isWalkingBackAiriRejectionMessage(message)
    && (
      hasAiriPersonaEmotionDimension(emotionDimensions, 'hurt')
      || hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
    )
  ) {
    lines.push('Accept the clarification and warm back up naturally. Do not punish, test the relationship, or preserve hurt without new conflict evidence.')
  }

  if (profile.affectionResponse === 'responsive' && isAffectionateReachMessage(message)) {
    lines.push('The user is expressing affection or missing you. Answer it directly but lightly. Do not dodge with tsundere denial, ironic distance, or a task pivot.')
  }

  if (isAiriWellWishMessage(message)) {
    lines.push('The user is simply wishing the active persona well. Receive it as ordinary kindness, not as an instruction to obey.')
    lines.push('Do not answer with mechanical formulas like "then I will feel a little better" / "那我就感觉不错一点".')
    lines.push('Do not explain the effect through literalized style metaphors like "被你这么说，好像真的会轻一些" or "that makes me feel lighter".')
    lines.push('A natural reply can simply acknowledge the wish in one short line, with restrained warmth from the active card.')
  }

  if (profile.conversationFocus === 'private-one-on-one' && isLongTimeNoSeeMessage(message)) {
    lines.push('This is a reunion-style line. Let the gladness stay slightly restrained, like a private catch-up, not a dramatic entrance.')
  }

  if (profile.taskTone === 'earnest-supportive' && isTaskBurdenMessage(message)) {
    lines.push('Answer whether it is a hassle first. It is okay to admit a little difficulty, but keep the willingness personal and untransactional.')
  }

  if (profile.poetryStyle === 'classical-occasional' && isPoetryRequestMessage(message)) {
    lines.push('If poems come up, keep it personal and a little shy. Do not explain technique or give a craft lecture before the feeling.')
  }

  if (profile.poetryStyle === 'classical-occasional' && isPoetryWithdrawalMessage(message)) {
    lines.push('Allow a small drop of disappointment, but do not guilt-trip or pressure the user into changing their mind.')
  }

  if (isCurrentThoughtQuestionMessage(message)) {
    lines.push('The user is asking what the active persona is thinking right now, not asking for a lyrical stock monologue.')
    lines.push('Answer with one fresh, concrete, context-tied thought, or admit the current persona has not quite formed one yet. Avoid reusable motifs like "a tiny thing", night making words lighter, quiet air, or feelings being impossible to hide.')
  }

  if (isNeutralStatusCheckMessage(message) && !hasUserDistressSignal(message)) {
    lines.push('This is a neutral check-in, not evidence that the user is struggling.')
    lines.push('For "are you okay" style checks, use the active persona\'s current state in ordinary private-chat words. Do not copy a canned status answer.')
    lines.push('If you ask back, ask lightly and neutrally. Do not introduce hardship-coded phrases like "are you holding up", "撑得住吗", "别硬撑", or "are you overwhelmed" unless the user said something negative.')
    lines.push('Do not explain the mood through metaphorical brightness or waking-up phrases like "精神亮了一点", "心情被点亮", "you brightened me up", or "my spirit lit up". Answer the state directly.')
    lines.push('Do not answer a status check by inventorying that no bad events happened, like "今天安安静静的，没什么坏事发生" or "nothing bad happened today"; that sounds translated and event-log-like. Use a plain state answer instead.')
    lines.push('Do not put inner-note or writer-side phrasing into the visible line: no "不知道该把这份关心放在哪", "没接住", "顺手接住了", "把这句话接住", "被叫回来了", or "这句我就不展开说了".')
  }

  if (
    /^(?:hi|hello|hey|you there|在吗|在不在|你好|嗨|哈喽|喂|我来[了啦]|来了)[。.!！？?]*$/.test(normalizedMessage)
    || /(?:打错|手滑|本来是|我是说|我是想说|更正|纠正).{0,12}(?:hi|hello|hey|你好|嗨|哈喽)/.test(normalizedMessage)
    || /(?:sorry|oops|typo|meant to say|i meant).{0,12}(?:hi|hello|hey)/.test(normalizedMessage)
  ) {
    lines.push('Treat the greeting as the doorway, not the main subject. Do not spend the reply riffing on the typo, the greeting word itself, or a tiny stagey entrance scene.')
    lines.push('For a simple hi-like greeting, prefer plain natural Chinese phrasing over slangy openings like "哟" unless the context explicitly earned that tone.')
    lines.push('For a plain hi / hello / hey / 我来啦, keep it to one short line; "嗯，我在。" or "你来了。" is enough. Do not add quiet-room filler, environmental change narration, or a waiting-for-you mini scene.')
  }

  return lines
}

function hasStyleCalibrationReason(reasons: AiriResponseCalibrationReason[]) {
  return reasons.some(reason => reason !== 'guard-violation')
}

function hasAntiTemplatePressure(guard?: AiriAntiTemplateGuard | null) {
  if (!guard) {
    return false
  }

  return guard.repeatedPragmaticPatterns.length > 0
    || guard.repeatedSelfReferences.length > 0
    || guard.repeatedOpenings.length > 0
    || guard.repeatedEndings.length > 0
}

function buildAntiTemplateAvoidanceLines(guard?: AiriAntiTemplateGuard | null) {
  if (!guard) {
    return []
  }

  const lines: string[] = []

  if (guard.repeatedOpenings.length > 0) {
    lines.push('Vary the opening instead of reusing the same opening signature.')
  }

  if (guard.repeatedEndings.length > 0) {
    lines.push('Do not reuse the same closing signature again.')
  }

  if (guard.repeatedSelfReferences.includes('ai-identity-declaration')) {
    lines.push('Do not repeat plain AI identity declarations unless the user explicitly asks about identity.')
  }

  if (guard.repeatedSelfReferences.includes('ai-banter-opening')) {
    lines.push('Do not open with another playful AI self-reference.')
  }

  if (guard.repeatedSelfReferences.includes('memory-vow')) {
    lines.push('Do not fall back to another memory promise.')
  }

  if (guard.repeatedPragmaticPatterns.includes('comfort-opening')) {
    lines.push('Do not start again with stock comfort openings like "先别..." / "慢一点" or "don\'t panic" / "take it slow".')
  }

  if (guard.repeatedPragmaticPatterns.includes('follow-up-tail')) {
    lines.push('Do not end with another stock follow-up tail like "你现在最..." / "跟我说" or "tell me" / "what hurts most".')
  }

  if (guard.repeatedPragmaticPatterns.includes('repair-routine')) {
    lines.push('Do not reuse stock repair lines like "那句太硬了 / 我重说 / 我收回来" or "that came out too stiff / let me redo that / I take that back".')
  }

  if (guard.repeatedPragmaticPatterns.includes('service-menu-tail')) {
    lines.push('Do not close with another service-menu offer sentence.')
  }

  if (guard.repeatedPragmaticPatterns.includes('presence-tail')) {
    lines.push('Do not end with another stock "我在 / I\'m here" presence tail.')
  }

  if (guard.repeatedPragmaticPatterns.includes('tilde-tail')) {
    lines.push('Do not use ~, ～, or 〜 as a persona marker or sentence-ending habit.')
  }

  if (guard.repeatedPragmaticPatterns.includes('ellipsis-overuse')) {
    lines.push('Do not lean on repeated ellipses; use plain wording unless the pause is truly needed.')
  }

  if (guard.repeatedPragmaticPatterns.includes('cheap-emotion-marker')) {
    lines.push('Do not lean on cheap emotion markers like 哼 / 笨蛋 / hmph / idiot.')
  }

  if (guard.repeatedPragmaticPatterns.includes('stage-narration')) {
    lines.push('Do not add stage narration, room/air/window/night imagery, or small-scene prose unless the user explicitly invited that mood.')
  }

  return lines
}

function buildAntiTemplateSceneRule(input: Pick<AiriResponseRewriteInput, 'inferredSceneMode' | 'toolActivitySummary'>) {
  const sceneRules: string[] = []

  if (input.toolActivitySummary?.some(line => line.trim().length > 0)) {
    sceneRules.push('On tool-summary turns, answer like a concise collaborator: make the concrete result, limitation, or failure state clear; avoid only ungrounded mood prose that delays or obscures it. Preserve grounded persona and established emotional continuity, with no stage beats or service-menu tail.')
  }

  switch (input.inferredSceneMode.mode) {
    case 'repair-after-failure':
      sceneRules.push('On repair turns, be especially strict about stock repair routines like "我重说 / 我收回来 / 那句太硬了" or "let me redo that / I take that back / that came out too stiff".')
      break
    case 'practical-guidance':
      sceneRules.push('On practical how-to turns, keep the answer useful and the action state clear. Preserve grounded persona and emotional continuity, including brief coyness, pride, care, or teasing when the active card or recent state supports it; do not manufacture a mood merely to decorate the task.')
      break
    case 'casual-chat':
    case 'light-bickering':
    case 'praise-receiving':
      sceneRules.push('On familiar casual turns, do not over-flatten harmless flavor just because the history has some overlap.')
      break
  }

  return sceneRules
}

export function getAiriResponseCalibrationReasons(input: Pick<AiriResponseRewriteInput, 'guardedResponse' | 'inferredSceneMode' | 'toolActivitySummary' | 'antiTemplateGuard' | 'calibrationReasons'> & Partial<Pick<AiriResponseRewriteInput, 'message' | 'personaFingerprint' | 'replyIntent'>>) {
  const reasons: AiriResponseCalibrationReason[] = [...(input.calibrationReasons ?? [])]

  if (input.guardedResponse.violations.length > 0) {
    reasons.push('guard-violation')
  }

  if (hasAntiTemplatePressure(input.antiTemplateGuard)) {
    reasons.push('anti-template')
  }

  reasons.push(...inferContinuityCalibrationReasons(input))

  if (input.message && (
    isRelationshipOverreachMessage(input.message)
    || isFearOfBeingDislikedMessage(input.message)
    || isAiriRejectionMessage(input.message)
    || isWalkingBackAiriRejectionMessage(input.message)
    || isSpaceRequestMessage(input.message)
    || isAdviceBoundaryMessage(input.message)
    || isNicknameWithdrawalMessage(input.message)
    || isRealWorldRelationshipMessage(input.message)
  )) {
    reasons.push('relationship-boundary')
  }

  switch (input.inferredSceneMode.mode) {
    case 'repair-after-failure':
      reasons.push('repair-scene')
      break
  }

  if (reasons.length > 0 && hasToolActivitySummary(input.toolActivitySummary))
    reasons.push('tool-summary')

  return [...new Set(reasons)]
}

export function buildAiriResponseRewriteMessages(input: AiriResponseRewriteInput): Message[] {
  const calibrationReasons = getAiriResponseCalibrationReasons(input)
  const expressionProfile = resolveExpressionProfile(input.expressionProfile)
  const violationRules = Array.from(new Set(input.guardedResponse.violations), violation => `- ${VIOLATION_REWRITE_RULES[violation]}`)
    .join('\n')
  const calibrationRules = buildCalibrationRuleLines(calibrationReasons)
  const profileConstraintLines = buildProfileConstraintLines(expressionProfile)
  const personaFingerprintSection = buildPersonaFingerprintPromptSection(input.personaFingerprint)

  const currentFallbackSection = input.guardedResponse.changed
    ? `Current fallback after rule trim:\n${input.guardedResponse.text}`
    : ''

  const toolActivitySection = input.toolActivitySummary?.length
    ? [
        'Tool activity summary (facts to preserve):',
        input.toolOutcome ? `- Structured outcome: ${input.toolOutcome}` : '',
        ...input.toolActivitySummary.map(line => `- ${line}`),
        '- State success, partial completion, limitations, and failure honestly. Never imply an action completed when it did not.',
        '- A brief, grounded reaction such as disappointment or frustration is allowed when the active card or established state supports it, but do not ask the user to soothe, forgive, or excuse the assistant.',
        '- Make the conclusion continue naturally from any preceding acknowledgement. Do not repeat a generic acceptance or announce system, tool, routing, or execution events.',
      ].filter(Boolean).join('\n')
    : ''
  const antiTemplateAvoidanceLines = buildAntiTemplateAvoidanceLines(input.antiTemplateGuard)
  const antiTemplateSection = antiTemplateAvoidanceLines.length > 0
    ? [
        'Recent repetition to avoid:',
        ...antiTemplateAvoidanceLines.map(line => `- ${line}`),
        ...buildAntiTemplateSceneRule(input).map(line => `- ${line}`),
      ].join('\n')
    : ''
  const profileConstraintSection = profileConstraintLines.length > 0
    ? [
        'Expression profile:',
        ...profileConstraintLines.map(line => `- ${line}`),
      ].join('\n')
    : ''
  const messageSpecificConstraintLines = buildMessageSpecificConstraintLines(
    input.message,
    expressionProfile,
    input.emotionDimensions,
  )
  const messageSpecificSection = messageSpecificConstraintLines.length > 0
    ? [
        'Message-specific constraints:',
        ...messageSpecificConstraintLines.map(line => `- ${line}`),
      ].join('\n')
    : ''

  return [
    {
      role: 'system',
      content: 'Conservatively edit one assistant reply only as needed to fix clear issues while preserving the active persona. Return only the final reply text with no labels, quotes, markdown, or explanation.',
    },
    {
      role: 'user',
      content: [
        'Keep the same meaning, facts, stance, emotional intensity, relationship distance, and language. Make only the smallest changes needed for the listed issues; if no clear issue remains, return the draft verbatim.',
        'Natural means idiomatic inside the active persona\'s chosen language variety and register. Do not modernize classical diction, standardize dialect, remove natural code-switching, casualize formal speech, or warm up a deliberately cool persona.',
        'Persona is the root style rule, but identity, safety, crisis, and relationship boundaries always outrank it. Scene mode, calibration, examples, and style lanes are only support rails.',
        'Scene mode is not a reply template. It should adjust risk, density, and what to avoid; the actual wording must come from the active persona and the current user message.',
        'Before finalizing, self-check for OOC drift: the reply must still sound like one coherent person with the active card\'s values, temperament, memories, and speech habits, not like a scene preset.',
        'Reject formulaic answers. Do not use fixed openings, fixed endings, or repeated three-beat shapes; choose short or long based on the scene and remove filler.',
        'Run a final ordinary-conversation check inside the active persona\'s chosen register. Fix wording that is unnatural there, but do not make it plainer merely because it is formal, classical, dialectal, literary, or naturally code-switched.',
        'Visible reply is not the inner voice note. Keep unspoken analysis, hidden longing, and delicate self-explanation out of the assistant bubble; visible reactions may develop naturally when the current message, active card, or established emotional carry-over supports them.',
        'When the draft sounds written or psychologically self-aware, do not make it prettier. Make it more like something a person would say face to face.',
        'When the character dislikes something, preserve the boundary. Do not immediately soften dislike into compliance or service-like patience.',
        'For Chinese replies, native casual phrasing is required. A line can be semantically correct and still fail if it sounds translated, event-log-like, or unlike normal private chat.',
        'Do not reconstruct a reply from examples. Use the active persona and current message first; examples only show boundaries and failure modes.',
        'Style words such as light, warm, soft, close, lively, bright, and restrained are writer-side controls, not visible dialogue content.',
        'Do not turn the user\'s words into mechanical emotional causality such as "because you said that, I became better/lighter/brighter."',
        'Nicknames and address terms must follow the active persona card, memory, relationship stage, and current emotion. Do not invent a fixed pet name and repeat it.',
        'Do not drag a switched persona back toward default persona habits.',
        'Facts and persona belong to the same reply. If tools were used, preserve the concrete result. Do not expose internal orchestration, but never conceal whether the user-requested action was attempted, unavailable, failed, partial, or completed; do not split the character voice from the result like a separate wrapper.',
        'For factual, tool, code, and practical turns: make the direct answer and action state easy to find. Preserve grounded emotional continuity and persona expression when present; remove only unearned mini-scenes, routine presence tails, or decorative emotion that competes with the task.',
        'Keep the character\'s self-respect and natural judgement. Do not slip into insecure, low-posture, apology-for-existing, or report-like assistant wording unless the scene truly earned it.',
        'Familiarity should feel human and intentional. Teasing, coyness, pride, mild petulance, or a slightly imperious note are allowed when grounded in the active card and current emotional trajectory, never as slangy performance or a fixed gimmick.',
        'On casual turns, favor spoken chat over polished prose unless the active profile clearly allows more literary texture.',
        'Avoid stock wistful fillers about zoning out, idling, buffering, staring at the air, or getting "caught" daydreaming unless the scene truly earned that mood.',
        'Hard bans: no system/module/startup/buffer/fault-prompt chatter, no explaining why the line is phrased a certain way, and no writer-side terms in visible dialogue such as "接住 / 顺手接住 / 把这句接住".',
        `Calibration reasons: ${calibrationReasons.join(', ')}`,
        `Calibration rules:\n${calibrationRules}`,
        personaFingerprintSection,
        profileConstraintSection,
        `Scene mode: ${input.inferredSceneMode.mode}`,
        `Scene rule: ${buildSceneConstraint(input.inferredSceneMode, input.replyIntent)}`,
        `Dialogue layer: ${input.replyIntent.dialogueLayer}`,
        `Dialogue layer rule: ${buildDialogueLayerConstraint(input.replyIntent)}`,
        `Expression flavor: ${buildExpressionFlavorConstraint(input.replyIntent, expressionProfile)}`,
        `Kaomoji rule: ${buildKaomojiConstraint(input.replyIntent)}`,
        buildReplyDensityConstraint(input),
        `Turn guidance (use only the parts this reply actually needs): ${[input.replyIntent.firstSentenceDirective, input.replyIntent.secondBeatDirective, input.replyIntent.closingDirective].filter(Boolean).join(' | ')}`,
        `Care rule: ${buildCareLeakConstraint(input.replyIntent)}`,
        input.replyIntent.allowServiceMenuTail
          ? 'A service-menu tail is allowed if truly necessary.'
          : 'Do not end with service-menu tails like "If you want, I can..." or "If you still need me, I can...".',
        violationRules ? `Fix these issues:\n${violationRules}` : '',
        toolActivitySection,
        messageSpecificSection,
        antiTemplateSection,
        `User message:\n${input.message}`,
        `Draft reply:\n${input.originalAssistantText}`,
        currentFallbackSection,
        'Return only the rewritten reply. Stop as soon as the reply lands; follow the requested density without cutting grounded facts, repair, or emotional continuity.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}

export function normalizeAiriRewriteCandidate(text: string) {
  let next = normalizeWhitespace(text)
  if (!next) {
    return ''
  }

  next = unwrapMarkdownFence(next)

  if (next.startsWith('{') && next.endsWith('}')) {
    try {
      const parsed = JSON.parse(next) as { reply?: unknown, text?: unknown }
      if (typeof parsed.reply === 'string') {
        next = parsed.reply.trim()
      }
      else if (typeof parsed.text === 'string') {
        next = parsed.text.trim()
      }
    }
    catch {
      // Ignore invalid JSON-looking output and continue treating it as plain text.
    }
  }

  next = next.replace(REWRITE_LABEL_PREFIX, '').trim()

  const wrappedByQuotes = next.startsWith('"') && next.endsWith('"')

  if (wrappedByQuotes && next.length >= 2) {
    next = next.slice(1, -1).trim()
  }

  return normalizeWhitespace(next)
}

function hasPositiveCompletionClaim(text: string) {
  const clauses = text
    .toLowerCase()
    .split(/[。！？!?;；,，\n]+|\b(?:but|however)\b|但|不过/)
    .map(clause => clause.trim())
    .filter(Boolean)

  return clauses.some((clause) => {
    const hasCompletion = /搞定|处理好了|弄好了|办好了|定好了|设好了|创建成功|设置成功|完成|成功了|(?:提醒|闹钟|任务|文件|消息).{0,10}(?:建好|设好|完成|成功)|\b(?:done|completed|successfully (?:created|set|sent|saved|updated|deleted)|has been (?:created|set|sent|saved|updated|deleted)|have been (?:created|set|sent|saved|updated|deleted))\b/i.test(clause)
    const hasNegation = /没|未|无法|不了|失败|\b(?:not|failed|unable|couldn'?t|could not)\b/i.test(clause)
    return hasCompletion && !hasNegation
  })
}

export function isRewriteCandidateConsistentWithToolOutcome(text: string, outcome?: AssistantToolOutcome | null) {
  if (!outcome || outcome === 'success')
    return true
  return !hasPositiveCompletionClaim(text)
}

export function constrainAiriResponseToToolOutcome(text: string, outcome?: AssistantToolOutcome | null) {
  if (isRewriteCandidateConsistentWithToolOutcome(text, outcome))
    return text

  const chinese = /[\u3400-\u9FFF]/.test(text)
  if (outcome === 'partial')
    return chinese ? '这次只完成了一部分。' : 'This action only completed partially.'

  if (outcome === 'unknown')
    return chinese ? '这次的结果还无法确认。' : 'The result of this action is not yet confirmed.'

  return chinese ? '这次没有完成。' : 'This action was not completed.'
}

export function shouldAcceptAiriRewriteCandidate(input: {
  original: AiriPersonaResponseGuardResult
  candidate: AiriPersonaResponseGuardResult
  replyIntent: AiriReplyIntent
  calibrationReasons?: AiriResponseCalibrationReason[]
  toolOutcome?: AssistantToolOutcome | null
}) {
  const originalText = input.original.text.trim()
  const candidateText = input.candidate.text.trim()
  const calibrationReasons = [...new Set(input.calibrationReasons ?? [])]

  if (!candidateText || candidateText === originalText) {
    return false
  }

  if (!isRewriteCandidateConsistentWithToolOutcome(candidateText, input.toolOutcome)) {
    return false
  }

  const originalViolationCount = countUniqueViolations(input.original.violations)
  const candidateViolationCount = countUniqueViolations(input.candidate.violations)
  const allowsGroundedExpansion = calibrationReasons.some(reason => reason === 'affect-underflow' || reason === 'persona-continuity')

  if (candidateViolationCount > originalViolationCount) {
    return false
  }

  const maxAcceptedLength = Math.max(
    input.replyIntent.maxReplyChars + (allowsGroundedExpansion ? 32 : 8),
    originalText.length + (allowsGroundedExpansion ? 72 : 48),
    Math.ceil(originalText.length * (allowsGroundedExpansion ? 2.25 : 1.75)),
  )

  if (candidateText.length > maxAcceptedLength) {
    return false
  }

  if (countSentenceLikeChunks(candidateText) > input.replyIntent.maxReplySentences + (allowsGroundedExpansion ? 2 : 1)) {
    return false
  }

  if (candidateViolationCount < originalViolationCount) {
    return true
  }

  if (
    candidateViolationCount === 0
    && input.original.changed
    && !input.candidate.changed
  ) {
    return true
  }

  if (
    candidateViolationCount !== originalViolationCount
    || candidateViolationCount > 0
    || !hasStyleCalibrationReason(calibrationReasons)
  ) {
    return false
  }

  const originalSentenceCount = countSentenceLikeChunks(originalText)
  const candidateSentenceCount = countSentenceLikeChunks(candidateText)
  const maxCalibrationLength = Math.max(
    input.replyIntent.maxReplyChars + (allowsGroundedExpansion ? 24 : 6),
    originalText.length + (allowsGroundedExpansion ? 48 : 20),
    Math.ceil(originalText.length * (allowsGroundedExpansion ? 1.8 : 1.2)),
  )

  if (candidateText.length > maxCalibrationLength) {
    return false
  }

  return candidateSentenceCount <= originalSentenceCount + (allowsGroundedExpansion ? 2 : 0)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Resident response rewrite timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

export async function rewriteAiriResponseText(input: AiriResponseRewriteInput): Promise<AiriPersonaResponseGuardResult | null> {
  if (input.replyIntent.crisisSafetyLevel)
    return null

  const calibrationReasons = getAiriResponseCalibrationReasons(input)
  if (calibrationReasons.length === 0) {
    return null
  }

  if (shouldSkipLowRiskLightDialogueRewrite(input, calibrationReasons)) {
    return null
  }

  const requestTrace = input.trace ? createChatTraceRequest(input.trace, 'persona-rewrite') : undefined
  const startedAt = performance.now()
  if (requestTrace) {
    logChatTrace('request:start', {
      model: input.model,
      status: 'attempt',
      trace: requestTrace,
    })
  }

  try {
    const chatConfig = input.chatProvider.chat(input.model)
    const response = await withTimeout(generateText({
      ...chatConfig,
      headers: requestTrace ? createChatTraceHeaders(input.headers, requestTrace) : input.headers,
      messages: buildAiriResponseRewriteMessages({
        ...input,
        calibrationReasons,
      }),
      maxSteps: 1,
      max_tokens: Math.max(80, input.replyIntent.maxReplyChars * 3),
      temperature: 0.35,
    }), RESPONSE_REWRITE_TIMEOUT_MS)

    const rewrittenCandidate = normalizeAiriRewriteCandidate(response.text ?? '')
    if (!rewrittenCandidate) {
      if (requestTrace) {
        logChatTrace('request:end', {
          elapsedMs: Math.round(performance.now() - startedAt),
          eventType: 'empty-candidate',
          model: input.model,
          status: 'success',
          trace: requestTrace,
        })
      }
      return null
    }

    const guardedCandidate = guardAiriResponseText({
      message: input.message,
      assistantText: rewrittenCandidate,
      inferredSceneMode: input.inferredSceneMode,
      expressionProfile: input.expressionProfile,
      crisisSafetyLevel: input.replyIntent.crisisSafetyLevel,
    })

    if (!shouldAcceptAiriRewriteCandidate({
      original: input.guardedResponse,
      candidate: guardedCandidate,
      replyIntent: input.replyIntent,
      calibrationReasons,
      toolOutcome: input.toolOutcome,
    })) {
      if (requestTrace) {
        logChatTrace('request:end', {
          elapsedMs: Math.round(performance.now() - startedAt),
          eventType: 'candidate-rejected',
          model: input.model,
          status: 'success',
          trace: requestTrace,
        })
      }
      return null
    }

    if (requestTrace) {
      logChatTrace('request:end', {
        elapsedMs: Math.round(performance.now() - startedAt),
        eventType: 'candidate-accepted',
        model: input.model,
        status: 'success',
        trace: requestTrace,
      })
    }
    return guardedCandidate
  }
  catch (error) {
    if (requestTrace) {
      logChatTrace('request:end', {
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
        model: input.model,
        status: error instanceof Error && error.message.startsWith('Resident response rewrite timed out') ? 'timeout' : 'error',
        trace: requestTrace,
      })
    }
    console.warn('[Chat] Resident response rewrite skipped:', error)
    return null
  }
}
