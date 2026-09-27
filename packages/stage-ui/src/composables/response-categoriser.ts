export type ResponseCategory = 'speech' | 'reasoning' | 'unknown'

export interface CategorizedSegment {
  category: ResponseCategory
  content: string
  startIndex: number
  endIndex: number
  raw: string
  tagName: string
}

export interface CategorizedResponse {
  segments: CategorizedSegment[]
  speech: string
  reasoning: string
  raw: string
}

// Only explicit private envelopes are protocol. Ordinary prose, HTML and
// angle-bracket expressions must not be guessed to be model reasoning.
const INTERNAL_RESPONSE_TAGS = new Set([
  'action',
  'analysis',
  'emotion',
  'expression',
  'function',
  'function-call',
  'function-calls',
  'function_call',
  'function_calls',
  'gesture',
  'inner-monologue',
  'inner_monologue',
  'reasoning',
  'think',
  'thinking',
  'thought',
  'tool',
  'tool-call',
  'tool-calls',
  'tool_call',
  'tool_calls',
])

interface PrivateSegment extends CategorizedSegment {
  complete: boolean
}

function isPrivateTagPrefix(text: string, streaming: boolean) {
  if (text === '<' || text === '</')
    return streaming

  const match = /^<\/?([\w-]+)([\s\S]*)$/.exec(text)
  if (!match)
    return false

  const name = match[1].toLowerCase()
  if (!match[2])
    return [...INTERNAL_RESPONSE_TAGS].some(tag => tag.startsWith(name))

  return INTERNAL_RESPONSE_TAGS.has(name) && /^[\s/]/.test(match[2])
}

function scanPrivateSegments(response: string, streaming = false) {
  const segments: PrivateSegment[] = []
  const stack: Array<{ tagName: string, startIndex: number, bodyStart: number }> = []
  let pendingStart: number | undefined
  let cursor = 0

  const addSegment = (tagName: string, startIndex: number, endIndex: number, content: string, complete: boolean) => {
    segments.push({
      category: 'reasoning', tagName, startIndex, endIndex,
      raw: response.slice(startIndex, endIndex), content: content.trim(), complete,
    })
  }

  while (cursor < response.length) {
    const start = response.indexOf('<', cursor)
    if (start < 0)
      break

    // Quoted attributes may contain '>'; a tag name must end at an actual
    // delimiter, so <thought-experiment> remains ordinary user-facing markup.
    const token = /^<\/?([a-z][\w-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(response.slice(start))
    if (!token) {
      const tail = response.slice(start)
      if (isPrivateTagPrefix(tail, streaming)) {
        pendingStart = start
        break
      }
      cursor = start + 1
      continue
    }

    cursor = start + token[0].length
    const tagName = token[1].toLowerCase()
    if (!INTERNAL_RESPONSE_TAGS.has(tagName))
      continue

    if (token[0].startsWith('</')) {
      const matchingIndex = stack.map(tag => tag.tagName).lastIndexOf(tagName)
      if (matchingIndex < 0) {
        if (stack.length === 0)
          addSegment(tagName, start, cursor, '', true)
        continue
      }
      const opening = stack[matchingIndex]
      stack.splice(matchingIndex)
      if (stack.length === 0)
        addSegment(tagName, opening.startIndex, cursor, response.slice(opening.bodyStart, start), true)
    }
    else if (/\/\s*>$/.test(token[0])) {
      if (stack.length === 0)
        addSegment(tagName, start, cursor, '', true)
    }
    else {
      stack.push({ tagName, startIndex: start, bodyStart: cursor })
    }
  }

  const opening = stack[0]
  if (opening) {
    // An unfinished private envelope stays private through EOF, including
    // blank lines. A paragraph break cannot prove the reasoning has ended.
    addSegment(opening.tagName, opening.startIndex, response.length, response.slice(opening.bodyStart), false)
  }
  else if (pendingStart !== undefined) {
    addSegment('', pendingStart, response.length, '', false)
  }

  return { segments, pendingStart }
}

function speechOutsideSegments(response: string, segments: CategorizedSegment[], start = 0, end = response.length) {
  let cursor = start
  let speech = ''
  for (const segment of segments) {
    if (segment.endIndex <= cursor || segment.startIndex >= end)
      continue
    if (segment.startIndex > cursor)
      speech += response.slice(cursor, Math.min(segment.startIndex, end))
    cursor = Math.max(cursor, segment.endIndex)
  }
  if (cursor < end)
    speech += response.slice(cursor, end)
  return speech
}

/** Preserves visible whitespace while removing complete and unfinished private envelopes. */
export function removeInternalResponseTags(response: string) {
  return speechOutsideSegments(response, scanPrivateSegments(response).segments)
}

export function categorizeResponse(response: string, _providerId?: string): CategorizedResponse {
  const segments: CategorizedSegment[] = scanPrivateSegments(response).segments.map(({ complete: _complete, ...segment }) => segment)
  return {
    segments,
    speech: segments.length ? speechOutsideSegments(response, segments).replace(/[ \t]{2,}/g, ' ').trim() : response,
    reasoning: segments.map(segment => segment.content).filter(Boolean).join('\n\n'),
    raw: response,
  }
}

/** Receives literal text after special-token extraction by useLlmmarkerParser. */
export function createStreamingCategorizer(
  providerId?: string,
  onSegment?: (segment: CategorizedSegment) => void,
) {
  let buffer = ''
  let scanned = scanPrivateSegments('', true)
  let categorized: CategorizedResponse | null = null
  let emittedSegments = 0
  let deferredStart: number | undefined

  return {
    consume(chunk: string) {
      buffer += chunk
      scanned = scanPrivateSegments(buffer, true)
      categorized = categorizeResponse(buffer, providerId)
      const completeSegments = scanned.segments.filter(segment => segment.complete)
      for (; emittedSegments < completeSegments.length; emittedSegments++) {
        const { complete: _complete, ...segment } = completeSegments[emittedSegments]
        onSegment?.(segment)
      }
    },
    isSpeechAt(position: number): boolean {
      return !scanned.segments.some(segment => position >= segment.startIndex && position < segment.endIndex)
    },
    filterToSpeech(text: string, startPosition: number): string {
      // consume() already appended this chunk. Hold only an ambiguous suffix
      // such as '<thi'; if it becomes '<thing>', release it on the next call.
      const start = Math.min(startPosition, deferredStart ?? startPosition)
      const end = Math.min(buffer.length, startPosition + text.length)
      const availableEnd = Math.min(end, scanned.pendingStart ?? end)
      deferredStart = availableEnd < end ? availableEnd : undefined
      return speechOutsideSegments(buffer, scanned.segments, start, availableEnd)
    },
    getCurrentPosition(): number {
      return buffer.length
    },
    end(): CategorizedResponse {
      return categorizeResponse(buffer, providerId)
    },
    getCurrent(): CategorizedResponse | null {
      return categorized
    },
  }
}
