import { describe, expect, it } from 'vitest'

import { isLatestDesktopUpdateStatus } from './about-update-status'

describe('about update status', () => {
  it('shows latest only after a completed no-update check', () => {
    expect(isLatestDesktopUpdateStatus('not-available')).toBe(true)
    expect(isLatestDesktopUpdateStatus('idle')).toBe(false)
    expect(isLatestDesktopUpdateStatus('disabled')).toBe(false)
  })
})
