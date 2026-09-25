import type { ElectronCommandExecutionWriteTextPayload, ElectronCommandExecutionWriteTextRange, ElectronCommandExecutionWriteTextResult } from '../eventa'

export interface ApplyWriteTextStrategyInput {
  currentText: string
  content: string
  mode?: ElectronCommandExecutionWriteTextPayload['mode']
  range?: ElectronCommandExecutionWriteTextRange
  target?: string
  occurrence?: number
}

export interface ApplyWriteTextStrategyResult {
  nextText: string
  writeMode: ElectronCommandExecutionWriteTextResult['writeMode']
}

export interface TextPreview {
  textPreview: string
  charLength: number
  truncated: boolean
}

export interface PreviewWriteTextStrategyInput extends ApplyWriteTextStrategyInput {
  previewChars?: number
}

export interface TextChangeSummary {
  mode: ElectronCommandExecutionWriteTextResult['writeMode']
  firstChangedIndex: number
  beforeLineStart: number
  beforeLineCount: number
  afterLineStart: number
  afterLineCount: number
  removedCharCount: number
  addedCharCount: number
  changedCharDelta: number
  removedTextPreview: TextPreview
  addedTextPreview: TextPreview
  unifiedDiffPreview: TextPreview
  matchCount?: number
  occurrence?: number
  range?: ElectronCommandExecutionWriteTextRange
  insertionIndex?: number
  targetPreview?: TextPreview
}

export interface PreviewWriteTextStrategyResult extends ApplyWriteTextStrategyResult {
  changed: boolean
  beforePreview: TextPreview
  afterPreview: TextPreview
  changeSummary?: TextChangeSummary
}

function validateRange(range: ElectronCommandExecutionWriteTextRange, textLength: number) {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new TypeError('replace-range requires integer start/end offsets')
  }

  if (range.start < 0 || range.end < 0) {
    throw new Error('replace-range offsets must be >= 0')
  }

  if (range.start > range.end) {
    throw new Error('replace-range start must be <= end')
  }

  if (range.end > textLength) {
    throw new Error(`replace-range end ${range.end} is outside current text length ${textLength}`)
  }
}

function validateTarget(target: string | undefined, writeMode: ElectronCommandExecutionWriteTextPayload['mode']) {
  if (!target) {
    throw new Error(`${writeMode} requires a non-empty target marker`)
  }

  return target
}

function validateOccurrence(occurrence: number | undefined, writeMode: ElectronCommandExecutionWriteTextPayload['mode']) {
  if (!Number.isInteger(occurrence) || occurrence == null || occurrence < 1) {
    throw new Error(`${writeMode} requires occurrence >= 1`)
  }

  return occurrence
}

function createTextPreview(text: string, previewChars = 2000): TextPreview {
  const appliedPreviewChars = Math.max(1, previewChars)
  return {
    textPreview: text.slice(0, appliedPreviewChars),
    charLength: text.length,
    truncated: text.length > appliedPreviewChars,
  }
}

function countLogicalLines(text: string) {
  if (!text) {
    return 0
  }

  if (text.endsWith('\n')) {
    return text.slice(0, -1).split(/\r?\n/).length
  }

  return text.split(/\r?\n/).length
}

function getLineStartIndex(text: string, index: number) {
  const previousBreak = text.lastIndexOf('\n', Math.max(0, index) - 1)
  return previousBreak < 0 ? 0 : previousBreak + 1
}

function getLineEndIndex(text: string, index: number) {
  const nextBreak = text.indexOf('\n', index)
  return nextBreak < 0 ? text.length : nextBreak + 1
}

function getLineNumberAtIndex(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length
}

function toDiffLines(text: string) {
  const normalized = text.replace(/\r/g, '')
  if (!normalized) {
    return []
  }

  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) {
    lines.pop()
  }

  return lines
}

function createUnifiedDiffPreview(params: {
  beforeText: string
  afterText: string
  beforeLineStart: number
  afterLineStart: number
  previewChars?: number
}) {
  const beforeLineCount = countLogicalLines(params.beforeText)
  const afterLineCount = countLogicalLines(params.afterText)
  const diffLines = [
    `@@ -${params.beforeLineStart},${beforeLineCount} +${params.afterLineStart},${afterLineCount} @@`,
    ...toDiffLines(params.beforeText).map(line => `-${line}`),
    ...toDiffLines(params.afterText).map(line => `+${line}`),
  ]

  return createTextPreview(diffLines.join('\n'), params.previewChars)
}

