export const SLOW_WINDOW_OPERATION_THRESHOLD_MS = 8

export interface SlowWindowOperationDiagnostic {
  details?: Record<string, unknown>
  elapsedMs: number
  op: string
  title?: string
}

export function warnIfSlowWindowOperation(params: SlowWindowOperationDiagnostic) {
  const elapsedMs = Math.round(params.elapsedMs)
  if (elapsedMs < SLOW_WINDOW_OPERATION_THRESHOLD_MS)
    return

  console.warn('[WindowPerf] slow window operation', {
    elapsedMs,
    op: params.op,
    ...(params.title ? { title: params.title } : {}),
    ...params.details,
  })
}

export function getWindowTitleForDiagnostics(window: { getTitle: () => string }) {
  try {
    return window.getTitle()
  }
  catch {
    return undefined
  }
}
