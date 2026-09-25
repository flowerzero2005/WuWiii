import { describe, expect, it } from 'vitest'

import { getButlerReminderDeliveryNotice } from './butler-reminder-status'

describe('butler reminder status', () => {
  it('shows blocked or failed only for the current due time', () => {
    expect(getButlerReminderDeliveryNotice({
      dueAt: 100,
      reminderDeliveryDueAt: 100,
      reminderDeliveryStatus: 'blocked',
      status: 'open',
    })).toBe('blocked')

    expect(getButlerReminderDeliveryNotice({
      dueAt: 100,
      reminderDeliveryDueAt: 100,
      reminderDeliveryStatus: 'failed',
      status: 'open',
    })).toBe('failed')

    expect(getButlerReminderDeliveryNotice({
      dueAt: 200,
      reminderDeliveryDueAt: 100,
      reminderDeliveryStatus: 'failed',
      status: 'open',
    })).toBeUndefined()
  })

  it('does not show delivery notices for completed or delivered reminders', () => {
    expect(getButlerReminderDeliveryNotice({
      dueAt: 100,
      reminderDeliveryDueAt: 100,
      reminderDeliveryStatus: 'blocked',
      status: 'done',
    })).toBeUndefined()

    expect(getButlerReminderDeliveryNotice({
      dueAt: 100,
      reminderDeliveryDueAt: 100,
      reminderDeliveryStatus: 'delivered',
      status: 'open',
    })).toBeUndefined()
  })
})
