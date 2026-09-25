import { beforeEach, describe, expect, it, vi } from 'vitest'

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: posthog }))

describe('desktop analytics consent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not initialize analytics without a configured project key', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const {
      ANALYTICS_CONSENT_STORAGE_KEY,
      initializePosthogFromConsent,
      setAnalyticsConsent,
    } = await import('./posthog')

    expect(initializePosthogFromConsent(storage)).toBe(false)
    expect(posthog.init).not.toHaveBeenCalled()

    setAnalyticsConsent(true, storage)
    expect(values.get(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('true')
    expect(posthog.init).not.toHaveBeenCalled()

    setAnalyticsConsent(false, storage)
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled()

    setAnalyticsConsent(true, storage)
    expect(posthog.init).not.toHaveBeenCalled()
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled()
  })
})
