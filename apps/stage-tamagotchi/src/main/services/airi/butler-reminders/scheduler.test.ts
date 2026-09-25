import { describe, expect, it, vi } from 'vitest'

import { collectDueButlerReminderTasks, createButlerReminderScheduler, resolveNextButlerReminderDelay } from './scheduler'

describe('butler reminder scheduler', () => {
  it('collects overdue open reminders once per due time', () => {
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()
    const emittedKeys = new Set<string>()

    const due = collectDueButlerReminderTasks([
      { id: 'late', dueAt: now - 1_000, status: 'open' },
      { id: 'done', dueAt: now - 1_000, status: 'done' },
      { id: 'future', dueAt: now + 1_000, status: 'open' },
    ], now, emittedKeys)

    expect(due.map(task => task.id)).toEqual(['late'])
    expect(emittedKeys.has(`${'late'}:${now - 1_000}`)).toBe(true)
    expect(collectDueButlerReminderTasks([
      { id: 'late', dueAt: now - 1_000, status: 'open' },
    ], now, emittedKeys)).toEqual([])
  })

  it('skips paused timers and blocked delivery attempts for the same due time', () => {
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()

    expect(collectDueButlerReminderTasks([
      { id: 'paused', dueAt: now - 1_000, status: 'open', timerPausedAt: now - 10_000 },
      {
        id: 'blocked',
        dueAt: now - 1_000,
        status: 'open',
        reminderDeliveryDueAt: now - 1_000,
        reminderDeliveryStatus: 'blocked',
      },
      {
        id: 'failed',
        dueAt: now - 1_000,
        status: 'open',
        reminderDeliveryDueAt: now - 1_000,
        reminderDeliveryStatus: 'failed',
      },
    ], now).map(task => task.id)).toEqual([])
  })

  it('allows failed or blocked deliveries to retry after the due time changes', () => {
    const oldDueAt = new Date('2026-07-07T10:00:00+08:00').getTime()
    const nextDueAt = oldDueAt + 5 * 60_000

    expect(collectDueButlerReminderTasks([
      {
        id: 'rescheduled',
        dueAt: nextDueAt,
        status: 'open',
        reminderDeliveryDueAt: oldDueAt,
        reminderDeliveryStatus: 'failed',
      },
    ], nextDueAt + 1).map(task => task.id)).toEqual(['rescheduled'])
  })

  it('caps far future scheduling delay so clock changes are rechecked', () => {
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()

    expect(resolveNextButlerReminderDelay([
      { id: 'future', dueAt: now + 5 * 60_000, status: 'open' },
    ], now, 60_000)).toBe(60_000)

    expect(resolveNextButlerReminderDelay([
      { id: 'soon', dueAt: now + 10_000, status: 'open' },
    ], now, 60_000)).toBe(10_000)
  })

  it('emits due reminders on sync and resume scans', () => {
    const dueAt = new Date('2026-07-07T10:00:00+08:00').getTime()
    const now = vi.fn(() => dueAt + 1_000)
    const onDue = vi.fn()
    const scheduler = createButlerReminderScheduler({ now, onDue })

    scheduler.syncTasks([{ id: 'late', dueAt, status: 'open' }])

    expect(onDue).toHaveBeenCalledWith({
      reason: 'sync',
      tasks: [{ id: 'late', dueAt, status: 'open' }],
      taskIds: ['late'],
      triggeredAt: dueAt + 1_000,
    })

    scheduler.scan('resume')

    expect(onDue).toHaveBeenCalledTimes(1)
  })
})
