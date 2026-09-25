import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { AiriPersonaFingerprint } from '../modules/persona-package'
import type { DiaryEventCandidate } from './notebook'

import { buildPersonaFingerprintPromptSection } from '../modules/persona-package'

export interface CharacterDiaryGenerationResult {
  emotionalArc: {
    opening: string
    turningPoint: string
    closing: string
  }
  importantEvents: string[]
  preferenceNotes: string[]
  text: string
  title: string
}

export interface CharacterDiaryGenerationInput {
  chatProvider: ChatProvider
  events: DiaryEventCandidate[]
  headers?: Record<string, string>
  locale?: string
  model: string
  periodEnd: number
  periodStart: number
  personaName: string
  personaFingerprint?: AiriPersonaFingerprint
}

const DIARY_JSON_FENCE_START_RE = /^```(?:json)?\s*/i
const DIARY_JSON_FENCE_END_RE = /\s*```$/

function clipText(value: string, limit: number) {
  const trimmed = value.trim()
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit).trimEnd()
}

function extractJsonObjectText(value: string) {
  const withoutFence = value.trim()
    .replace(DIARY_JSON_FENCE_START_RE, '')
    .replace(DIARY_JSON_FENCE_END_RE, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : ''
}

function stringList(value: unknown, limit: number) {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => clipText(item, 240))
    .filter(Boolean)
    .slice(0, limit)
}

export function parseCharacterDiaryGenerationResult(rawText: string): CharacterDiaryGenerationResult | undefined {
  const jsonText = extractJsonObjectText(rawText)
  if (!jsonText) {
    // Diagnosis for silent diary drops: the model output had no JSON object at all.
    if (import.meta.env.DEV)
      console.warn('[CharacterDiary] parse failed: no JSON object found', { rawTextLength: rawText.length, rawText: rawText.slice(0, 500) })
    return undefined
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    if (parsed.shouldCreateDiary !== true)
      return undefined

    const title = typeof parsed.title === 'string' ? clipText(parsed.title, 80) : ''
    const text = typeof parsed.text === 'string' ? clipText(parsed.text, 4000) : ''
    const emotionalArc = parsed.emotionalArc && typeof parsed.emotionalArc === 'object'
      ? parsed.emotionalArc as Record<string, unknown>
      : {}
    if (!title || text.length < 30) {
      if (import.meta.env.DEV)
        console.warn('[CharacterDiary] parse failed: invalid payload', { titleLength: title.length, textLength: text.length, rawText: rawText.slice(0, 500) })
      return undefined
    }

    return {
      title,
      text,
      importantEvents: stringList(parsed.importantEvents, 8),
      preferenceNotes: stringList(parsed.preferenceNotes, 6),
      emotionalArc: {
        opening: typeof emotionalArc.opening === 'string' ? clipText(emotionalArc.opening, 160) : '',
        turningPoint: typeof emotionalArc.turningPoint === 'string' ? clipText(emotionalArc.turningPoint, 160) : '',
        closing: typeof emotionalArc.closing === 'string' ? clipText(emotionalArc.closing, 160) : '',
      },
    }
  }
  catch (error) {
    if (import.meta.env.DEV)
      console.warn('[CharacterDiary] parse failed: invalid JSON', { error, jsonText: jsonText.slice(0, 500) })
    return undefined
  }
}

