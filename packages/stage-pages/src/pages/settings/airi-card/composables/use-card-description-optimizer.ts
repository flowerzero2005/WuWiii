import type { ChatProvider } from '@xsai-ext/providers/utils'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { performWebSearch } from '@proj-airi/stage-ui/tools/web-search'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

interface CardDescriptionOptimizerOptions {
  getDescription: () => string
  getName: () => string
  getNickname?: () => string
  logLabel: string
  setDescription: (value: string) => void
}

const TERM_EDGE_CHARS = new Set('"\'`《》「」『』【】（）()[]{}.,，。:：;；!?！？')
const TERM_BOUNDARY_CHARS = new Set('"\'`《》「」『』【】（）()[]{}.,，。;；!?！？')
const TERM_CONNECTOR_CHARS = ['·', '・', ':', '：', '/', '／', '-', '_']
const RESEARCH_CUE_WORDS = ['像', '参考', '类似', '借鉴', '来自', '想要', '希望']
const RESEARCH_SUFFIX_WORDS = ['一样', '那样', '这种', '这样的', '风格', '类型', '人设', '角色', '人物', '气质', '的']
const GENERIC_SEARCH_TERMS = new Set([
  'assistant',
  'character',
  'default',
  'description',
  'persona',
  'personality',
  'prompt',
  'role',
  'scenario',
  'system',
  'user',
])
const GENERIC_CJK_SEARCH_TERMS = new Set([
  '可爱',
  '内向',
  '外向',
  '少女',
  '少年',
  '温柔',
  '活泼',
  '那种',
  '这样',
  '这样的',
])

