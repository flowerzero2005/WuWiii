// Match the protocol before rendering. Providers sometimes escape angle
// brackets or Markdown punctuation, so parsing and display use one rule.
const ACT_MARKER_RE = /(?:\\?<|&lt;)\s*\\?\|\s*ACT\b[\s\S]*?\}\s*\\?\|+(?:\s*(?:\\?>|&gt;)|(?=\s|$))/gi
const INCOMPLETE_ACT_RE = /(?:\\?<|&lt;)\s*\\?\|\s*ACT\b(?:(?!\|>)[\s\S])*$/i

export function extractActMarkers(text: string) {
  return Array.from(text.matchAll(ACT_MARKER_RE), match => ({
    index: match.index,
    raw: match[0],
    normalized: match[0]
      .replace(/\\([<|>])/g, '$1')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;|&#34;/gi, '"'),
  }))
}

export function removeActMarkers(text: string) {
  return text.replace(ACT_MARKER_RE, '').replace(INCOMPLETE_ACT_RE, '')
}
