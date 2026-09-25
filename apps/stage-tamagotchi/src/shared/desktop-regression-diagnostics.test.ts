import { describe, expect, it } from 'vitest'

import { createDesktopRegressionWindowIds, selectRouteDiagnostics } from './desktop-regression-diagnostics'

describe('desktop regression diagnostics attribution', () => {
  it('keeps background and unassigned diagnostics global while attributing only the exercised window to a route', () => {
    const windowIds = createDesktopRegressionWindowIds()
    const currentWindow = {}
    const backgroundWindow = {}
    const currentWindowId = windowIds.getWindowId(currentWindow)
    const backgroundWindowId = windowIds.getWindowId(backgroundWindow)
    const diagnostics = [
      { kind: 'console-error', windowId: currentWindowId },
      { kind: 'page-error', windowId: backgroundWindowId },
      { kind: 'external-request' },
      { kind: 'request', windowId: currentWindowId },
      { kind: 'request-failed', windowId: currentWindowId },
    ]

    expect(selectRouteDiagnostics(diagnostics, currentWindowId)).toEqual([
      { kind: 'console-error', windowId: currentWindowId },
    ])
    expect(diagnostics).toHaveLength(5)
    expect(diagnostics).toContainEqual({ kind: 'page-error', windowId: backgroundWindowId })
    expect(diagnostics).toContainEqual({ kind: 'external-request' })
  })
})
