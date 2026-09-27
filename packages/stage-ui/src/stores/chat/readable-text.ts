import { removeLeakedToolProtocol } from '../../composables/llm-marker-parser'
import { categorizeResponse } from '../../composables/response-categoriser'
import { removeSpecialMarkers } from '../../composables/semantic-segmentation'

const SPACE_COLLAPSE_RE = /[ \t]{2,}/g
const MARKDOWN_EMPHASIS_RE = /\*\*|__/g

/** The only text form allowed into final display and whole-turn speech. */
export function createReadableFinalText(text: string, providerId?: string) {
  const withoutLeakedToolProtocol = removeLeakedToolProtocol(text)
  return removeSpecialMarkers(categorizeResponse(withoutLeakedToolProtocol, providerId).speech)
    .replace(SPACE_COLLAPSE_RE, ' ')
    .replace(MARKDOWN_EMPHASIS_RE, '')
    .trim()
}

/** Removes Markdown emphasis syntax that speech providers otherwise pronounce aloud. */
export function createReadableSpeechText(text: string, providerId?: string) {
  return createReadableFinalText(text, providerId)
}