export function useCardDescriptionOptimizer(options: CardDescriptionOptimizerOptions) {
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const { activeProvider: consciousnessProvider, activeModel: defaultConsciousnessModel } = storeToRefs(consciousnessStore)

  const descriptionOptimizeWithWeb = ref(false)
  const descriptionResearchWithWeb = ref(false)
  const isOptimizingDescription = ref(false)

  function extractSearchTermsForDescriptionOptimization(input: string, options: { includeResearchCues?: boolean, maxTerms?: number } = {}) {
    const maxTerms = options.maxTerms ?? 3
    const seen = new Set<string>()
    const uniqueTerms: string[] = []

    function addTerm(value: string | undefined) {
      const term = normalizeSearchTerm(value)
      if (!term || term.length < 2 || term.length > 40)
        return
      if (GENERIC_SEARCH_TERMS.has(term.toLowerCase()))
        return
      if (GENERIC_CJK_SEARCH_TERMS.has(term))
        return

      const key = term.toLowerCase()
      if (seen.has(key))
        return

      seen.add(key)
      uniqueTerms.push(term)
    }

    const delimiterPairs: Array<[string, string]> = [
      ['《', '》'],
      ['「', '」'],
      ['『', '』'],
      ['`', '`'],
      ['"', '"'],
    ]
    for (const [open, close] of delimiterPairs) {
      scanDelimitedTerms(input, open, close, addTerm)
      if (uniqueTerms.length >= maxTerms)
        return uniqueTerms
    }

    if (options.includeResearchCues) {
      scanResearchCueTerms(input, addTerm)
      if (uniqueTerms.length >= maxTerms)
        return uniqueTerms
    }

    const tokens = tokenizeSearchCandidates(input)
    for (let index = 0; index < tokens.length; index++) {
      const titleCasePhrase = collectTitleCasePhrase(tokens, index)
      if (titleCasePhrase) {
        addTerm(titleCasePhrase.term)
        index = titleCasePhrase.endIndex
        if (uniqueTerms.length >= maxTerms)
          return uniqueTerms
      }

      const token = tokens[index]
      if (isLikelyStandaloneSearchTerm(token)) {
        addTerm(token)
        if (uniqueTerms.length >= maxTerms)
          return uniqueTerms
      }
    }

    return uniqueTerms
  }

  function normalizeSearchTerm(value: string | undefined) {
    if (!value)
      return ''

    let start = 0
    let end = value.length
    while (start < end && (value[start].trim() === '' || TERM_EDGE_CHARS.has(value[start])))
      start++
    while (end > start && (value[end - 1].trim() === '' || TERM_EDGE_CHARS.has(value[end - 1])))
      end--

    return value
      .slice(start, end)
      .split(/\s+/g)
      .join(' ')
      .trim()
  }

  function scanDelimitedTerms(input: string, open: string, close: string, addTerm: (term: string) => void) {
    let searchStart = 0
    while (searchStart < input.length) {
      const openIndex = input.indexOf(open, searchStart)
      if (openIndex === -1)
        return

      const contentStart = openIndex + open.length
      const closeIndex = input.indexOf(close, contentStart)
      if (closeIndex === -1)
        return

      addTerm(input.slice(contentStart, closeIndex))
      searchStart = closeIndex + close.length
    }
  }

  function scanResearchCueTerms(input: string, addTerm: (term: string) => void) {
    for (const cue of RESEARCH_CUE_WORDS) {
      let searchStart = 0
      while (searchStart < input.length) {
        const cueIndex = input.indexOf(cue, searchStart)
        if (cueIndex === -1)
          break

        const contentStart = cueIndex + cue.length
        const candidate = readCueCandidate(input, contentStart)
        addTerm(stripResearchSuffix(candidate))
        searchStart = contentStart + Math.max(candidate.length, 1)
      }
    }
  }

  function readCueCandidate(input: string, startIndex: number) {
    let result = ''

    for (let index = startIndex; index < input.length && result.length < 16; index++) {
      const char = input[index]
      if (char.trim() === '' || TERM_BOUNDARY_CHARS.has(char))
        break

      result += char
    }

    return result
  }

  function stripResearchSuffix(value: string) {
    let result = normalizeSearchTerm(value)

    for (let guard = 0; guard < 4; guard++) {
      const suffix = RESEARCH_SUFFIX_WORDS.find(item => result.endsWith(item))
      if (!suffix)
        break

      result = result.slice(0, -suffix.length)
    }

    return result
  }

  function tokenizeSearchCandidates(input: string) {
    const tokens: string[] = []
    let current = ''

    for (const char of input) {
      if (char.trim() === '' || TERM_BOUNDARY_CHARS.has(char)) {
        if (current)
          tokens.push(current)
        current = ''
        continue
      }

      current += char
    }

    if (current)
      tokens.push(current)

    return tokens
      .map(token => normalizeSearchTerm(token))
      .filter(token => token.length >= 2 && token.length <= 40)
  }

  function collectTitleCasePhrase(tokens: string[], startIndex: number) {
    if (!isTitleCaseAsciiWord(tokens[startIndex]))
      return undefined

    const parts = [tokens[startIndex]]
    let endIndex = startIndex
    for (let index = startIndex + 1; index < tokens.length && parts.length < 4; index++) {
      if (!isTitleCaseAsciiWord(tokens[index]))
        break

      parts.push(tokens[index])
      endIndex = index
    }

    return parts.length >= 2
      ? {
          endIndex,
          term: parts.join(' '),
        }
      : undefined
  }

  function isLikelyStandaloneSearchTerm(term: string) {
    if (TERM_CONNECTOR_CHARS.some(char => term.includes(char)))
      return true
    if (!hasAsciiLetter(term))
      return false
    if (hasAsciiDigit(term))
      return true
    if (hasInternalUppercase(term))
      return true

    return isAllCapsAsciiTerm(term)
  }

  function isTitleCaseAsciiWord(value: string) {
    if (value.length < 2)
      return false
    if (!isAsciiUppercase(value[0]))
      return false

    return Array.from(value.slice(1)).every(char => isAsciiLowercase(char))
  }

  function hasAsciiLetter(value: string) {
    return [...value].some(char => isAsciiLowercase(char) || isAsciiUppercase(char))
  }

  function hasAsciiDigit(value: string) {
    return [...value].some(char => char >= '0' && char <= '9')
  }

  function hasInternalUppercase(value: string) {
    return Array.from(value.slice(1)).some(char => isAsciiUppercase(char))
  }

  function isAllCapsAsciiTerm(value: string) {
    const letters = [...value].filter(char => isAsciiLowercase(char) || isAsciiUppercase(char))
    return letters.length >= 2 && letters.every(isAsciiUppercase)
  }

  function isAsciiLowercase(char: string) {
    return char >= 'a' && char <= 'z'
  }

  function isAsciiUppercase(char: string) {
    return char >= 'A' && char <= 'Z'
  }

  async function buildDescriptionOptimizationWebContext(description: string) {
    const shouldResearch = descriptionResearchWithWeb.value
    if (!descriptionOptimizeWithWeb.value && !shouldResearch)
      return ''

    const searchTerms = extractSearchTermsForDescriptionOptimization(description, {
      includeResearchCues: shouldResearch,
      maxTerms: shouldResearch ? 6 : 3,
    })
    if (searchTerms.length === 0)
      return ''

    const results: string[] = []
    for (const term of searchTerms) {
      const result = await performWebSearch({
        maxResults: shouldResearch ? 5 : 3,
        query: term,
        searchDepth: shouldResearch ? 'advanced' : 'basic',
      })
      if (!result.success)
        continue

      const snippets = result.results
        .slice(0, shouldResearch ? 3 : 2)
        .map(item => `- ${item.title}: ${item.snippet}`.slice(0, shouldResearch ? 460 : 320))
      if (snippets.length > 0)
        results.push(`${shouldResearch ? 'Research term' : 'Search term'}: ${term}\n${snippets.join('\n')}`)
    }

    return results.join('\n\n')
  }

  async function handleOptimizeDescriptionWithCurrentModel() {
    if (isOptimizingDescription.value)
      return

    const sourceDescription = options.getDescription().trim()
    if (!sourceDescription)
      return

    const providerName = consciousnessProvider.value
    const model = defaultConsciousnessModel.value
    if (!providerName || !model)
      return

    try {
      isOptimizingDescription.value = true
      const provider = await providersStore.getProviderInstance<ChatProvider>(providerName)
      if (!provider?.chat)
        return

      const { generateText } = await import('@xsai/generate-text')
      const webContext = await buildDescriptionOptimizationWebContext(sourceDescription)
      const providerConfig = providersStore.getProviderConfig(providerName)
      const providerConfigObject = typeof providerConfig === 'object' && providerConfig !== null
        ? providerConfig as Record<string, any>
        : {}
      const chatConfig = provider.chat(model)
      const response = await generateText({
        ...chatConfig,
        ...providerConfigObject,
        headers: {
          ...chatConfig.headers,
          ...(typeof providerConfigObject.headers === 'object' && providerConfigObject.headers !== null
            ? providerConfigObject.headers
            : {}),
        },
        messages: [
          {
            role: 'system',
            content: [
              'You help users write character-card descriptions for Wuwiii.',
              'Rewrite the user draft into a clear, useful main description that can later be split into a modular persona package.',
              'Write in the same primary language as the user draft.',
              'Do not output JSON. Output only the polished description text.',
              'Do not split the answer into persona package fields yet; this is still the main character-card description.',
              'Keep concrete facts from the user. Do not invent unsupported backstory, relationships, powers, or private memories.',
              'If web context is provided, use it only to clarify named works, characters, terms, or references; do not turn the description into a wiki summary.',
              'If web context includes research references, extract reusable character, world, motif, tone, and style signals. Do not copy plot summaries or source wording.',
              'Do not import original-work relationships, plot endings, trauma, factions, powers, or world facts as this character\'s lived experience unless the user explicitly wrote them as this character\'s facts.',
              'Do not turn example dialogue into required openings, fixed endings, catchphrases, or customer-service scripts.',
              'Make the result suitable for fields like identity, personality, scenario boundaries, response boundaries, and writing style.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `Character name: ${options.getName()}`,
              options.getNickname?.() ? `Nickname: ${options.getNickname?.()}` : '',
              '',
              'User draft description:',
              sourceDescription,
              webContext ? `\nOptional web context for proper noun clarification and reference research:\n${webContext}` : '',
            ].filter(Boolean).join('\n'),
          },
        ],
        model,
        temperature: 0.35,
      })

      const optimizedDescription = String(response.text ?? '').trim()
      if (optimizedDescription)
        options.setDescription(optimizedDescription.replace(/^```(?:text)?/, '').replace(/```$/, '').trim())
    }
    catch (error) {
      console.error(`[${options.logLabel}] Failed to optimize description:`, error)
    }
    finally {
      isOptimizingDescription.value = false
    }
  }

  return {
    descriptionOptimizeWithWeb,
    descriptionResearchWithWeb,
    handleOptimizeDescriptionWithCurrentModel,
    isOptimizingDescription,
  }
}
