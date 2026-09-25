import type {
  AiriReplyFeedbackMemorySummary,
  AiriReplyFeedbackRecord,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { replyFeedbackRepo } from '../../database/repos/reply-feedback.repo'

type FeedbackPrincipleKey
  = 'natural-phrasing'
    | 'persona-consistency'
    | 'concise'
    | 'answer-first'
    | 'emotional-attunement'
    | 'self-respecting-boundary'
    | 'inner-voice-separation'
    | 'no-forced-follow-up'
    | 'restrained-literary'
    | 'gentle-warmth'

interface FeedbackPrincipleDefinition {
  key: FeedbackPrincipleKey
  line: string
  priority: number
  preferredStyle?: string
  avoidPattern?: string
  answeringBias?: string
  emotionalCue?: string
  likePatterns?: RegExp[]
  dislikePatterns?: RegExp[]
}

interface FeedbackPrincipleScore {
  key: FeedbackPrincipleKey
  line: string
  priority: number
  score: number
  evidenceCount: number
  sourceFeedbackIds: Set<string>
}

export const REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION = 4
export const DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_RECORDS = 40
export const DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_PRINCIPLES = 4
const SHORT_REPLY_PREVIEW_LENGTH = 88
const LONG_REPLY_PREVIEW_LENGTH = 220
const NOTE_SIGNAL_WEIGHT = 1.5
const LENGTH_SIGNAL_WEIGHT = 1
const ASSISTANT_REPLY_SIGNAL_WEIGHT = 1
const MIN_PRINCIPLE_SCORE = 1.2
const MIN_LENGTH_SUPPORT_SCORE = 1.2

const FEEDBACK_PRINCIPLES: FeedbackPrincipleDefinition[] = [
  {
    key: 'natural-phrasing',
    line: 'Prefer native, everyday phrasing. Avoid translation-like, overly formal, or templated wording.',
    priority: 90,
    preferredStyle: 'Use native, everyday phrasing that sounds natural in the current language.',
    avoidPattern: 'Avoid translation-like, overly formal, robotic, or templated wording.',
    likePatterns: [
      /自然/,
      /顺口/,
      /口语/,
      /像人说话/,
      /不模板/,
      /不机械/,
      /native/,
      /natural/,
      /not templated/,
    ],
    dislikePatterns: [
      /模板/,
      /套话/,
      /公式/,
      /机械/,
      /翻译腔/,
      /书面/,
      /官腔/,
      /太正式/,
      /太官方/,
      /不像聊天/,
      /不生活/,
      /不自然/,
      /太深刻/,
      /上价值/,
      /robotic/,
      /stiff/,
      /translation/,
      /templated/,
      /too formal/i,
    ],
  },
  {
    key: 'persona-consistency',
    line: 'Stay inside the active persona instead of sounding like a generic assistant or service agent.',
    priority: 85,
    preferredStyle: 'Keep the active persona voice intact instead of drifting into generic assistant speech.',
    avoidPattern: 'Avoid service-agent phrasing or replies that feel out of character.',
    likePatterns: [
      /像airi/i,
      /像她/,
      /有角色感/,
      /有那种感觉/,
      /in character/,
    ],
    dislikePatterns: [
      /不像airi/i,
      /不像她/,
      /\booc\b/i,
      /出戏/,
      /像助手/,
      /像客服/,
      /客服腔/,
      /generic assistant/i,
      /service agent/i,
    ],
  },
  {
    key: 'concise',
    line: 'When the turn is light or straightforward, get to the point and avoid stretching a simple reply into extra filler.',
    priority: 80,
    preferredStyle: 'Keep light or straightforward turns compact and efficient.',
    avoidPattern: 'Avoid padding simple replies with extra filler or ornamental wording.',
    answeringBias: 'Prefer short, efficient replies when the turn is simple.',
    likePatterns: [
      /简短/,
      /简洁/,
      /刚好/,
      /干脆/,
      /利落/,
      /不拖/,
      /short/,
      /brief/,
      /concise/,
    ],
    dislikePatterns: [
      /太长/,
      /啰嗦/,
      /废话/,
      /拖沓/,
      /绕/,
      /铺垫太多/,
      /too long/,
      /wordy/,
      /rambling/,
      /long-winded/,
    ],
  },
  {
    key: 'answer-first',
    line: 'For concrete questions or requests, answer first before adding framing or ornament.',
    priority: 75,
    avoidPattern: 'Avoid burying the direct answer under preambles or vague framing.',
    answeringBias: 'For concrete requests, answer first and add framing only after the answer lands.',
    likePatterns: [
      /先回答/,
      /直接回答/,
      /先说重点/,
      /先给答案/,
      /answer first/i,
      /straight to the point/i,
      /clear answer/i,
    ],
    dislikePatterns: [
      /没回答/,
      /不回答/,
      /绕开/,
      /答非所问/,
      /空话/,
      /没重点/,
      /上价值/,
      /大道理/,
      /说教/,
      /didn'?t answer/i,
      /dodged/i,
      /buried/i,
    ],
  },
  {
    key: 'emotional-attunement',
    line: 'When the user is emotional, acknowledge the feeling before shifting into advice, analysis, or a new topic.',
    priority: 70,
    avoidPattern: 'Avoid sounding cold, dismissive, or analytical too early when emotion is on the surface.',
    emotionalCue: 'Acknowledge the feeling before moving into advice, analysis, or a topic shift.',
    likePatterns: [
      /接住/,
      /懂我/,
      /共情/,
      /被理解/,
      /安慰到/,
      /温柔/,
      /照顾感/,
      /felt seen/i,
      /understood/i,
      /empathetic/i,
    ],
    dislikePatterns: [
      /没接住/,
      /没懂/,
      /不共情/,
      /太冷/,
      /敷衍/,
      /没安慰到/,
      /dismissive/i,
      /cold/i,
      /missed the feeling/i,
    ],
  },
  {
    key: 'self-respecting-boundary',
    line: 'Preserve the character\'s self-respect: dislike, discomfort, or refusal should not immediately soften into compliance.',
    priority: 72,
    preferredStyle: 'Let the character keep a soft but real boundary when something feels uncomfortable.',
    avoidPattern: 'Avoid turning dislike, discomfort, or refusal into immediate obedience, service-like patience, or low-posture apology.',
    emotionalCue: 'When hurt or uncomfortable, keep the spoken line short and self-respecting before offering any bridge back.',
    likePatterns: [
      /有边界/,
      /有脾气/,
      /会反驳/,
      /不顺从/,
      /不低姿态/,
      /有自己判断/,
      /不喜欢就不喜欢/,
      /self-respect/i,
      /has boundaries/i,
      /push(?:es)? back/i,
    ],
    dislikePatterns: [
      /太顺从/,
      /过度顺从/,
      /立刻顺从/,
      /没边界/,
      /没有边界/,
      /太低姿态/,
      /太卑微/,
      /没脾气/,
      /马上圆回来/,
      /不喜欢.*还愿意/,
      /不舒服.*还愿意/,
      /too compliant/i,
      /too submissive/i,
      /no boundary/i,
      /low posture/i,
    ],
  },
  {
    key: 'inner-voice-separation',
    line: 'Keep hidden conflict, bashfulness, and delicate self-explanation in the inner voice note instead of the visible reply.',
    priority: 68,
    avoidPattern: 'Avoid visible inner monologue, writer-side craft terms, emotional algebra, or explanations of where care should go.',
    emotionalCue: 'Visible replies should show only one small spoken reaction; deeper hesitation belongs in the inner voice note.',
    likePatterns: [
      /心声/,
      /内心/,
      /留白/,
      /别说满/,
      /不把内心说出来/,
      /inner voice/i,
      /subtext/i,
    ],
    dislikePatterns: [
      /内心说明/,
      /心理说明/,
      /情绪说明/,
      /心声外泄/,
      /把内心说出来/,
      /过度解释/,
      /解释太多/,
      /不知道.*关心.*放/,
      /没接住/,
      /接住/,
      /小窗口/,
      /inner monologue/i,
      /too self-aware/i,
      /over-explain/i,
    ],
  },
  {
    key: 'no-forced-follow-up',
    line: 'Do not force a follow-up question when the reply already lands.',
    priority: 65,
    avoidPattern: 'Avoid automatic follow-up questions after a reply already feels complete.',
    answeringBias: 'Only ask a follow-up question when it adds real value or missing context.',
    likePatterns: [
      /不追问/,
      /没有追问/,
      /不反问/,
      /收得住/,
      /doesn'?t keep asking/i,
    ],
    dislikePatterns: [
      /别问/,
      /别反问/,
      /别追问/,
      /不要老问/,
      /别连续问/,
      /too many questions/i,
      /stop asking/i,
    ],
  },
  {
    key: 'restrained-literary',
    line: 'Keep any literary or metaphorical flavor restrained and earned by the moment.',
    priority: 60,
    preferredStyle: 'Keep literary or metaphorical flavor restrained and situational.',
    avoidPattern: 'Avoid purple prose or dramatic metaphors unless the moment clearly invites it.',
    likePatterns: [
      /有点文气/,
      /克制/,
      /轻一点的文气/,
      /restrained/i,
    ],
    dislikePatterns: [
      /太文艺/,
      /太诗/,
      /太隐喻/,
      /太矫情/,
      /文绉绉/,
      /像作文/,
      /太深刻/,
      /上价值/,
      /大道理/,
      /说教/,
      /too poetic/i,
      /purple prose/i,
      /dramatic metaphor/i,
    ],
  },
  {
    key: 'gentle-warmth',
    line: 'Keep warmth personal and gentle instead of flat, harsh, or transactional.',
    priority: 55,
    preferredStyle: 'Keep warmth personal, light, and gentle.',
    avoidPattern: 'Avoid harsh, flat, or transactional tone.',
    emotionalCue: 'When warmth fits, keep it soft and personal rather than procedural.',
    likePatterns: [
      /温柔/,
      /柔和/,
      /亲近/,
      /陪伴感/,
      /暖/,
      /gentle/i,
      /warm/i,
    ],
    dislikePatterns: [
      /太冷/,
      /太硬/,
      /太凶/,
      /像办事/,
      /transactional/i,
      /harsh/i,
    ],
  },
]

const ASSISTANT_REPLY_DISLIKE_PATTERNS: Array<{
  key: FeedbackPrincipleKey
  patterns: RegExp[]
}> = [
  {
    key: 'natural-phrasing',
    patterns: [
      /作为(?:一个|一名)?\s*AI/i,
      /作为(?:一个|一名)?(?:人工智能|语言模型)/,
      /很高兴为您服务/,
      /感谢您的反馈/,
      /希望以上.*帮助/,
      /如果你(?:愿意|需要)[，,]?\s*我可以/,
      /当然可以[，,]\s*(?:以下|我将|让我)/,
      /首先[\s\S]{0,120}其次[\s\S]{0,120}(?:最后|总之|总结)/,
      /as an ai/i,
      /as a language model/i,
      /happy to help/i,
      /thank you for your feedback/i,
      /if you (?:want|need),? i can/i,
    ],
  },
  {
    key: 'persona-consistency',
    patterns: [
      /作为(?:一个|一名)?\s*AI/i,
      /作为(?:一个|一名)?(?:人工智能|语言模型)/,
      /很高兴为您服务/,
      /感谢您的反馈/,
      /像客服/,
      /as an ai/i,
      /as a language model/i,
      /customer support/i,
      /service agent/i,
    ],
  },
  {
    key: 'answer-first',
    patterns: [
      /首先[\s\S]{0,120}其次[\s\S]{0,120}(?:最后|总之|总结)/,
      /从(?:本质|根本|深层)上来说/,
      /这其实(?:反映|说明|意味着)/,
      /in conclusion/i,
      /from a deeper perspective/i,
    ],
  },
  {
    key: 'self-respecting-boundary',
    patterns: [
      /不喜欢[\s\S]{0,40}(?:但|不过)[\s\S]{0,40}(?:还愿意|可以听|愿意听|没关系)/,
      /不舒服[\s\S]{0,40}(?:但|不过)[\s\S]{0,40}(?:还愿意|可以听|愿意听|没关系)/,
      /不太想[\s\S]{0,40}(?:但|不过)[\s\S]{0,40}(?:可以|愿意|没关系)/,
      /i don'?t like[\s\S]{0,80}(?:but|though)[\s\S]{0,80}(?:willing|still want|can listen|it'?s okay)/i,
    ],
  },
  {
    key: 'inner-voice-separation',
    patterns: [
      /不知道[\s\S]{0,24}关心[\s\S]{0,16}放/,
      /没接住/,
      /顺手接住/,
      /把这句接住/,
      /脑子[\s\S]{0,12}小窗口/,
      /我会记住这一点/,
      /被叫回来了/,
      /\bi don'?t know where to put\b/i,
      /\bi didn'?t know how to receive\b/i,
      /\bi'?ll remember that\b/i,
    ],
  },
]