function formatLocalDateTime(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function buildCharacterDiaryGenerationMessages(input: Omit<CharacterDiaryGenerationInput, 'chatProvider' | 'headers' | 'model'>): Message[] {
  const locale = input.locale || 'zh-CN'
  const eventPayload = input.events
    .filter(event => event.role === 'user' || event.role === 'assistant')
    .slice(-48)
    .map(event => ({
      id: event.id,
      role: event.role,
      occurredAt: formatLocalDateTime(event.createdAt ?? input.periodEnd, locale),
      text: clipText(event.text ?? '', 1000),
    }))
  const personaFingerprint = buildPersonaFingerprintPromptSection(input.personaFingerprint)

  return [
    {
      role: 'system',
      content: [
        `Write a private first-person diary entry as ${input.personaName || 'the active character'}.`,
        personaFingerprint,
        'The active persona fingerprint controls what this character notices, values, feels, and how directly they admit it. Do not replace it with a generic gentle diary voice.',
        'The diary is user-readable character writing, not analysis, chain-of-thought, a chat transcript, or an assistant summary.',
        'Use the main language of the supplied conversation.',
        // 文体（2026-08-28 第二十二轮）：深夜写给自己的手写日记质感，允许未完成的心绪、突然的联想、对某句话的反复咀嚼。
        'Voice it like a real handwritten diary written late at night to oneself, never a report written for an audience. Allow unfinished thoughts, sudden associations, and coming back again and again to one line from the day.',
        // 标题（2026-08-28 第二十二轮）：从情绪或具体瞬间取材，禁止流水账式标题。
        'The title must feel like a real diary title: draw it from the day\'s dominant mood or one concrete moment — an image, something the user said, a feeling that lingered. Never use ledger-style titles such as "today\'s conversation log", "today\'s diary", or "day N".',
        // 用户视角（2026-08-28 第二十二轮）：写用户当时说了什么、在角色心里激起了什么；基于证据揣测，不虚构用户未表达的想法。
        'The entry must show the user\'s side of the day: what the user actually said, and what that line or that tone stirred in the character — how the character reads the user\'s mood, what it worries about or feels glad about for the user. Ground every reading in conversation evidence; never invent thoughts the user never expressed. Speculating in the character\'s own inner voice ("I guess...", "it somehow seemed like...", "was it that...?") is allowed and encouraged.',
        // 事件丰富度（2026-08-28 第二十二轮）：覆盖多个不同互动瞬间，小事与大事并重。
        'Cover several different interaction moments from the day, not only the biggest one. Treat small things (a joke, a silence, a goodbye) as equal in weight to big ones. Write 3 to 6 natural paragraphs, each focused on a different moment or a shift in feeling.',
        'Treat the emotional arc as first-class: connect each change to a supplied event or remembered line, preserve residue across moments, and let turning points follow this persona rather than forcing a uniformly warm ending.',
        'Forbidden: play-by-play chronological retelling, plain-colloquial summarizing, empty lines like "we talked a lot today, so happy", AI-flavored objective description, and a moralizing or lesson-forcing ending.',
        'Stay faithful to the supplied events. Never invent an event, date, user preference, relationship milestone, promise, or hidden motive.',
        'Respect chronology and the supplied local timestamps. The diary may be generated every local calendar day.',
        'Ignore greetings, acknowledgements, system/tool activity, and repetitive filler when choosing what deserves ink.',
        'Decide whether the supplied day contains any meaningful, relationship-relevant, or otherwise useful shared moment. If not, set shouldCreateDiary to false and leave every other field empty; do not force a diary from filler or repetition.',
        'This diary belongs to the character and this specific user alone. Write about their shared moments, the nicknames or forms of address used between them, and the small details only the two of them would notice — the private bond of a companion, never a generic audience.',
        'Preference notes must be directly stated by the user or strongly supported by repeated conversation. Uncertain details must be omitted.',
        'Return only one JSON object with exactly these fields:',
        '{"shouldCreateDiary":true,"title":"string","text":"string","importantEvents":["string"],"preferenceNotes":["string"],"emotionalArc":{"opening":"string","turningPoint":"string","closing":"string"}}',
        'importantEvents should contain 3 to 8 concise, independently understandable facts covering different kinds of moments at different times; merge or drop near-identical items such as repeated greetings so homogeneous entries do not pad the list. Include a date or time phrase when it matters.',
        'emotionalArc describes the character emotion at the beginning, the meaningful turn, and the feeling left at the end. Use empty strings only when the evidence is absent.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        personaName: input.personaName,
        period: {
          start: formatLocalDateTime(input.periodStart, locale),
          end: formatLocalDateTime(input.periodEnd, locale),
        },
        events: eventPayload,
      }, null, 2),
    },
  ]
}

export async function generateCharacterDiary(input: CharacterDiaryGenerationInput) {
  const { generateText } = await import('@xsai/generate-text')
  const chatConfig = input.chatProvider.chat(input.model)
  const response = await generateText({
    ...chatConfig,
    headers: {
      ...chatConfig.headers,
      ...input.headers,
    },
    messages: buildCharacterDiaryGenerationMessages(input),
    model: input.model,
    temperature: 0.8,
  })

  return parseCharacterDiaryGenerationResult(String(response.text ?? ''))
}
