import { removeLeakedToolProtocol } from './llm-marker-parser'
import { removeInternalResponseTags } from './response-categoriser'

const EXPLICIT_SEGMENT_MARKER = '<|SEGMENT|>'
const TRANSITION_PREFIXES = [
  '另外',
  '而且',
  '还有',
  '不过',
  '但是',
  '然后',
  '所以',
  '总之',
  '顺便',
  '对了',
  '其实',
  '再说',
  '话说',
]
const AFTERTHOUGHT_PREFIXES = [
  '对了',
  '顺便',
  '不过',
  '但是',
  '其实',
  '还有',
  '然后',
  '嗯',
  '哦',
  '诶',
  '欸',
  '哼',
  '……',
  '...',
]
const BOUNDARY_PUNCTUATION = new Set(['。', '！', '？', '!', '?', '…'])
const CONTINUATION_PUNCTUATION = new Set(['。', '！', '？', '!', '?', '…', '"', '\'', '”', '’', '」', '』', '）', ')', '】', '》', '~', '～'])
const MEMORY_CAPTURE_MARKER_RE = /<\|MEMORY_CAPTURE\b[\s\S]*?(?:\|>|$)/gi
const INCOMPLETE_MARKER_RE = /<\|[\s\S]*$/g
const SPECIAL_MARKER_RE = /<\|[\s\S]*?\|>/g
const ACT_MARKER_RE = /<\|\s*ACT\b(?:(?!\|>)[\s\S])*?\}\s*\|{2,}>?/gi
const DISPLAY_MARKER_RE = /<\|(?:DELAY|SEGMENT)\b(?:(?!\|>)[\s\S])*?\|{2,}>?/gi

export interface SemanticSegmentationOptions {
  aggressive?: boolean
}

export interface RemoveSpecialMarkersOptions {
  /** Keep leading/trailing whitespace for the live typewriter transcript. */
  trim?: boolean
}

export interface ReplySegmentationResult {
  normalizedText: string
  segments: string[]
  usedExplicitMarkers: boolean
}

interface SegmentationConfig {
  aggressive: boolean
  hardBubbleLength: number
  maxSentencesPerBubble: number
  minBubbleLength: number
  minReplyLengthToSplit: number
  minStandaloneLength: number
  softBubbleLength: number
}

export function removeSpecialMarkers(text: string, options?: RemoveSpecialMarkersOptions): string {
  let result = removeInternalResponseTags(removeLeakedToolProtocol(text))
    .replaceAll('<{\'|\'}', '<|')
    .replaceAll('{\'|\'}>', '|>')
  let previous = ''
  let iterations = 0

  while (result !== previous && iterations < 10) {
    previous = result
    // MEMORY_CAPTURE is a private decision envelope. Consume an incomplete
    // envelope through EOF as well, otherwise parser.end() can expose model
    // protocol (and potentially a secret) in the final bubble/TTS.
    result = result.replace(MEMORY_CAPTURE_MARKER_RE, '')
      .replace(ACT_MARKER_RE, '')
      .replace(DISPLAY_MARKER_RE, '')
      .replace(SPECIAL_MARKER_RE, '')
      // Truncated marker names (including '<|A') are private too. Strip
      // complete malformed closers first so their following prose survives.
      .replace(INCOMPLETE_MARKER_RE, '')
    iterations++
  }

  return options?.trim === false ? result : result.trim()
}

function buildConfig(options: SemanticSegmentationOptions): SegmentationConfig {
  if (options.aggressive) {
    return {
      aggressive: true,
      hardBubbleLength: 90,
      maxSentencesPerBubble: 2,
      minBubbleLength: 18,
      minReplyLengthToSplit: 40,
      minStandaloneLength: 10,
      softBubbleLength: 52,
    }
  }

  return {
    aggressive: false,
    hardBubbleLength: 110,
    maxSentencesPerBubble: 2,
    minBubbleLength: 24,
    minReplyLengthToSplit: 58,
    minStandaloneLength: 14,
    softBubbleLength: 68,
  }
}

function normalizeSegmentText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitExplicitSegments(text: string): string[] {
  // Strip private bodies before splitting; a SEGMENT inside <think> must
  // never detach its trailing reasoning from the opening envelope.
  text = removeInternalResponseTags(removeLeakedToolProtocol(text))
  if (!text.includes(EXPLICIT_SEGMENT_MARKER))
    return []

  return text
    .split(EXPLICIT_SEGMENT_MARKER)
    .map(part => normalizeSegmentText(removeSpecialMarkers(part)))
    .filter(Boolean)
}