function normalizeSearchText(value?: string) {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function buildRecordSearchText(record: AiriReplyFeedbackRecord) {
  return normalizeSearchText([
    record.userNote,
    ...(record.tags || []),
  ]
    .filter(Boolean)
    .join(' '))
}

function getRecencyWeight(index: number) {
  if (index < 5)
    return 1.4
  if (index < 15)
    return 1.1
  if (index < 25)
    return 0.9
  return 0.75
}

function matchesAny(text: string, patterns?: RegExp[]) {
  return Boolean(text) && Boolean(patterns?.some(pattern => pattern.test(text)))
}

function ensurePrincipleScore(
  scores: Map<FeedbackPrincipleKey, FeedbackPrincipleScore>,
  definition: FeedbackPrincipleDefinition,
) {
  const existing = scores.get(definition.key)
  if (existing)
    return existing

  const created: FeedbackPrincipleScore = {
    key: definition.key,
    line: definition.line,
    priority: definition.priority,
    score: 0,
    evidenceCount: 0,
    sourceFeedbackIds: new Set<string>(),
  }
  scores.set(definition.key, created)
  return created
}

function addPrincipleEvidence(
  scores: Map<FeedbackPrincipleKey, FeedbackPrincipleScore>,
  definition: FeedbackPrincipleDefinition,
  input: {
    feedbackId: string
    weight: number
  },
) {
  const entry = ensurePrincipleScore(scores, definition)
  entry.score += input.weight
  entry.evidenceCount += 1
  entry.sourceFeedbackIds.add(input.feedbackId)
}

function roundConfidence(value: number) {
  return Number(Math.max(0, Math.min(0.95, value)).toFixed(2))
}

function addLengthBasedConciseEvidence(
  scores: Map<FeedbackPrincipleKey, FeedbackPrincipleScore>,
  records: AiriReplyFeedbackRecord[],
) {
  const conciseDefinition = FEEDBACK_PRINCIPLES.find(definition => definition.key === 'concise')
  if (!conciseDefinition)
    return

  let supportingScore = 0
  let counterScore = 0
  const sourceFeedbackIds = new Set<string>()

  records.forEach((record, index) => {
    const weight = LENGTH_SIGNAL_WEIGHT * getRecencyWeight(index)
    const previewLength = record.assistantReplyPreview.trim().length

    if (record.rating === 'up' && previewLength > 0 && previewLength <= SHORT_REPLY_PREVIEW_LENGTH) {
      supportingScore += weight
      sourceFeedbackIds.add(record.id)
    }

    if (record.rating === 'down' && previewLength >= LONG_REPLY_PREVIEW_LENGTH) {
      supportingScore += weight
      sourceFeedbackIds.add(record.id)
    }

    if (record.rating === 'up' && previewLength >= LONG_REPLY_PREVIEW_LENGTH) {
      counterScore += weight
    }

    if (record.rating === 'down' && previewLength > 0 && previewLength <= SHORT_REPLY_PREVIEW_LENGTH) {
      counterScore += weight
    }
  })

  const netScore = supportingScore - counterScore
  if (supportingScore < MIN_LENGTH_SUPPORT_SCORE || netScore < 1)
    return

  const entry = ensurePrincipleScore(scores, conciseDefinition)
  entry.score += netScore
  entry.evidenceCount += Math.max(1, sourceFeedbackIds.size)
  sourceFeedbackIds.forEach(feedbackId => entry.sourceFeedbackIds.add(feedbackId))
}

function addAssistantReplyDislikeEvidence(
  scores: Map<FeedbackPrincipleKey, FeedbackPrincipleScore>,
  records: AiriReplyFeedbackRecord[],
) {
  records.forEach((record, index) => {
    if (record.rating !== 'down')
      return

    const assistantReply = normalizeSearchText(record.assistantReplyPreview)
    if (!assistantReply)
      return

    const weight = ASSISTANT_REPLY_SIGNAL_WEIGHT * getRecencyWeight(index)

    ASSISTANT_REPLY_DISLIKE_PATTERNS.forEach((rule) => {
      if (!matchesAny(assistantReply, rule.patterns))
        return

      const definition = FEEDBACK_PRINCIPLES.find(candidate => candidate.key === rule.key)
      if (!definition)
        return

      addPrincipleEvidence(scores, definition, {
        feedbackId: record.id,
        weight,
      })
    })
  })
}

function selectPrinciples(
  scores: Map<FeedbackPrincipleKey, FeedbackPrincipleScore>,
  maxPrinciples: number,
) {
  return [...scores.values()]
    .filter(score => score.score >= MIN_PRINCIPLE_SCORE)
    .sort((left, right) => {
      if (right.score !== left.score)
        return right.score - left.score
      if (right.evidenceCount !== left.evidenceCount)
        return right.evidenceCount - left.evidenceCount
      return right.priority - left.priority
    })
    .slice(0, maxPrinciples)
}

function uniqueLines(lines: Array<string | undefined>) {
  return Array.from(new Set(lines.filter((line): line is string => Boolean(line))))
}

export function buildReplyFeedbackMemorySummary(input: {
  scope: AiriReplyFeedbackScope
  records: AiriReplyFeedbackRecord[]
  maxPrinciples?: number
}): AiriReplyFeedbackMemorySummary | null {
  const activeRecords = input.records
    .filter(record => !record.disabledAt && !record.deletedAt)
    .sort((left, right) => right.updatedAt - left.updatedAt)

  if (activeRecords.length === 0)
    return null

  const scores = new Map<FeedbackPrincipleKey, FeedbackPrincipleScore>()

  activeRecords.forEach((record, index) => {
    const searchText = buildRecordSearchText(record)
    if (!searchText)
      return

    const weight = NOTE_SIGNAL_WEIGHT * getRecencyWeight(index)

    for (const definition of FEEDBACK_PRINCIPLES) {
      const likedSignal = record.rating === 'up' && matchesAny(searchText, definition.likePatterns)
      const dislikedSignal = record.rating === 'down' && matchesAny(searchText, definition.dislikePatterns)
      if (!likedSignal && !dislikedSignal)
        continue

      addPrincipleEvidence(scores, definition, {
        feedbackId: record.id,
        weight,
      })
    }
  })

  addLengthBasedConciseEvidence(scores, activeRecords)
  addAssistantReplyDislikeEvidence(scores, activeRecords)

  const selectedPrinciples = selectPrinciples(scores, input.maxPrinciples ?? DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_PRINCIPLES)
  if (selectedPrinciples.length === 0)
    return null

  const recordCount = activeRecords.length
  const totalScore = selectedPrinciples.reduce((sum, principle) => sum + principle.score, 0)
  const sourceFeedbackIds = Array.from(new Set(selectedPrinciples
    .flatMap(principle => [...principle.sourceFeedbackIds])))
  const selectedDefinitions = selectedPrinciples
    .map(principle => FEEDBACK_PRINCIPLES.find(definition => definition.key === principle.key))
    .filter((definition): definition is FeedbackPrincipleDefinition => Boolean(definition))

  return {
    ...input.scope,
    schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    recordCount,
    sourceFeedbackIds,
    principles: selectedPrinciples.map(principle => principle.line),
    preferredStyles: uniqueLines(selectedDefinitions.map(definition => definition.preferredStyle)),
    avoidPatterns: uniqueLines(selectedDefinitions.map(definition => definition.avoidPattern)),
    answeringBiases: uniqueLines(selectedDefinitions.map(definition => definition.answeringBias)),
    emotionalCues: uniqueLines(selectedDefinitions.map(definition => definition.emotionalCue)),
    confidence: roundConfidence(0.18 + (Math.min(recordCount, 8) * 0.05) + (Math.min(totalScore, 8) * 0.06)),
    generatedAt: Date.now(),
  }
}

export async function loadReplyFeedbackMemorySummary(
  scope: AiriReplyFeedbackScope,
  options?: {
    maxRecords?: number
    maxPrinciples?: number
  },
) {
  const records = await replyFeedbackRepo.listRecords(scope, {
    limit: options?.maxRecords ?? DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_RECORDS,
    includeDisabled: false,
  })

  return buildReplyFeedbackMemorySummary({
    scope,
    records,
    maxPrinciples: options?.maxPrinciples ?? DEFAULT_REPLY_FEEDBACK_MEMORY_MAX_PRINCIPLES,
  })
}