function countOccurrences(text: string, target: string) {
  if (!target) {
    return 0
  }

  let count = 0
  let searchFrom = 0
  while (searchFrom <= text.length) {
    const nextIndex = text.indexOf(target, searchFrom)
    if (nextIndex < 0) {
      break
    }

    count += 1
    searchFrom = nextIndex + target.length
  }

  return count
}

function findFirstChangedIndex(beforeText: string, afterText: string) {
  const maxSharedLength = Math.min(beforeText.length, afterText.length)
  for (let index = 0; index < maxSharedLength; index += 1) {
    if (beforeText[index] !== afterText[index]) {
      return index
    }
  }

  return beforeText.length === afterText.length ? -1 : maxSharedLength
}

function findSharedSuffixLength(beforeText: string, afterText: string, firstChangedIndex: number) {
  let suffixLength = 0
  const maxSuffixLength = Math.min(beforeText.length, afterText.length) - firstChangedIndex

  while (suffixLength < maxSuffixLength) {
    const beforeIndex = beforeText.length - 1 - suffixLength
    const afterIndex = afterText.length - 1 - suffixLength
    if (beforeText[beforeIndex] !== afterText[afterIndex]) {
      break
    }

    suffixLength += 1
  }

  return suffixLength
}

function createTextChangeSummary(
  input: PreviewWriteTextStrategyInput,
  applied: ApplyWriteTextStrategyResult,
): TextChangeSummary | undefined {
  const firstChangedIndex = findFirstChangedIndex(input.currentText, applied.nextText)
  if (firstChangedIndex < 0) {
    return undefined
  }

  const sharedSuffixLength = findSharedSuffixLength(input.currentText, applied.nextText, firstChangedIndex)
  const beforeChangedEnd = input.currentText.length - sharedSuffixLength
  const afterChangedEnd = applied.nextText.length - sharedSuffixLength
  const beforeLineStartIndex = getLineStartIndex(input.currentText, firstChangedIndex)
  const afterLineStartIndex = getLineStartIndex(applied.nextText, firstChangedIndex)
  const beforeLineEndIndex = getLineEndIndex(input.currentText, beforeChangedEnd)
  const afterLineEndIndex = getLineEndIndex(applied.nextText, afterChangedEnd)
  const removedText = input.currentText.slice(firstChangedIndex, beforeChangedEnd)
  const addedText = applied.nextText.slice(firstChangedIndex, afterChangedEnd)
  const beforeLineBlock = input.currentText.slice(beforeLineStartIndex, beforeLineEndIndex)
  const afterLineBlock = applied.nextText.slice(afterLineStartIndex, afterLineEndIndex)
  const summary: TextChangeSummary = {
    mode: applied.writeMode,
    firstChangedIndex,
    beforeLineStart: getLineNumberAtIndex(input.currentText, beforeLineStartIndex),
    beforeLineCount: countLogicalLines(beforeLineBlock),
    afterLineStart: getLineNumberAtIndex(applied.nextText, afterLineStartIndex),
    afterLineCount: countLogicalLines(afterLineBlock),
    removedCharCount: removedText.length,
    addedCharCount: addedText.length,
    changedCharDelta: addedText.length - removedText.length,
    removedTextPreview: createTextPreview(removedText, input.previewChars),
    addedTextPreview: createTextPreview(addedText, input.previewChars),
    unifiedDiffPreview: createUnifiedDiffPreview({
      beforeText: beforeLineBlock,
      afterText: afterLineBlock,
      beforeLineStart: getLineNumberAtIndex(input.currentText, beforeLineStartIndex),
      afterLineStart: getLineNumberAtIndex(applied.nextText, afterLineStartIndex),
      previewChars: input.previewChars,
    }),
  }

  if (input.target) {
    summary.targetPreview = createTextPreview(input.target, input.previewChars)
  }

  if (applied.writeMode === 'append') {
    summary.insertionIndex = input.currentText.length
  }

  if (applied.writeMode === 'replace-range' && input.range) {
    summary.range = input.range
  }

  if (applied.writeMode === 'replace-first-match') {
    summary.matchCount = countOccurrences(input.currentText, input.target ?? '')
    summary.occurrence = 1
  }

  if (applied.writeMode === 'replace-all-matches') {
    summary.matchCount = countOccurrences(input.currentText, input.target ?? '')
  }

  if (applied.writeMode === 'replace-nth-match') {
    summary.matchCount = countOccurrences(input.currentText, input.target ?? '')
    summary.occurrence = input.occurrence
  }

  if (applied.writeMode === 'insert-before-marker' || applied.writeMode === 'insert-after-marker') {
    summary.matchCount = countOccurrences(input.currentText, input.target ?? '')
    summary.insertionIndex = applied.writeMode === 'insert-before-marker'
      ? firstChangedIndex
      : firstChangedIndex + removedText.length
  }

  return summary
}