function hasCodeFence(text: string): boolean {
  return text.includes('```')
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

function isAsciiWordish(char: string | undefined): boolean {
  if (!char)
    return false

  return /[A-Z0-9]/i.test(char) || ['`', '"', '\'', '(', '[', '{'].includes(char)
}

function joinFragments(left: string, right: string): string {
  const next = right.trim()
  if (!left)
    return next

  const previous = left.trimEnd()
  if (!previous)
    return next

  const previousLastChar = previous.at(-1)
  const nextFirstChar = next.at(0)
  const needsSpace
    = (previousLastChar === '.' || previousLastChar === '!' || previousLastChar === '?'
      || isAsciiWordish(previousLastChar))
    && isAsciiWordish(nextFirstChar)

  return needsSpace ? `${previous} ${next}` : `${previous}${next}`
}

function endsWithQuestion(text: string): boolean {
  return /[？?]["'”’」』）)]*$/.test(text.trim())
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  const normalized = text.trim().replace(/^[“"'([{（【]+/, '')
  return prefixes.some(prefix => normalized.startsWith(prefix))
}

function splitIntoSentenceUnits(text: string): string[] {
  const units: string[] = []
  let start = 0
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (char === '\n') {
      let next = index
      while (next < text.length && text[next] === '\n')
        next++

      if (next - index >= 2) {
        const chunk = normalizeSegmentText(text.slice(start, index))
        if (chunk)
          units.push(chunk)
        start = next
        index = next
        continue
      }
    }

    if (BOUNDARY_PUNCTUATION.has(char)) {
      let end = index + 1
      while (end < text.length && CONTINUATION_PUNCTUATION.has(text[end]))
        end++
      while (end < text.length && (text[end] === ' ' || text[end] === '\t'))
        end++

      const chunk = normalizeSegmentText(text.slice(start, end))
      if (chunk)
        units.push(chunk)

      start = end
      index = end
      continue
    }

    index++
  }

  const tail = normalizeSegmentText(text.slice(start))
  if (tail)
    units.push(tail)

  return units
}

function segmentParagraph(paragraph: string, config: SegmentationConfig): string[] {
  const normalizedParagraph = normalizeSegmentText(paragraph)
  if (!normalizedParagraph)
    return []

  if (normalizedParagraph.length < config.minReplyLengthToSplit)
    return [normalizedParagraph]

  const units = splitIntoSentenceUnits(normalizedParagraph)
  if (units.length <= 1)
    return [normalizedParagraph]

  const segments: string[] = []
  let current = ''
  let sentenceCount = 0

  const pushCurrent = () => {
    const chunk = normalizeSegmentText(current)
    if (chunk)
      segments.push(chunk)
    current = ''
    sentenceCount = 0
  }

  for (const unit of units) {
    const nextUnit = normalizeSegmentText(unit)
    if (!nextUnit)
      continue

    const candidate = current ? joinFragments(current, nextUnit) : nextUnit
    const shouldBreakBeforeUnit = current
      && (
        candidate.length > config.hardBubbleLength
        || (current.length >= config.softBubbleLength && sentenceCount >= config.maxSentencesPerBubble)
        || (current.length >= config.softBubbleLength && startsWithAny(nextUnit, TRANSITION_PREFIXES))
        || (current.length >= config.minBubbleLength && endsWithQuestion(current) && !startsWithAny(nextUnit, AFTERTHOUGHT_PREFIXES))
      )

    if (shouldBreakBeforeUnit) {
      pushCurrent()
      current = nextUnit
      sentenceCount = 1
      continue
    }

    current = candidate
    sentenceCount++
  }

  pushCurrent()

  return segments.length > 0 ? segments : [normalizedParagraph]
}

function mergeTinySegments(segments: string[], config: SegmentationConfig): string[] {
  const merged: string[] = []

  for (const segment of segments) {
    const normalized = normalizeSegmentText(segment)
    if (!normalized)
      continue

    if (merged.length === 0) {
      merged.push(normalized)
      continue
    }

    const previous = merged.at(-1)!
    const keepStandalone = normalized.length >= config.minStandaloneLength || startsWithAny(normalized, AFTERTHOUGHT_PREFIXES)

    if (!keepStandalone && previous.length < config.hardBubbleLength) {
      merged[merged.length - 1] = joinFragments(previous, normalized)
      continue
    }

    merged.push(normalized)
  }

  return merged
}

export function segmentBySemantics(text: string, options: SemanticSegmentationOptions = {}): string[] {
  const explicitSegments = splitExplicitSegments(text)
  if (explicitSegments.length > 0)
    return explicitSegments

  const cleanedText = normalizeSegmentText(removeSpecialMarkers(text))
  if (!cleanedText)
    return []

  if (hasCodeFence(cleanedText))
    return [cleanedText]

  const config = buildConfig(options)
  const paragraphs = splitParagraphs(cleanedText)

  if (paragraphs.length > 1) {
    return mergeTinySegments(
      paragraphs.flatMap(paragraph => segmentParagraph(paragraph, config)),
      config,
    )
  }

  return mergeTinySegments(segmentParagraph(cleanedText, config), config)
}

export function segmentAssistantReply(text: string, options: SemanticSegmentationOptions = {}): ReplySegmentationResult {
  const explicitSegments = splitExplicitSegments(text)
  if (explicitSegments.length > 0) {
    return {
      normalizedText: explicitSegments.join('\n\n'),
      segments: explicitSegments,
      usedExplicitMarkers: true,
    }
  }

  const segments = segmentBySemantics(text, options)
  return {
    normalizedText: segments.join('\n\n'),
    segments,
    usedExplicitMarkers: false,
  }
}
