import type { CommonContentPart } from '@xsai/shared-chat'

import type { ChatHistoryItem } from '../../types/chat'
import type { AiriSceneMode } from './persona-scene-mode'

export interface AiriAntiTemplateGuard {
  repeatedOpenings: string[]
  repeatedEndings: string[]
  repeatedSelfReferences: string[]
  repeatedPragmaticPatterns: string[]
}

type PragmaticPatternLabel
  = 'comfort-opening'
    | 'follow-up-tail'
    | 'repair-routine'
    | 'service-menu-tail'
    | 'presence-tail'
    | 'tilde-tail'
    | 'ellipsis-overuse'
    | 'cheap-emotion-marker'
    | 'stage-narration'

type SelfReferenceLabel
  = 'ai-identity-declaration'
    | 'ai-banter-opening'
    | 'memory-vow'

const COMFORT_OPENING_PATTERNS = [
  /^(?:(?:先|你先)(?:别(?:慌|乱来|硬撑)?|不急|缓一下|缓缓|稳住|抱一下|抱抱|深呼吸)|慢一点)/,
  /^(?:(?:just\s+)?(?:don't|do not)\s+(?:panic|spiral|force it|push yourself|rush)|take it slow|slow down|breathe|it'?s okay)/i,
]

const FOLLOW_UP_TAIL_PATTERNS = [
  /你呢$/,
  /怎么样$/,
  /好不好$/,
  /行不行$/,
  /要不要先?/,
  /告诉我/,
  /跟我说/,
  /说说看?$/,
  /现在最/,
  /你现在最/,
  /what about you$/i,
  /tell me$/i,
  /talk to me$/i,
  /say more$/i,
  /right now$/i,
  /what hurts most$/i,
]

const REPAIR_ROUTINE_PATTERNS = [
  /那句太硬了/,
  /我重说/,
  /我重新说/,
  /我换个说法/,
  /我改一下说法/,
  /我收回来/,
  /不是那个意思/,
  /我的意思是/,
  /that came out too stiff/i,
  /let me redo that/i,
  /let me rephrase/i,
  /i take that back/i,
  /that'?s not what i meant/i,
  /what i mean is/i,
]

const PRESENCE_TAIL_PATTERNS = [
  /^(?:嗯[,，]?\s*)?我在$/,
  /我(?:还|一直)?在(?:这里|这儿)?$/,
  /^……我在$/,
  /^\.\.\.我在$/,
  /^(?:yeah[,，]?\s*)?i['’]?m here$/i,
  /i['’]?m still here$/i,
  /i['’]?m right here$/i,
  /^(?:\.\.\.|…{2,})\s*i['’]?m here$/i,
]

const TILDE_TAIL_PATTERNS = [
  /[~～〜]+$/,
]

const ELLIPSIS_OVERUSE_PATTERNS = [
  /(?:…{2,}|\.{3,})/,
]

const CHEAP_EMOTION_MARKER_PATTERNS = [
  /(?:^|[\s,.!?，。！？…])哼(?:$|[\s,.!?，。！？…])/,
  /笨蛋/,
  /(?:^|[\s,.!?])hmph(?:$|[\s,.!?])/i,
  /idiot/i,
]

const STAGE_NARRATION_PATTERNS = [
  /(?:空气|房间|窗边|夜色|灯光|风声|雨声|安静了[一点些]?|热闹了[一点些]?|像(?:旁白|小剧场))/,
  /(?:the air|the room|by the window|night air|lights?|wind|rain|like a tiny scene|as if narrating)/i,
]

const PRAGMATIC_PATTERN_THRESHOLDS: Record<PragmaticPatternLabel, number> = {
  'comfort-opening': 2,
  'follow-up-tail': 2,
  'repair-routine': 2,
  'service-menu-tail': 2,
  'presence-tail': 1,
  'tilde-tail': 2,
  'ellipsis-overuse': 2,
  'cheap-emotion-marker': 2,
  'stage-narration': 1,
}

const GENERIC_SIGNATURE_THRESHOLD = 2

function extractTextFromContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && 'type' in part) {
          const typedPart = part as CommonContentPart
          if (typedPart.type === 'text') {
            return typedPart.text ?? ''
          }
        }

        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

function normalizeText(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[“”"'`]/g, '')
    .trim()
}

function truncateSignature(text: string, maxLength: number) {
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function splitClauses(text: string) {
  return normalizeText(text)
    .split(/[.!?\u3002\uFF01\uFF1F\n]/)
    .map(part => part.trim())
    .filter(Boolean)
}

function extractOpeningClause(text: string) {
  return splitClauses(text)[0] ?? ''
}

function extractEndingClause(text: string) {
  const clauses = splitClauses(text)
  return (clauses.at(-1) ?? '')
    .replace(/^[.…~～〜]+/g, '')
    .trim()
}

function extractOpeningSignature(text: string) {
  return truncateSignature(extractOpeningClause(text), 14)
}

function extractEndingSignature(text: string) {
  return truncateSignature(extractEndingClause(text), 14)
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(text))
}

function getRepeatedValues(values: string[], minOccurrences = 2) {
  const counts = countValues(values)
  return [...counts.entries()]
    .filter(([, count]) => count >= minOccurrences)
    .map(([value]) => value)
    .slice(0, 4)
}

function countValues(values: string[]) {
  const counts = new Map<string, number>()

  for (const value of values) {
    if (!value || value.length < 2) {
      continue
    }

    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return counts
}

function isServiceMenuTail(text: string) {
  const hasLead = /如果|要是|你如果|你要是|还需要|还想|需要的话|有需要|告诉我|跟我说|if you (?:still )?(?:need|want)|let me know/i.test(text)
  const hasAction = /(?:我可以|我能|我会).{0,12}(?:继续|陪你|帮你|和你一起|接着|看看|聊|理)|i can.{0,24}(?:continue|keep going|stay with you|help|walk through(?: it)?(?: with you)?|talk (?:it|this) through(?: with you)?|keep talking)/i.test(text)
  const hasBareTail = /(?:需要的话|有问题|卡住了|还想继续|想继续|要继续).{0,8}(?:直接)?(?:叫我|找我|说|告诉我|跟我说)|(?:need anything|any questions|if you get stuck).{0,16}(?:let me know|tell me|ping me)/i.test(text)
  return hasBareTail || (hasLead && hasAction)
}

function incrementCount<T extends string>(counts: Map<T, number>, label: T) {
  counts.set(label, (counts.get(label) ?? 0) + 1)
}

function collectSelfReferenceSignals(text: string) {
  const signals: SelfReferenceLabel[] = []

  if (/(?:我是|我只是|作为)\s*AI/i.test(text)) {
    signals.push('ai-identity-declaration')
  }

  if (/(?:^|[\s,.!?，。！？])AI\s*(?:也得|还得|也会|也要)/i.test(text)) {
    signals.push('ai-banter-opening')
  }

  if (/我记住了|我会记住/.test(text)) {
    signals.push('memory-vow')
  }

  if (/i(?:ll| will) remember/i.test(text)) {
    signals.push('memory-vow')
  }

  return [...new Set(signals)]
}

function collectSelfReferences(texts: string[]) {
  const counts = collectSelfReferenceCounts(texts)
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([label]) => label)
}

function collectSelfReferenceCounts(texts: string[]) {
  const signals: SelfReferenceLabel[] = []

  for (const text of texts) {
    signals.push(...collectSelfReferenceSignals(text))
  }

  return countValues(signals)
}

function collectPragmaticPatternSignals(text: string) {
  const labels: PragmaticPatternLabel[] = []
  const openingClause = extractOpeningClause(text)
  const endingClause = extractEndingClause(text)

  if (matchesAny(openingClause, COMFORT_OPENING_PATTERNS)) {
    labels.push('comfort-opening')
  }

  if (matchesAny(endingClause, FOLLOW_UP_TAIL_PATTERNS)) {
    labels.push('follow-up-tail')
  }

  if (matchesAny(text, REPAIR_ROUTINE_PATTERNS)) {
    labels.push('repair-routine')
  }

  if (isServiceMenuTail(endingClause)) {
    labels.push('service-menu-tail')
  }

  if (matchesAny(endingClause, PRESENCE_TAIL_PATTERNS)) {
    labels.push('presence-tail')
  }

  if (matchesAny(endingClause, TILDE_TAIL_PATTERNS)) {
    labels.push('tilde-tail')
  }

  if (matchesAny(text, ELLIPSIS_OVERUSE_PATTERNS)) {
    labels.push('ellipsis-overuse')
  }

  if (matchesAny(text, CHEAP_EMOTION_MARKER_PATTERNS)) {
    labels.push('cheap-emotion-marker')
  }

  if (matchesAny(text, STAGE_NARRATION_PATTERNS)) {
    labels.push('stage-narration')
  }

  return [...new Set(labels)]
}

function collectPragmaticPatterns(texts: string[]) {
  const counts = collectPragmaticPatternCounts(texts)
  return [...counts.entries()]
    .filter(([label, count]) => count >= PRAGMATIC_PATTERN_THRESHOLDS[label])
    .map(([label]) => label)
    .slice(0, 6)
}

function collectPragmaticPatternCounts(texts: string[]) {
  const counts = new Map<PragmaticPatternLabel, number>()

  for (const text of texts) {
    for (const label of collectPragmaticPatternSignals(text)) {
      incrementCount(counts, label)
    }
  }

  return counts
}

function collectAssistantTexts(recentMessages: ChatHistoryItem[], lookback = 6) {
  return recentMessages
    .filter(message => message.role === 'assistant')
    .slice(-lookback)
    .map(message => extractTextFromContent(message.content))
    .map(text => normalizeText(text))
    .filter(text => text.length > 0)
}

function getSceneAwarePragmaticThreshold(input: {
  label: PragmaticPatternLabel
  sceneMode?: AiriSceneMode
  hasToolSummary?: boolean
}) {
  const defaultThreshold = PRAGMATIC_PATTERN_THRESHOLDS[input.label]

  if (input.hasToolSummary) {
    switch (input.label) {
      case 'service-menu-tail':
      case 'follow-up-tail':
        return 1
    }
  }

  switch (input.sceneMode) {
    case 'repair-after-failure':
      switch (input.label) {
        case 'repair-routine':
        case 'service-menu-tail':
        case 'follow-up-tail':
          return 1
      }
      return defaultThreshold
    case 'casual-chat':
    case 'light-bickering':
    case 'praise-receiving':
      switch (input.label) {
        case 'comfort-opening':
        case 'follow-up-tail':
          return defaultThreshold + 2
        case 'presence-tail':
        case 'tilde-tail':
        case 'stage-narration':
          return defaultThreshold
        case 'ellipsis-overuse':
        case 'cheap-emotion-marker':
          return defaultThreshold
      }
      return defaultThreshold
    default:
      return defaultThreshold
  }
}

function getSceneAwareSignatureThreshold(sceneMode?: AiriSceneMode) {
  switch (sceneMode) {
    case 'casual-chat':
    case 'light-bickering':
    case 'praise-receiving':
      return 3
    default:
      return GENERIC_SIGNATURE_THRESHOLD
  }
}

function hasEnoughHistoryCount(
  counts: Map<string, number>,
  value: string,
  minOccurrences: number,
  currentTurnContribution = 0,
) {
  if (!value || minOccurrences < 1) {
    return false
  }

  return (counts.get(value) ?? 0) + currentTurnContribution >= minOccurrences
}

export function buildAiriAntiTemplateGuard(recentMessages: ChatHistoryItem[], options?: {
  lookback?: number
  candidateAssistantText?: string
}) {
  const assistantTexts = collectAssistantTexts(recentMessages, options?.lookback ?? 6)

  const candidateAssistantText = normalizeText(options?.candidateAssistantText ?? '')
  if (candidateAssistantText.length > 0) {
    assistantTexts.push(candidateAssistantText)
  }

  if (assistantTexts.length < 2) {
    return null
  }

  const repeatedOpenings = getRepeatedValues(assistantTexts.map(extractOpeningSignature))
  const repeatedEndings = getRepeatedValues(assistantTexts.map(extractEndingSignature))
  const repeatedSelfReferences = collectSelfReferences(assistantTexts)
  const repeatedPragmaticPatterns = collectPragmaticPatterns(assistantTexts)

  if (
    repeatedOpenings.length === 0
    && repeatedEndings.length === 0
    && repeatedSelfReferences.length === 0
    && repeatedPragmaticPatterns.length === 0
  ) {
    return null
  }

  return {
    repeatedOpenings,
    repeatedEndings,
    repeatedSelfReferences,
    repeatedPragmaticPatterns,
  } satisfies AiriAntiTemplateGuard
}

export function buildAiriAntiTemplateRewritePressure(
  recentMessages: ChatHistoryItem[],
  candidateAssistantText: string,
  options?: {
    lookback?: number
    sceneMode?: AiriSceneMode
    hasToolSummary?: boolean
  },
) {
  const normalizedCandidate = normalizeText(candidateAssistantText)
  if (!normalizedCandidate) {
    return null
  }

  const assistantTexts = collectAssistantTexts(recentMessages, options?.lookback ?? 6)
  if (assistantTexts.length === 0) {
    return null
  }

  const candidateOpening = extractOpeningSignature(normalizedCandidate)
  const candidateEnding = extractEndingSignature(normalizedCandidate)
  const candidateSelfReferences = collectSelfReferenceSignals(normalizedCandidate)
  const candidatePragmaticPatterns = collectPragmaticPatternSignals(normalizedCandidate)
  const openingCounts = countValues(assistantTexts.map(extractOpeningSignature))
  const endingCounts = countValues(assistantTexts.map(extractEndingSignature))
  const selfReferenceCounts = collectSelfReferenceCounts(assistantTexts)
  const pragmaticPatternCounts = collectPragmaticPatternCounts(assistantTexts)
  const signatureThreshold = getSceneAwareSignatureThreshold(options?.sceneMode)

  const rewritePressure: AiriAntiTemplateGuard = {
    repeatedOpenings: hasEnoughHistoryCount(openingCounts, candidateOpening, signatureThreshold, 1) ? [candidateOpening] : [],
    repeatedEndings: hasEnoughHistoryCount(endingCounts, candidateEnding, signatureThreshold, 1) ? [candidateEnding] : [],
    repeatedSelfReferences: candidateSelfReferences
      .filter(label => hasEnoughHistoryCount(selfReferenceCounts, label, 2, 1)),
    repeatedPragmaticPatterns: candidatePragmaticPatterns
      .filter(label => hasEnoughHistoryCount(pragmaticPatternCounts, label, getSceneAwarePragmaticThreshold({
        label,
        sceneMode: options?.sceneMode,
        hasToolSummary: options?.hasToolSummary,
      }), 1)),
  }

  if (
    rewritePressure.repeatedOpenings.length === 0
    && rewritePressure.repeatedEndings.length === 0
    && rewritePressure.repeatedSelfReferences.length === 0
    && rewritePressure.repeatedPragmaticPatterns.length === 0
  ) {
    return null
  }

  return rewritePressure
}
