const URL_PATTERN = /https?:\/\/\S+/gi
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`([^`]+)`/g
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\uFE0F]/gu
const ELLIPSIS_PATTERN = /\.{3,}|[…⋯]+/g
const SENTENCE_END_BEFORE_ELLIPSIS_PATTERN = /([。！？!?])(?:\.{3,}|[…⋯]+)/g
const TRAILING_ELLIPSIS_PATTERN = /(?:\.{3,}|[…⋯]+)\s*$/g

export function normalizeSpeechTextForTts(input: string) {
  return input
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(CODE_BLOCK_PATTERN, '代码内容')
    .replace(INLINE_CODE_PATTERN, '$1')
    .replace(URL_PATTERN, '链接')
    .replace(EMOJI_PATTERN, '')
    .replace(SENTENCE_END_BEFORE_ELLIPSIS_PATTERN, '$1')
    .replace(TRAILING_ELLIPSIS_PATTERN, '。')
    .replace(ELLIPSIS_PATTERN, '，')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/([。！？!?]){3,}/g, '$1$1')
    .replace(/([，,、]){2,}/g, '$1')
    .replace(/([。！？!?])([，,、])/g, '$1')
    .replace(/([，,、])([。！？!?])/g, '$2')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/([（(])\s+/g, '$1')
    .replace(/\s+([）)])/g, '$1')
    .trim()
}
