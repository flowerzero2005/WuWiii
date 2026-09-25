export interface DesktopRegressionAttributableDiagnostic {
  kind: string
  windowId?: string
}

/** Assigns report-stable IDs without retaining closed BrowserWindow/Page objects. */
export function createDesktopRegressionWindowIds() {
  const ids = new WeakMap<object, string>()
  let nextId = 0

  function getWindowId(window: object) {
    let id = ids.get(window)
    if (!id) {
      nextId += 1
      id = `window-${nextId}`
      ids.set(window, id)
    }
    return id
  }

  return { getWindowId }
}

/** Route results include only diagnostics emitted by the Page currently under test. */
export function selectRouteDiagnostics<T extends DesktopRegressionAttributableDiagnostic>(events: T[], windowId: string) {
  return events.filter(event => (event.kind === 'console-error' || event.kind === 'page-error') && event.windowId === windowId)
}
