import type { ButlerTask, ButlerTaskKind } from '../../stores/butler-tasks'

export type ButlerHolidayTone = 'major' | 'soft'
export interface ButlerHoliday {
  id: string
  tone: ButlerHolidayTone
}
export interface ButlerAgendaDay {
  day: string
  holiday?: ButlerHoliday
  isToday: boolean
  key: string
  month: string
  taskCount: number
  taskKindCounts: Record<ButlerTaskKind, number>
  timestamp: number
  weekday: string
}

const FIXED_HOLIDAYS: Record<string, ButlerHoliday> = {
  '01-01': { id: 'new-year', tone: 'major' },
  '02-14': { id: 'valentine', tone: 'soft' },
  '03-08': { id: 'womens-day', tone: 'soft' },
  '05-01': { id: 'labor-day', tone: 'major' },
  '06-01': { id: 'childrens-day', tone: 'soft' },
  '10-01': { id: 'national-day-cn', tone: 'major' },
  '10-31': { id: 'halloween', tone: 'soft' },
  '12-24': { id: 'christmas-eve', tone: 'soft' },
  '12-25': { id: 'christmas', tone: 'soft' },
}

const LUNAR_HOLIDAYS: Record<string, ButlerHoliday> = {
  '1-1': { id: 'spring-festival', tone: 'major' },
  '1-15': { id: 'lantern-festival', tone: 'soft' },
  '5-5': { id: 'dragon-boat', tone: 'major' },
  '7-7': { id: 'qixi', tone: 'soft' },
  '8-15': { id: 'mid-autumn', tone: 'major' },
  '9-9': { id: 'double-ninth', tone: 'soft' },
}

const chineseCalendarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  day: 'numeric',
  month: 'numeric',
})

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function isSameLocalDay(leftTimestamp: number, rightTimestamp: number) {
  const left = new Date(leftTimestamp)
  const right = new Date(rightTimestamp)
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function getLunarMonthDayKey(date: Date) {
  const parts = chineseCalendarFormatter.formatToParts(date)
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  if (!month || !day)
    return undefined

  return `${month}-${day}`
}

function taskKind(task: Pick<ButlerTask, 'kind'>): ButlerTaskKind {
  return task.kind ?? 'reminder'
}

export function getButlerHolidayForDate(date: Date): ButlerHoliday | undefined {
  const fixedHoliday = FIXED_HOLIDAYS[`${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`]
  if (fixedHoliday)
    return fixedHoliday

  const lunarKey = getLunarMonthDayKey(date)
  return lunarKey ? LUNAR_HOLIDAYS[lunarKey] : undefined
}

export function createButlerAgendaDays(params: {
  days?: number
  now: number
  tasks: ButlerTask[]
}): ButlerAgendaDay[] {
  const firstDay = new Date(params.now)
  firstDay.setHours(0, 0, 0, 0)

  return Array.from({ length: params.days ?? 7 }, (_, index) => {
    const date = new Date(firstDay)
    date.setDate(firstDay.getDate() + index)
    const timestamp = date.getTime()
    const taskKindCounts: Record<ButlerTaskKind, number> = {
      alarm: 0,
      reminder: 0,
      timer: 0,
    }

    for (const task of params.tasks) {
      if (!isSameLocalDay(task.dueAt, timestamp))
        continue

      taskKindCounts[taskKind(task)] += 1
    }

    return {
      day: new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(timestamp),
      holiday: getButlerHolidayForDate(date),
      isToday: index === 0,
      key: formatLocalDateKey(date),
      month: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(timestamp),
      taskCount: taskKindCounts.alarm + taskKindCounts.reminder + taskKindCounts.timer,
      taskKindCounts,
      timestamp,
      weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(timestamp),
    }
  })
}
