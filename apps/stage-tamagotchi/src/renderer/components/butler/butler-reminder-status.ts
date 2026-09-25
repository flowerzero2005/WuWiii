import type { ButlerTask } from '../../stores/butler-tasks'

export type ButlerReminderDeliveryNotice = 'blocked' | 'failed'

export function getButlerReminderDeliveryNotice(
  task: Pick<ButlerTask, 'dueAt' | 'reminderDeliveryDueAt' | 'reminderDeliveryStatus' | 'status'>,
): ButlerReminderDeliveryNotice | undefined {
  if (task.status !== 'open')
    return undefined

  if (task.reminderDeliveryDueAt !== task.dueAt)
    return undefined

  if (task.reminderDeliveryStatus === 'blocked' || task.reminderDeliveryStatus === 'failed')
    return task.reminderDeliveryStatus
}
