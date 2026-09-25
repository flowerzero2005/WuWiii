export interface DesktopRuntimeTimingMilestones {
  cdpConnectedAtMs?: number
  cleanupCompletedAtMs?: number
  cleanupStartedAtMs?: number
  mainWindowDetectedAtMs?: number
  mainWindowReadyAtMs?: number
  mainWindowVisibleAtMs?: number
  processSpawnedAtMs?: number
  routeChecksCompletedAtMs?: number
  routeChecksStartedAtMs?: number
  startedAtMs: number
  windowsCollectedAtMs?: number
}

function durationBetween(startedAtMs?: number, finishedAtMs?: number) {
  if (startedAtMs === undefined || finishedAtMs === undefined)
    return undefined

  return Math.max(0, finishedAtMs - startedAtMs)
}

/** Splits one L2 run into observable startup, route, window-inventory, and cleanup phases. */
export function createDesktopRuntimePhaseTiming(milestones: DesktopRuntimeTimingMilestones) {
  return {
    beforeProcessSpawnMs: durationBetween(milestones.startedAtMs, milestones.processSpawnedAtMs),
    processSpawnToCdpMs: durationBetween(milestones.processSpawnedAtMs, milestones.cdpConnectedAtMs),
    cdpToMainWindowDetectedMs: durationBetween(milestones.cdpConnectedAtMs, milestones.mainWindowDetectedAtMs),
    mainWindowDetectedToVisibleMs: durationBetween(milestones.mainWindowDetectedAtMs, milestones.mainWindowVisibleAtMs),
    mainWindowVisibleToReadyMs: durationBetween(milestones.mainWindowVisibleAtMs, milestones.mainWindowReadyAtMs),
    readyToRouteChecksMs: durationBetween(milestones.mainWindowReadyAtMs, milestones.routeChecksStartedAtMs),
    routeChecksMs: durationBetween(milestones.routeChecksStartedAtMs, milestones.routeChecksCompletedAtMs),
    auxiliaryWindowInventoryMs: durationBetween(milestones.routeChecksCompletedAtMs, milestones.windowsCollectedAtMs),
    cleanupMs: durationBetween(milestones.cleanupStartedAtMs, milestones.cleanupCompletedAtMs),
    totalMs: durationBetween(milestones.startedAtMs, milestones.cleanupCompletedAtMs),
  }
}

/** Keeps Vue navigation and its mounted-route assertion inside one route timeout budget. */
export function remainingDesktopRouteTimeout(startedAtMs: number, nowMs: number, timeoutMs: number) {
  const remainingMs = timeoutMs - Math.max(0, nowMs - startedAtMs)
  if (remainingMs <= 0)
    throw new Error(`Desktop route timeout budget of ${timeoutMs}ms was exhausted.`)

  return remainingMs
}
