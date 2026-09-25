export type PersonaLanguagePolicySource = 'user-request' | 'persona-preference' | 'message-language' | 'ui-locale'

export interface PersonaLanguagePolicy {
  readonly source: PersonaLanguagePolicySource
  readonly targetLanguage: string
}

export interface ResolvePersonaLanguagePolicyInput {
  message: string
  personaPreferredLanguage?: string
  uiLocale?: string
  userRequestedLanguage?: string
}

const LANGUAGE_ALIASES: Record<string, string> = {
  'arabic': 'ar',
  'chinese': 'zh-Hans',
  'english': 'en',
  'french': 'fr',
  'german': 'de',
  'japanese': 'ja',
  'korean': 'ko',
  'simplified chinese': 'zh-Hans',
  'spanish': 'es',
  'traditional chinese': 'zh-Hant',
  '中文': 'zh-Hans',
  '日语': 'ja',
  '日語': 'ja',
  '英文': 'en',
  '英语': 'en',
  '英語': 'en',
  '韩语': 'ko',
  '韓語': 'ko',
}

/** Normalizes common language names and BCP 47 tags for prompt/runtime consumers. */
export function normalizePersonaLanguage(value?: string) {
  const candidate = value?.trim()
  if (!candidate)
    return undefined

  const alias = LANGUAGE_ALIASES[candidate.toLocaleLowerCase()]
  if (alias)
    return alias

  try {
    return Intl.getCanonicalLocales(candidate)[0]
  }
  catch {
    return undefined
  }
}

/** Detects the main writing system without using UI or speech configuration as a proxy. */
export function detectMessageLanguage(message: string) {
  const counts = [
    ['ja', message.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0],
    ['ko', message.match(/\p{Script=Hangul}/gu)?.length ?? 0],
    ['zh-Hans', message.match(/\p{Script=Han}/gu)?.length ?? 0],
    ['ru', message.match(/\p{Script=Cyrillic}/gu)?.length ?? 0],
    ['ar', message.match(/\p{Script=Arabic}/gu)?.length ?? 0],
    ['hi', message.match(/\p{Script=Devanagari}/gu)?.length ?? 0],
    ['th', message.match(/\p{Script=Thai}/gu)?.length ?? 0],
    ['en', message.match(/\p{Script=Latin}+/gu)?.length ?? 0],
  ] as const

  const [language, count] = counts.reduce((best, current) => current[1] > best[1] ? current : best)
  return count > 0 ? language : undefined
}

/** Resolves one native-generation target language for the entire chat turn. */
export function resolvePersonaLanguagePolicy(input: ResolvePersonaLanguagePolicyInput): PersonaLanguagePolicy {
  const candidates = [
    ['user-request', normalizePersonaLanguage(input.userRequestedLanguage)],
    ['persona-preference', normalizePersonaLanguage(input.personaPreferredLanguage)],
    ['message-language', detectMessageLanguage(input.message)],
    ['ui-locale', normalizePersonaLanguage(input.uiLocale) ?? 'en'],
  ] as const

  for (const [source, targetLanguage] of candidates) {
    if (targetLanguage)
      return Object.freeze({ source, targetLanguage })
  }

  return Object.freeze({ source: 'ui-locale', targetLanguage: 'en' })
}
