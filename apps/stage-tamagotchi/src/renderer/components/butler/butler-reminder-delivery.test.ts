import { describe, expect, it } from 'vitest'

import { resolveReminderDeliveryAttemptStatus } from './butler-reminder-delivery'

describe('butler reminder delivery', () => {
  it('treats shown native notifications as delivered when AI is unavailable', () => {
    expect(resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: false,
      nativeNotificationResult: 'shown',
    })).toBe('delivered')
  })

  it('does not treat denied or unavailable native notifications as delivered', () => {
    expect(resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: false,
      nativeNotificationResult: 'denied',
    })).toBe('failed')
    expect(resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: false,
      nativeNotificationResult: 'unavailable',
    })).toBe('failed')
  })

  it('records suppressed notifications as blocked instead of delivered', () => {
    expect(resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: false,
      nativeNotificationResult: 'suppressed',
    })).toBe('blocked')
  })

  it('lets the AI reminder path own delivery when it is available', () => {
    expect(resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: true,
      nativeNotificationResult: 'denied',
    })).toBe('pending')
  })
})
