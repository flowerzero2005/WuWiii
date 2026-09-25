import type { ButlerTaskComposerDraft } from '../stores/butler-tasks'

const reminderKeywords = ['提醒我', '叫我', '喊我', '设个闹钟', '定个闹钟', '加个待办', '创建待办', '记个待办', '计时', '闹钟', 'remind me', 'todo', 'timer', 'alarm', 'countdown']
const chineseDigitMap: Record<string, number> = {
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
  { pattern: new RegExp(`(${numberSource})分钟?(?:以?后)?`), multiplier: 60 * 1000 },
  { pattern: new RegExp(`(${numberSource})(?:小时|钟头)(?:以?后)?`), multiplier: 60 * 60 * 1000 },
  { pattern: new RegExp(`(${numberSource})[天日](?:以?后)?`), multiplier: 24 * 60 * 60 * 1000 },
] as const
const englishRelativeTimePattern = /\b(\d{1,4})\s*(minutes?|mins?|hours?|hrs?|days?)\b/i
const halfHourPattern = /半个?小时|半个?钟头/
const clockTimePattern = new RegExp(`(今天|明天|后天)?(早上|上午|中午|下午|晚上|晚间)?(${numberSource})[点:：](半|${numberSource})?`)

function parseNumber(value?: string) {
  if (!value)
    return undefined

  const normalized = value.trim()
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

  const digits: Array<number | undefined> = [...normalized].map(char => chineseDigitMap[char])
  if (digits.includes(undefined))
    return undefined

  return Number.parseInt(digits.join(''), 10)
}

function parseRelativeDueAt(text: string, now: number) {
  const compactText = text.replace(/\s+/g, '')
  const halfHourMatch = compactText.match(halfHourPattern)
  if (halfHourMatch)
    return now + 30 * 60 * 1000

  for (const { pattern, multiplier } of relativeTimePatterns) {
    const match = compactText.match(pattern)
    const value = parseNumber(match?.[1])
    if (value)
      return now + value * multiplier
  }

  const englishMatch = text.match(englishRelativeTimePattern)
  const englishValue = parseNumber(englishMatch?.[1])
  const englishUnit = englishMatch?.[2]?.toLocaleLowerCase()
  if (!englishValue || !englishUnit)
    return undefined

  if (englishUnit.startsWith('minute') || englishUnit.startsWith('min'))
    return now + englishValue * 60 * 1000

  if (englishUnit.startsWith('hour') || englishUnit.startsWith('hr'))
    return now + englishValue * 60 * 60 * 1000

  if (englishUnit.startsWith('day'))
    return now + englishValue * 24 * 60 * 60 * 1000

  return undefined
}

function parseClockDueAt(text: string, now: number) {
  const match = text.replace(/\s+/g, '').match(clockTimePattern)
  if (!match)
    return undefined

  const dayText = match[1]
  const periodText = match[2]
  const hour = parseNumber(match[3])
  const minute = match[4] === '半' ? 30 : parseNumber(match[4]) ?? 0
  if (hour === undefined || hour > 24 || minute > 59)
    return undefined

  let normalizedHour = hour
  if (['下午', '晚上', '晚间'].includes(periodText ?? '') && normalizedHour < 12)
    normalizedHour += 12
  if (periodText === '中午' && normalizedHour < 11)
    normalizedHour += 12

  const due = new Date(now)
  due.setSeconds(0, 0)
  due.setHours(normalizedHour, minute)

  if (dayText === '明天') {
    due.setDate(due.getDate() + 1)
  }
  else if (dayText === '后天') {
    due.setDate(due.getDate() + 2)
  }
  else if (!dayText && !periodText && hour <= 11) {
    const eveningDue = new Date(due)
    eveningDue.setHours(hour + 12, minute)
    if (eveningDue.getTime() > now) {
      return eveningDue.getTime()
    }
  }

  if (!dayText && due.getTime() <= now) {
    due.setDate(due.getDate() + 1)
  }

  return due.getTime()
}

function detectTaskKind(text: string): ButlerTaskComposerDraft['kind'] {
  const lowerText = text.toLocaleLowerCase()
  if (lowerText.includes('timer') || lowerText.includes('countdown') || text.includes('计时'))
    return 'timer'
  if (lowerText.includes('alarm') || text.includes('闹钟'))
    return 'alarm'

  return 'reminder'
}

function cleanTitle(text: string) {
  let cleaned = text
    .replace(/(?:请|麻烦|帮我)?(?:提醒我|叫我|喊我|到点叫我|设个闹钟|定个闹钟|加个待办|创建待办|记个待办|计时器?)/g, ' ')
    .replace(/\b(?:remind me|todo|timer|alarm|countdown|set|start)\b/gi, ' ')
    .replace(halfHourPattern, ' ')
    .replace(englishRelativeTimePattern, ' ')
    .replace(clockTimePattern, ' ')

  for (const { pattern } of relativeTimePatterns)
    cleaned = cleaned.replace(pattern, ' ')

  cleaned = cleaned
    .replace(/[，,。.!！?？；;：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || '提醒事项'
}

export function detectButlerTaskFallbackDraft(text: string, now = Date.now()): ButlerTaskComposerDraft | undefined {
  const normalized = text.trim()
  const lowerText = normalized.toLocaleLowerCase()
  if (!normalized || !reminderKeywords.some(keyword => lowerText.includes(keyword)))
    return undefined

  return {
    kind: detectTaskKind(normalized),
    title: cleanTitle(normalized),
    dueAt: parseRelativeDueAt(normalized, now) ?? parseClockDueAt(normalized, now) ?? now + 30 * 60 * 1000,
  }
}