// Applies append/range/full-file text edits while keeping the command journal on
// whole-file before/after snapshots for rollback and checkpoint recovery.
export function applyWriteTextStrategy(input: ApplyWriteTextStrategyInput): ApplyWriteTextStrategyResult {
  const writeMode = input.mode ?? 'replace'

  if (writeMode !== 'replace-range' && input.range) {
    throw new Error('range is only allowed when mode is replace-range')
  }

  if (!['replace-first-match', 'replace-all-matches', 'replace-nth-match', 'insert-before-marker', 'insert-after-marker'].includes(writeMode) && input.target) {
    throw new Error('target is only allowed for marker/match-based write modes')
  }

  if (writeMode !== 'replace-nth-match' && input.occurrence != null) {
    throw new Error('occurrence is only allowed when mode is replace-nth-match')
  }

  if (writeMode === 'replace-range') {
    if (!input.range) {
      throw new Error('range is required when mode is replace-range')
    }

    validateRange(input.range, input.currentText.length)

    return {
      nextText: `${input.currentText.slice(0, input.range.start)}${input.content}${input.currentText.slice(input.range.end)}`,
      writeMode,
    }
  }

  if (writeMode === 'append') {
    return {
      nextText: `${input.currentText}${input.content}`,
      writeMode,
    }
  }

  if (writeMode === 'replace-first-match') {
    const target = validateTarget(input.target, writeMode)
    const matchIndex = input.currentText.indexOf(target)
    if (matchIndex < 0) {
      throw new Error(`replace-first-match target was not found: ${target}`)
    }

    return {
      nextText: `${input.currentText.slice(0, matchIndex)}${input.content}${input.currentText.slice(matchIndex + target.length)}`,
      writeMode,
    }
  }

  if (writeMode === 'replace-all-matches') {
    const target = validateTarget(input.target, writeMode)
    if (!input.currentText.includes(target)) {
      throw new Error(`replace-all-matches target was not found: ${target}`)
    }

    return {
      nextText: input.currentText.split(target).join(input.content),
      writeMode,
    }
  }

  if (writeMode === 'replace-nth-match') {
    const target = validateTarget(input.target, writeMode)
    const occurrence = validateOccurrence(input.occurrence, writeMode)

    let searchFrom = 0
    let matchIndex = -1
    for (let currentOccurrence = 1; currentOccurrence <= occurrence; currentOccurrence += 1) {
      matchIndex = input.currentText.indexOf(target, searchFrom)
      if (matchIndex < 0) {
        throw new Error(`replace-nth-match target occurrence ${occurrence} was not found: ${target}`)
      }
      searchFrom = matchIndex + target.length
    }

    return {
      nextText: `${input.currentText.slice(0, matchIndex)}${input.content}${input.currentText.slice(matchIndex + target.length)}`,
      writeMode,
    }
  }

  if (writeMode === 'insert-before-marker') {
    const target = validateTarget(input.target, writeMode)
    const matchIndex = input.currentText.indexOf(target)
    if (matchIndex < 0) {
      throw new Error(`insert-before-marker target was not found: ${target}`)
    }

    return {
      nextText: `${input.currentText.slice(0, matchIndex)}${input.content}${input.currentText.slice(matchIndex)}`,
      writeMode,
    }
  }

  if (writeMode === 'insert-after-marker') {
    const target = validateTarget(input.target, writeMode)
    const matchIndex = input.currentText.indexOf(target)
    if (matchIndex < 0) {
      throw new Error(`insert-after-marker target was not found: ${target}`)
    }

    const insertionIndex = matchIndex + target.length
    return {
      nextText: `${input.currentText.slice(0, insertionIndex)}${input.content}${input.currentText.slice(insertionIndex)}`,
      writeMode,
    }
  }

  return {
    nextText: input.content,
    writeMode,
  }
}

// Previews the exact same edit algorithm as the real write path so dry-run
// tooling and actual writes cannot drift on text transformation semantics.
export function previewWriteTextStrategy(input: PreviewWriteTextStrategyInput): PreviewWriteTextStrategyResult {
  const applied = applyWriteTextStrategy(input)
  return {
    ...applied,
    changed: applied.nextText !== input.currentText,
    beforePreview: createTextPreview(input.currentText, input.previewChars),
    afterPreview: createTextPreview(applied.nextText, input.previewChars),
    changeSummary: createTextChangeSummary(input, applied),
  }
}
