import { beforeEach, describe, expect, it } from 'vitest'

import { resetSpeechFailureNoticeDedupe, shouldShowSpeechFailureNotice } from './speech-failure-notice'

beforeEach(resetSpeechFailureNoticeDedupe)

describe('speech failure notice dedupe', () => {
  it('suppresses the same short-lived notice inside the dedupe window', () => {
    expect(shouldShowSpeechFailureNotice('official', 10_000)).toBe(true)
    expect(shouldShowSpeechFailureNotice('official', 12_000)).toBe(false)
    expect(shouldShowSpeechFailureNotice('official', 15_001)).toBe(true)
  })

  it('keeps unrelated notice classes independent', () => {
    expect(shouldShowSpeechFailureNotice('official', 10_000)).toBe(true)
    expect(shouldShowSpeechFailureNotice('custom', 10_001)).toBe(true)
  })
})
