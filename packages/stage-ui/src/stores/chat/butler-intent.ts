export type ButlerIntentKind = 'alarm' | 'reminder' | 'timer'
export type ButlerIntentConfidence = 'high' | 'needs-confirmation'

export interface ButlerIntentConfirmationCard {
  actions: ['确认', '修改', '取消']
  kindLabel: string
  timeLabel: string
  title: string
}

export interface ParsedButlerIntent {
  confidence: ButlerIntentConfidence
  confirmation: ButlerIntentConfirmationCard
  dueAt: number
  kind: ButlerIntentKind
  note?: string
  sourceText: string
  title: string
}

const chineseDigitMap: Partial<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const chineseNumberSource = '零〇一二两三四五六七八九十'
const numberSource = `\\d{1,4}|[${chineseNumberSource}]{1,4}`
const relativeTimePatterns = [
  { pattern: new RegExp(`(${numberSource})分钟?(?:以?后)`), multiplier: 60 * 1000 },
  { pattern: new RegExp(`(${numberSource})(?:小时|钟头)(?:以?后)`), multiplier: 60 * 60 * 1000 },
] as const
const clockTimePattern = new RegExp(`(今天|明天)?(早上|上午|下午|晚上)?(${numberSource})[点:：](半|${numberSource}(?:分)?)?`)

function parseChineseNumber(value?: string) {
  if (!value)
    return undefined

  const normalized = value.trim().replace(/分$/, '')
  if (/^\d+$/.test(normalized))
    return Number.parseInt(normalized, 10)

  if (normalized === '十')
    return 10

  const tenIndex = normalized.indexOf('十')
  if (tenIndex >= 0) {
    const tensText = normalized.slice(0, tenIndex)
    const onesText = normalized.slice(tenIndex + 1)
    const tens = tensText ? chineseDigitMap[tensText] : 1
    const ones = onesText ? chineseDigitMap[onesText] : 0
    if (tens === undefined || ones === undefined)
      return undefined

    return tens * 10 + ones
  }

  if (normalized.length === 1)
    return chineseDigitMap[normalized]

  const digits = [...normalized].map(char => chineseDigitMap[char])
  if (digits.includes(undefined))
    return undefined

  return Number.parseInt(digits.join(''), 10)
}

function parseRelativeDueAt(text: string, now: Date) {
  const compactText = text.replace(/\s+/g, '')
  for (const { pattern, multiplier } of relativeTimePatterns) {
    const match = compactText.match(pattern)
    const value = parseChineseNumber(match?.[1])
    if (value)
      return { dueAt: now.getTime() + value * multiplier, matchedText: match?.[0] ?? '', explicitDate: true }
  }

  return undefined
}

function parseClockDueAt(text: string, now: Date) {
  const compactText = text.replace(/\s+/g, '')
  const match = compactText.match(clockTimePattern)
  if (!match)
    return undefined

  const dayText = match[1]
  const periodText = match[2]
  const hour = parseChineseNumber(match[3])
  const minute = match[4] === '半' ? 30 : parseChineseNumber(match[4]) ?? 0
  if (hour === undefined || hour > 24 || minute > 59)
    return undefined

  let normalizedHour = hour
  if ((periodText === '下午' || periodText === '晚上') && normalizedHour < 12)
    normalizedHour += 12

  const due = new Date(now)
  due.setSeconds(0, 0)
  due.setHours(normalizedHour, minute)

  if (dayText === '明天')
    due.setDate(due.getDate() + 1)

  if (!dayText && due.getTime() <= now.getTime())
    due.setDate(due.getDate() + 1)

  return {
    dueAt: due.getTime(),
    explicitDate: Boolean(dayText || periodText),
    matchedText: match[0],
  }
}

function detectKind(text: string): ButlerIntentKind | undefined {
  if (/倒计时|计时/.test(text))
    return 'timer'
  if (/起床|叫醒|闹钟/.test(text))
    return 'alarm'
  if (/提醒我|提醒|叫我|喊我/.test(text))
    return 'reminder'

  return undefined
}

function cleanTitle(text: string, matchedTimeText: string, kind: ButlerIntentKind) {
  let cleaned = text
    .replace(matchedTimeText, ' ')
    .replace(/(?:请|麻烦|帮我)?(?:提醒我|叫我|喊我|叫醒我|叫醒|设个闹钟|定个闹钟|倒计时|计时器?|闹钟)/g, ' ')
    .replace(/^[我\s]+/, ' ')
    .replace(/[，,。.!！?？；;：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (kind === 'alarm' && /起床/.test(text))
    cleaned = cleaned.replace(/^(得|要|需要)\s*/, '').trim() || '起床'

  return cleaned || (kind === 'timer' ? '计时器' : kind === 'alarm' ? '闹钟' : '提醒事项')
}

function createConfirmationCard(input: Pick<ParsedButlerIntent, 'dueAt' | 'kind' | 'title'>): ButlerIntentConfirmationCard {
  const kindLabel = input.kind === 'alarm'
    ? '闹钟'
    : input.kind === 'timer'
      ? '计时器'
      : '提醒'

  return {
    actions: ['确认', '修改', '取消'],
    kindLabel,
    timeLabel: new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(input.dueAt),
    title: input.title,
  }
}

export function parseChineseButlerIntent(input: string, now: Date): ParsedButlerIntent | undefined {
  const sourceText = input.trim()
  if (!sourceText)
    return undefined

  const kind = detectKind(sourceText)
  if (!kind)
    return undefined

  const parsedTime = parseRelativeDueAt(sourceText, now) ?? parseClockDueAt(sourceText, now)
  if (!parsedTime)
    return undefined

  const title = cleanTitle(sourceText, parsedTime.matchedText, kind)
  const intent = {
    confidence: parsedTime.explicitDate ? 'high' : 'needs-confirmation',
    dueAt: parsedTime.dueAt,
    kind,
    sourceText,
    title,
  } satisfies Omit<ParsedButlerIntent, 'confirmation'>

  return {
    ...intent,
    confirmation: createConfirmationCard(intent),
  }
}
