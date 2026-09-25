import type { ElectronButlerReminderDeliveryAttempt } from '../../../../shared/eventa'

import { describe, expect, it, vi } from 'vitest'

import { electronButlerReminderDue } from '../../../../shared/eventa'

const electronEventaMocks = vi.hoisted(() => ({
  createContext: vi.fn(),
}))

vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: electronEventaMocks.createContext,
}))

vi.mock('electron', () => ({
  ipcMain: {},
  Notification: {
    isSupported: vi.fn(() => false),
  },
  powerMonitor: {
    off: vi.fn(),
    on: vi.fn(),
  },
}))

describe('butler reminder service', () => {
  it('hydrates persisted tasks without emitting before renderer notification policy sync', async () => {
    const { createButlerReminderService } = await import('./index')
    const dueAt = Date.now() - 1_000
    const attemptNativeNotification = vi.fn((task, _policy, triggeredAt): ElectronButlerReminderDeliveryAttempt => ({
      attemptedAt: triggeredAt,
      dueAt: task.dueAt,
      nativeNotificationResult: 'shown',
      status: 'delivered',
      taskId: task.id,
    }))
    const context = { emit: vi.fn() }

    const service = createButlerReminderService({
      attemptNativeNotification,
      context: context as never,
      initialTasks: [
        { dueAt, id: 'persisted-task', status: 'open' },
      ],
    })

    expect(context.emit).not.toHaveBeenCalled()
    expect(attemptNativeNotification).not.toHaveBeenCalled()

    service.scan('resume')

    expect(context.emit).not.toHaveBeenCalled()
    expect(attemptNativeNotification).not.toHaveBeenCalled()

    service.syncTasks([{
      dueAt,
      id: 'persisted-task',
      status: 'open',
    }], {
      doNotDisturb: false,
      muted: false,
      quietHoursEnabled: false,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    })

    expect(context.emit).toHaveBeenCalledWith(electronButlerReminderDue, {
      deliveryAttempts: [{
        attemptedAt: expect.any(Number),
        dueAt,
        nativeNotificationResult: 'shown',
        status: 'delivered',
        taskId: 'persisted-task',
      }],
      reason: 'sync',
      taskIds: ['persisted-task'],
      tasks: [{ dueAt, id: 'persisted-task', status: 'open' }],
      triggeredAt: expect.any(Number),
    })
    expect(attemptNativeNotification).toHaveBeenCalledTimes(1)

    service.dispose()
  })

  it('emits and persists main-process native notification delivery attempts', async () => {
    const { createButlerReminderService } = await import('./index')
    const dueAt = new Date('2026-07-07T10:00:00+08:00').getTime()
    const triggeredAt = dueAt + 1_000
    const context = { emit: vi.fn() }
    const emitDue = vi.fn()
    const recordReminderDeliveryAttempt = vi.fn()
    const deliveryAttempt: ElectronButlerReminderDeliveryAttempt = {
      attemptedAt: triggeredAt,
      dueAt,
      nativeNotificationResult: 'shown',
      status: 'delivered',
      taskId: 'task-1',
    }
    const service = createButlerReminderService({
      attemptNativeNotification: vi.fn(() => deliveryAttempt),
      context: context as never,
      emitDue,
      now: () => triggeredAt,
      notificationTitle: 'AIRI Reminder',
      taskService: {
        recordReminderDeliveryAttempt,
      },
    })

    service.syncTasks([{
      dueAt,
      id: 'task-1',
      note: 'Bring the notebook.',
      status: 'open',
      title: 'Meeting',
    }], {
      doNotDisturb: false,
      muted: false,
      quietHoursEnabled: false,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    })

    expect(emitDue).toHaveBeenCalledWith({
      deliveryAttempts: [{
        attemptedAt: triggeredAt,
        dueAt,
        nativeNotificationResult: 'shown',
        status: 'delivered',
        taskId: 'task-1',
      }],
      reason: 'sync',
      taskIds: ['task-1'],
      tasks: [{
        dueAt,
        id: 'task-1',
        note: 'Bring the notebook.',
        status: 'open',
        title: 'Meeting',
      }],
      triggeredAt,
    })
    expect(context.emit).not.toHaveBeenCalled()
    expect(recordReminderDeliveryAttempt).toHaveBeenCalledWith('task-1', {
      attemptedAt: triggeredAt,
      dueAt,
      status: 'delivered',
    })

    service.dispose()
  })

  it('delivers one due event to both the Butler source and main renderer targets', async () => {
    const { setupButlerReminderService } = await import('./index')
    const dueAt = Date.now() - 1_000
    const task = { dueAt, id: 'dual-target-task', kind: 'timer' as const, status: 'open' as const, title: 'Tea' }
    const mainWindow = { id: 'main' }
    const butlerWindow = { id: 'butler' }
    const sourceContext = {
      context: { emit: vi.fn(), off: vi.fn(), on: vi.fn() },
      dispose: vi.fn(),
    }
    const mainTargetContext = {
      context: { emit: vi.fn(), off: vi.fn(), on: vi.fn() },
      dispose: vi.fn(),
    }
    electronEventaMocks.createContext.mockReset()
    electronEventaMocks.createContext.mockImplementation((_ipcMain, window) => (
      window === butlerWindow ? sourceContext : mainTargetContext
    ))

    const service = setupButlerReminderService({
      eventTargets: [mainWindow, butlerWindow] as never[],
      initialTasks: [task],
      sourceWindow: butlerWindow as never,
    })
    service.syncTasks([task], {
      doNotDisturb: false,
      muted: true,
      quietHoursEnabled: false,
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
    })

    const expectedPayload = expect.objectContaining({
      reason: 'sync',
      taskIds: ['dual-target-task'],
      tasks: [task],
      triggeredAt: expect.any(Number),
    })
    expect(sourceContext.context.emit).toHaveBeenCalledOnce()
    expect(sourceContext.context.emit).toHaveBeenCalledWith(electronButlerReminderDue, expectedPayload)
    expect(mainTargetContext.context.emit).toHaveBeenCalledOnce()
    expect(mainTargetContext.context.emit).toHaveBeenCalledWith(electronButlerReminderDue, expectedPayload)

    service.dispose()
    expect(sourceContext.dispose).toHaveBeenCalledOnce()
    expect(mainTargetContext.dispose).toHaveBeenCalledOnce()
  })
})
