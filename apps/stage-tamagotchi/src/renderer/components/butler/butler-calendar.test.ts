import type { ButlerTask } from '../../stores/butler-tasks'

import { describe, expect, it } from 'vitest'

import { createButlerAgendaDays, getButlerHolidayForDate } from './butler-calendar'

function dateMs(date: string) {
  return new Date(`${date}T09:00:00+08:00`).getTime()
}

function task(id: string, dueAt: number, kind: ButlerTask['kind'] = 'reminder'): ButlerTask {
  return {
    id,
    createdAt: dueAt,
    dueAt,
    kind,
    status: 'open',
    title: id,
    updatedAt: dueAt,
  }
}

describe('butler calendar', () => {
  it('resolves fixed-date holidays', () => {
    expect(getButlerHolidayForDate(new Date('2026-10-01T09:00:00+08:00'))).toMatchObject({
      id: 'national-day-cn',
      tone: 'major',
    })
    expect(getButlerHolidayForDate(new Date('2026-12-25T09:00:00+08:00'))).toMatchObject({
      id: 'christmas',
      tone: 'soft',
    })
  })

  it('resolves Chinese lunar holidays through Intl Chinese calendar', () => {
    expect(getButlerHolidayForDate(new Date('2026-02-17T09:00:00+08:00'))).toMatchObject({
      id: 'spring-festival',
      tone: 'major',
    })
    expect(getButlerHolidayForDate(new Date('2026-09-25T09:00:00+08:00'))).toMatchObject({
      id: 'mid-autumn',
      tone: 'major',
    })
  })

  it('builds seven agenda days with task kind counts and holiday metadata', () => {
    const days = createButlerAgendaDays({
      days: 7,
      now: dateMs('2026-10-01'),
      tasks: [
        task('reminder', dateMs('2026-10-01'), 'reminder'),
        task('alarm', dateMs('2026-10-01'), 'alarm'),
        task('timer', dateMs('2026-10-03'), 'timer'),
      ],
    })

    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({
      holiday: { id: 'national-day-cn' },
      isToday: true,
      key: '2026-10-01',
      taskCount: 2,
      taskKindCounts: {
        alarm: 1,
        reminder: 1,
        timer: 0,
      },
    })
    expect(days[2]).toMatchObject({
      key: '2026-10-03',
      taskCount: 1,
      taskKindCounts: {
        alarm: 0,
        reminder: 0,
        timer: 1,
      },
    })
  })
})
