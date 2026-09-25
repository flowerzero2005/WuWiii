import type {
  ElectronButlerReminderDeliveryAttempt,
  ElectronButlerReminderNativeNotificationResult,
  ElectronButlerReminderNotificationPolicy,
} from '../../../../shared/eventa'
import type { ButlerReminderSchedulerTask } from './scheduler'

export type ButlerReminderNotificationSuppressionReason = 'do-not-disturb' | 'muted' | 'quiet-hours'

interface ButlerReminderNotificationConstructorOptions {
  body?: string
  silent?: boolean
  timeoutType?: 'default' | 'never'
  title?: string
}

interface ButlerReminderNotificationInstance {
  show: () => void
}

interface ButlerReminderNotificationApi {
  isSupported: () => boolean
}

function clockInputToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match)
    return undefined

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
    return undefined

  return hours * 60 + minutes
}

function isTimestampInQuietHours(policy: ElectronButlerReminderNotificationPolicy, timestamp: number) {
  if (!policy.quietHoursEnabled)
    return false

  const start = clockInputToMinutes(policy.quietHoursStart) ?? 22 * 60
  const end = clockInputToMinutes(policy.quietHoursEnd) ?? 8 * 60
  if (start === end)
    return false

  const date = new Date(timestamp)
  const current = date.getHours() * 60 + date.getMinutes()
  return start < end
    ? current >= start && current < end
    : current >= start || current < end
}

function createNotificationKey(task: Pick<ButlerReminderSchedulerTask, 'dueAt' | 'id'>) {
  return `${task.id}:${task.dueAt}`
}

function resolveNativeNotificationDeliveryStatus(nativeNotificationResult: ElectronButlerReminderNativeNotificationResult) {
  if (nativeNotificationResult === 'shown' || nativeNotificationResult === 'requested' || nativeNotificationResult === 'duplicate')
    return 'delivered'
  if (nativeNotificationResult === 'suppressed')
    return 'blocked'
  return 'failed'
}

export function resolveButlerReminderNotificationSuppressionReason(
  policy: ElectronButlerReminderNotificationPolicy,
  now = Date.now(),
): ButlerReminderNotificationSuppressionReason | undefined {
  if (policy.muted)
    return 'muted'
  if (policy.doNotDisturb)
    return 'do-not-disturb'
  if (isTimestampInQuietHours(policy, now))
    return 'quiet-hours'
}

export function attemptButlerNativeReminderNotification(input: {
  Notification: ButlerReminderNotificationApi
  notifiedKeys: Set<string>
  now?: () => number
  policy: ElectronButlerReminderNotificationPolicy
  task: ButlerReminderSchedulerTask
  title: string
}): ElectronButlerReminderDeliveryAttempt {
  const attemptedAt = input.now?.() ?? Date.now()
  const key = createNotificationKey(input.task)
  let nativeNotificationResult: ElectronButlerReminderNativeNotificationResult

  if (input.notifiedKeys.has(key)) {
    nativeNotificationResult = 'duplicate'
  }
  else if (resolveButlerReminderNotificationSuppressionReason(input.policy, attemptedAt)) {
    nativeNotificationResult = 'suppressed'
  }
  else if (!input.Notification.isSupported()) {
    nativeNotificationResult = 'unavailable'
  }
  else {
    try {
      const NotificationConstructor = input.Notification as unknown as new(options: ButlerReminderNotificationConstructorOptions) => ButlerReminderNotificationInstance
      const notification = new NotificationConstructor({
        body: input.task.note ? `${input.task.title ?? input.task.id}\n${input.task.note}` : input.task.title ?? input.task.id,
        silent: false,
        timeoutType: 'default',
        title: input.title,
      })
      notification.show()
      input.notifiedKeys.add(key)
      nativeNotificationResult = 'shown'
    }
    catch {
      nativeNotificationResult = 'failed'
    }
  }

  return {
    attemptedAt,
    dueAt: input.task.dueAt,
    nativeNotificationResult,
    status: resolveNativeNotificationDeliveryStatus(nativeNotificationResult),
    taskId: input.task.id,
  }
}
