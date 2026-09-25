import { afterEach, describe, expect, it, vi } from 'vitest'

import { warnIfSlowWindowOperation } from './window-perf'

describe('window perf diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs only slow window operations', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    warnIfSlowWindowOperation({
      elapsedMs: 7,
      op: 'setBounds',
      title: 'AIRI Butler',
    })
    warnIfSlowWindowOperation({
      details: { rectCount: 32 },
      elapsedMs: 12,
      op: 'setShape',
      title: 'AIRI Butler',
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[WindowPerf] slow window operation', {
      elapsedMs: 12,
      op: 'setShape',
      rectCount: 32,
      title: 'AIRI Butler',
    })
  })
})
