import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type {
  ElectronButlerReminderDeliveryAttempt,
  ElectronButlerReminderDuePayload,
  ElectronButlerReminderNotificationPolicy,
} from '../../../../shared/eventa'
import type { ButlerTaskService } from '../butler-tasks'
import type { ButlerReminderDueEvent, ButlerReminderSchedulerReason, ButlerReminderSchedulerTask } from './scheduler'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain, Notification, powerMonitor } from 'electron'

import { electronButlerReminderDue, electronButlerRemindersSync } from '../../../../shared/eventa'
import { attemptButlerNativeReminderNotification } from './notification'
import { createButlerReminderScheduler } from './scheduler'

type ButlerReminderEventContext = ReturnType<typeof createContext>['context']

export interface ButlerReminderService {
  dispose: () => void
  scan: (reason: ButlerReminderSchedulerReason) => void
  syncTasks: (tasks: ButlerReminderSchedulerTask[], notificationPolicy?: ElectronButlerReminderNotificationPolicy, notificationTitle?: string) => void
}

export function createButlerReminderService(params: {
  attemptNativeNotification?: (task: ButlerReminderSchedulerTask, policy: ElectronButlerReminderNotificationPolicy, triggeredAt: number, title: string) => ElectronButlerReminderDeliveryAttempt
  context: ButlerReminderEventContext
  emitDue?: (payload: ElectronButlerReminderDuePayload) => void
  initialTasks?: ButlerReminderSchedulerTask[]
  notificationTitle?: string
  now?: () => number
  taskService?: Pick<ButlerTaskService, 'recordReminderDeliveryAttempt'>
}): ButlerReminderService {
  const notifiedKeys = new Set<string>()
  let notificationPolicy: ElectronButlerReminderNotificationPolicy | undefined
  let notificationTitle = params.notificationTitle ?? 'Wuwiii'
  const attemptNativeNotification = params.attemptNativeNotification ?? ((task, policy, triggeredAt, title) => {
    return attemptButlerNativeReminderNotification({
      Notification,
      notifiedKeys,
      now: () => triggeredAt,
      policy,
      task,
      title,
    })
  })

  function persistDeliveryAttempts(deliveryAttempts: ElectronButlerReminderDeliveryAttempt[]) {
    for (const attempt of deliveryAttempts) {
      const write = params.taskService?.recordReminderDeliveryAttempt(attempt.taskId, {
        attemptedAt: attempt.attemptedAt,
        dueAt: attempt.dueAt,
        status: attempt.status,
      })
      if (write)
        void Promise.resolve(write).catch(error => console.warn('[ButlerReminderService] Failed to persist reminder delivery attempt:', error))
    }
  }

  function emitDueEvent(event: ButlerReminderDueEvent) {
    const currentNotificationPolicy = notificationPolicy
    const deliveryAttempts = currentNotificationPolicy
      ? event.tasks.map(task => attemptNativeNotification(task, currentNotificationPolicy, event.triggeredAt, notificationTitle))
      : []
    if (deliveryAttempts.length > 0)
      persistDeliveryAttempts(deliveryAttempts)

    const payload: ElectronButlerReminderDuePayload = {
      reason: event.reason,
      taskIds: event.taskIds,
      tasks: event.tasks.map(task => ({ ...task })),
      triggeredAt: event.triggeredAt,
    }
    if (deliveryAttempts.length > 0)
      payload.deliveryAttempts = deliveryAttempts

    if (params.emitDue)
      params.emitDue(payload)
    else
      params.context.emit(electronButlerReminderDue, payload)
  }

  const scheduler = createButlerReminderScheduler({
    now: params.now,
    onDue: emitDueEvent,
  })

  function scan(reason: ButlerReminderSchedulerReason) {
    if (!notificationPolicy)
      return

    scheduler.scan(reason)
  }

  const scanAfterResume = () => scan('resume')
  powerMonitor.on('resume', scanAfterResume)
  powerMonitor.on('unlock-screen', scanAfterResume)

  const watchdog = setInterval(scan, 60_000, 'watchdog')
  watchdog.unref()

  if (params.initialTasks?.length)
    scheduler.syncTasks(params.initialTasks, { scan: false })

  function dispose() {
    clearInterval(watchdog)
    powerMonitor.off('resume', scanAfterResume)
    powerMonitor.off('unlock-screen', scanAfterResume)
    scheduler.dispose()
  }

  return {
    dispose,
    scan,
    syncTasks(tasks, nextNotificationPolicy, nextNotificationTitle) {
      if (nextNotificationPolicy)
        notificationPolicy = nextNotificationPolicy
      if (nextNotificationTitle)
        notificationTitle = nextNotificationTitle
      scheduler.syncTasks(tasks, { scan: !!notificationPolicy })
    },
  }
}

export function createButlerReminderHandlers(params: {
  context: ButlerReminderEventContext
  service: ButlerReminderService
}) {
  defineInvokeHandler(params.context, electronButlerRemindersSync, (payload) => {
    params.service.syncTasks(payload?.tasks ?? [], payload?.notificationPolicy, payload?.notificationTitle)
  })
}

export function setupButlerReminderService(options?: {
  eventTargets?: BrowserWindow[]
  initialTasks?: ButlerReminderSchedulerTask[]
  sourceWindow?: BrowserWindow
  taskService?: Pick<ButlerTaskService, 'recordReminderDeliveryAttempt'>
}) {
  const sourceContext = createElectronContext(ipcMain, options?.sourceWindow)
  const targetContexts = (options?.eventTargets ?? [])
    .filter(window => window !== options?.sourceWindow)
    .map(window => createElectronContext(ipcMain, window))
  const service = createButlerReminderService({
    context: sourceContext.context,
    emitDue: options?.eventTargets?.length
      ? payload => [sourceContext, ...targetContexts].forEach(({ context }) => context.emit(electronButlerReminderDue, payload))
      : undefined,
    initialTasks: options?.initialTasks,
    taskService: options?.taskService,
  })
  createButlerReminderHandlers({ context: sourceContext.context, service })

  return {
    ...service,
    dispose() {
      service.dispose()
      sourceContext.dispose()
      for (const targetContext of targetContexts)
        targetContext.dispose()
    },
  }
}
