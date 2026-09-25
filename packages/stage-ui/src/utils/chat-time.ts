import type { ChatHistoryItem } from '../types/chat'

export type ChatTimestampInput = Date | number | string | undefined | null

const DEFAULT_CHAT_TIMESTAMP_GAP_MS = 5 * 60 * 1000

const fixedDateNotes: Record<string, string> = {
  '1-1': 'New Year\'s Day / 元旦',
  '2-14': 'Valentine\'s Day / 情人节',
  '3-8': 'International Women\'s Day / 妇女节',
  '4-1': 'April Fools\' Day / 愚人节',
  '5-1': 'Labor Day / 劳动节',
  '5-4': 'Youth Day / 青年节',
  '6-1': 'Children\'s Day / 儿童节',
  '9-10': 'Teachers\' Day / 教师节',
  '10-1': 'National Day / 国庆节',
  '12-24': 'Christmas Eve / 平安夜',
  '12-25': 'Christmas Day / 圣诞节',
}

function toDate(input: ChatTimestampInput) {
  if (input == null)
    return undefined

  const date = input instanceof Date ? input : new Date(input)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return isSameLocalDay(date, yesterday)
}

export function formatClockTime(timestamp: ChatTimestampInput) {
  const date = toDate(timestamp)
  if (!date)
    return ''

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function formatChatTimestamp(timestamp: ChatTimestampInput, options?: { now?: Date }) {
  const date = toDate(timestamp)
  if (!date)
    return ''

  const now = options?.now ?? new Date()
  const clock = formatClockTime(date)

  if (isSameLocalDay(date, now))
    return clock

  if (isYesterday(date, now))
    return `昨天 ${clock}`

  if (date.getFullYear() === now.getFullYear())
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

export function formatLocalDateTime(timestamp: ChatTimestampInput) {
  const date = toDate(timestamp)
  if (!date)
    return ''

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${formatClockTime(date)}`
}

export function formatWeekday(timestamp: ChatTimestampInput) {
  const date = toDate(timestamp)
  if (!date)
    return ''

  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()] ?? ''
}

export function formatTimezoneOffset(timestamp: ChatTimestampInput = new Date()) {
  const date = toDate(timestamp) ?? new Date()
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

export function formatRelativeElapsed(from: ChatTimestampInput, to: ChatTimestampInput = new Date()) {
  const fromDate = toDate(from)
  const toDateValue = toDate(to)
  if (!fromDate || !toDateValue)
    return ''

  const elapsedMs = toDateValue.getTime() - fromDate.getTime()
  if (elapsedMs < 60 * 1000)
    return '刚刚'

  const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000))
  if (elapsedMinutes < 60)
    return `${elapsedMinutes} 分钟前`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24)
    return `${elapsedHours} 小时前`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays === 1)
    return '昨天'

  if (elapsedDays < 30)
    return `${elapsedDays} 天前`

  const elapsedMonths = Math.floor(elapsedDays / 30)
  if (elapsedMonths < 12)
    return `${elapsedMonths} 个月前`

  return `${Math.floor(elapsedMonths / 12)} 年前`
}

export function shouldShowChatTimestamp(
  current: ChatTimestampInput,
  previous?: ChatTimestampInput,
  thresholdMs = DEFAULT_CHAT_TIMESTAMP_GAP_MS,
) {
  const currentDate = toDate(current)
  if (!currentDate)
    return false

  const previousDate = toDate(previous)
  if (!previousDate)
    return true

  if (!isSameLocalDay(currentDate, previousDate))
    return true

  return currentDate.getTime() - previousDate.getTime() >= thresholdMs
}

export function getKnownDateNotes(timestamp: ChatTimestampInput = new Date()) {
  const date = toDate(timestamp) ?? new Date()
  const key = `${date.getMonth() + 1}-${date.getDate()}`
  const fixedDateNote = fixedDateNotes[key]
  return fixedDateNote ? [fixedDateNote] : []
}

export function findLastVisibleChatMessage(messages: ChatHistoryItem[] = []) {
  return [...messages].reverse().find((message) => {
    if (!message.createdAt)
      return false

    return message.role === 'user' || message.role === 'assistant'
  })
}
