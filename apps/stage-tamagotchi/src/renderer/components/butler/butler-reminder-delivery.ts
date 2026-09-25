export type ButlerNativeNotificationResult = 'denied' | 'duplicate' | 'failed' | 'requested' | 'shown' | 'suppressed' | 'unavailable'

export type ButlerReminderDeliveryAttemptStatus = 'blocked' | 'delivered' | 'failed' | 'pending'

export function resolveReminderDeliveryAttemptStatus(input: {
  aiReminderAvailable: boolean
  nativeNotificationResult: ButlerNativeNotificationResult
}): ButlerReminderDeliveryAttemptStatus {
  if (input.nativeNotificationResult === 'shown'
    || input.nativeNotificationResult === 'requested'
    || input.nativeNotificationResult === 'duplicate') {
    return 'delivered'
  }

  if (input.aiReminderAvailable)
    return 'pending'

  if (input.nativeNotificationResult === 'suppressed')
    return 'blocked'

  return 'failed'
}
