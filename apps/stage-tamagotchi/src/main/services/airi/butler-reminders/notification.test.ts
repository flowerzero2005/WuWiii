import { describe, expect, it, vi } from 'vitest'

import { attemptButlerNativeReminderNotification, resolveButlerReminderNotificationSuppressionReason } from './notification'

describe('butler reminder notification delivery', () => {
  it('suppresses native notifications when the synced Butler policy blocks them', () => {
    expect(resolveButlerReminderNotificationSuppressionReason({
      doNotDisturb: false,
      muted: true,
      quietHoursEnabled: false,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    }, new Date('2026-07-07T10:00:00+08:00').getTime())).toBe('muted')

    expect(resolveButlerReminderNotificationSuppressionReason({
      doNotDisturb: false,
      muted: false,
      quietHoursEnabled: true,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    }, new Date('2026-07-07T23:00:00+08:00').getTime())).toBe('quiet-hours')
  })

  it('shows one Electron notification per task due time', () => {
    const show = vi.fn()
    const notificationOptions: unknown[] = []
    class Notification {
      static isSupported = vi.fn(() => true)

      constructor(options: unknown) {
        notificationOptions.push(options)
      }

      show() {
        show()
      }
    }
    const notifiedKeys = new Set<string>()
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()

    const first = attemptButlerNativeReminderNotification({
      Notification,
      notifiedKeys,
      now: () => now,
      policy: {
        doNotDisturb: false,
        muted: false,
        quietHoursEnabled: false,
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
      },
      task: {
        dueAt: now,
        id: 'task-1',
        note: 'Bring the notebook.',
        status: 'open',
        title: 'Meeting',
      },
      title: 'AIRI Reminder',
    })

    const duplicate = attemptButlerNativeReminderNotification({
      Notification,
      notifiedKeys,
      now: () => now + 1,
      policy: {
        doNotDisturb: false,
        muted: false,
        quietHoursEnabled: false,
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
      },
      task: {
        dueAt: now,
        id: 'task-1',
        status: 'open',
        title: 'Meeting',
      },
      title: 'AIRI Reminder',
    })

    expect(first).toEqual({
      attemptedAt: now,
      dueAt: now,
      nativeNotificationResult: 'shown',
      status: 'delivered',
      taskId: 'task-1',
    })
    expect(notificationOptions).toEqual([{
      body: 'Meeting\nBring the notebook.',
      silent: false,
      timeoutType: 'default',
      title: 'AIRI Reminder',
    }])
    expect(show).toHaveBeenCalledTimes(1)
    expect(duplicate.nativeNotificationResult).toBe('duplicate')
    expect(duplicate.status).toBe('delivered')
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('records unavailable Electron notifications as failed attempts', () => {
    class Notification {
      static isSupported = vi.fn(() => false)
    }
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()

    expect(attemptButlerNativeReminderNotification({
      Notification,
      notifiedKeys: new Set<string>(),
      now: () => now,
      policy: {
        doNotDisturb: false,
        muted: false,
        quietHoursEnabled: false,
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
      },
      task: {
        dueAt: now - 1,
        id: 'task-1',
        status: 'open',
        title: 'Meeting',
      },
      title: 'AIRI Reminder',
    })).toEqual({
      attemptedAt: now,
      dueAt: now - 1,
      nativeNotificationResult: 'unavailable',
      status: 'failed',
      taskId: 'task-1',
    })
  })

  it('does not reserve a duplicate key when Electron notification creation fails', () => {
    class FailingNotification {
      static isSupported = vi.fn(() => true)

      constructor() {
        throw new Error('notification unavailable')
      }
    }
    const show = vi.fn()
    class WorkingNotification {
      static isSupported = vi.fn(() => true)

      show() {
        show()
      }
    }
    const notifiedKeys = new Set<string>()
    const now = new Date('2026-07-07T10:00:00+08:00').getTime()
    const task = {
      dueAt: now,
      id: 'task-1',
      status: 'open' as const,
      title: 'Meeting',
    }
    const policy = {
      doNotDisturb: false,
      muted: false,
      quietHoursEnabled: false,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    }

    const failed = attemptButlerNativeReminderNotification({
      Notification: FailingNotification,
      notifiedKeys,
      now: () => now,
      policy,
      task,
      title: 'AIRI Reminder',
    })
    const retry = attemptButlerNativeReminderNotification({
      Notification: WorkingNotification,
      notifiedKeys,
      now: () => now + 1,
      policy,
      task,
      title: 'AIRI Reminder',
    })

    expect(failed.nativeNotificationResult).toBe('failed')
    expect(failed.status).toBe('failed')
    expect(retry.nativeNotificationResult).toBe('shown')
    expect(retry.status).toBe('delivered')
    expect(show).toHaveBeenCalledTimes(1)
  })
})
