import { removeLeakedToolProtocol } from '../../composables/llm-marker-parser'
import { categorizeResponse } from '../../composables/response-categoriser'
import { removeSpecialMarkers } from '../../composables/semantic-segmentation'

const INTERNAL_PROTOCOL_TAG_NAMES = 'action|analysis|emotion|expression|function(?:[-_]calls?)?|gesture|inner[-_]monologue|reasoning|think(?:ing)?|thought|tool(?:[-_]calls?)?'
const INTERNAL_PROTOCOL_TAG_PAIR_RE = new RegExp(`<(${INTERNAL_PROTOCOL_TAG_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi')
const INTERNAL_PROTOCOL_TAG_SELF_CLOSING_RE = new RegExp(`<(?:${INTERNAL_PROTOCOL_TAG_NAMES})\\b[^>]*\\/\\s*>`, 'gi')
const INTERNAL_PROTOCOL_TAG_OPEN_RE = new RegExp(`<(?:${INTERNAL_PROTOCOL_TAG_NAMES})\\b[^>]*>`, 'i')
const INTERNAL_PROTOCOL_TAG_UNCLOSED_RE = new RegExp(`<(?:${INTERNAL_PROTOCOL_TAG_NAMES})\\b[^>]*>[\\s\\S]*$`, 'i')
const PARAGRAPH_SPLIT_RE = /\n{2,}/
const SPACE_COLLAPSE_RE = /[ \t]{2,}/g
const MARKDOWN_EMPHASIS_RE = /\*\*|__/g

/**
 * Preserve a visible final paragraph when a model leaves a private tag
 * unclosed. Without a clear blank-line separator the conservative behaviour
 * remains to discard the incomplete private envelope.
 */
function removeUnclosedInternalTag(result: string) {
  const unclosed = result.match(INTERNAL_PROTOCOL_TAG_UNCLOSED_RE)
  if (!unclosed || unclosed.index === undefined)
    return result

  const opening = unclosed[0].match(INTERNAL_PROTOCOL_TAG_OPEN_RE)
  if (!opening || opening.index === undefined)
    return result.replace(INTERNAL_PROTOCOL_TAG_UNCLOSED_RE, '')

  const body = unclosed[0].slice(opening.index + opening[0].length)
  const paragraphs = body.split(PARAGRAPH_SPLIT_RE).map(part => part.trim()).filter(Boolean)
  const visibleTail = paragraphs.length > 1 ? paragraphs.at(-1) : undefined
  return `${result.slice(0, unclosed.index)}${visibleTail ? ` ${visibleTail}` : ''}`
}

/** Removes only known model-private XML envelopes; user-facing HTML stays intact. */
function removeInternalProtocolTags(text: string) {
  let result = text
  let previous = ''

  while (result !== previous) {
    previous = result
    result = result
      .replace(INTERNAL_PROTOCOL_TAG_PAIR_RE, '')
      .replace(INTERNAL_PROTOCOL_TAG_SELF_CLOSING_RE, '')
  }

  return removeUnclosedInternalTag(result)
    .replace(SPACE_COLLAPSE_RE, ' ')
}

/** The only text form allowed into final display and whole-turn speech. */
export function createReadableFinalText(text: string, providerId?: string) {
  const withoutLeakedToolProtocol = removeLeakedToolProtocol(text)
  return removeSpecialMarkers(removeInternalProtocolTags(categorizeResponse(withoutLeakedToolProtocol, providerId).speech))
    .replace(MARKDOWN_EMPHASIS_RE, '')
    .trim()
}

/** Removes Markdown emphasis syntax that speech providers otherwise pronounce aloud. */
export function createReadableSpeechText(text: string, providerId?: string) {
  return createReadableFinalText(text, providerId)
}
