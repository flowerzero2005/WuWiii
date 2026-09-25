import { describe, expect, it } from 'vitest'

import {
  createDesktopRuntimePhaseTiming,
  remainingDesktopRouteTimeout,
} from './desktop-regression-runtime-timing'

describe('desktop runtime regression timing', () => {
  it('reports each observable runtime phase without folding route checks into startup', () => {
    expect(createDesktopRuntimePhaseTiming({
      startedAtMs: 1_000,
      processSpawnedAtMs: 2_000,
      cdpConnectedAtMs: 5_000,
      mainWindowDetectedAtMs: 5_500,
      mainWindowVisibleAtMs: 6_000,
      mainWindowReadyAtMs: 10_000,
      routeChecksStartedAtMs: 10_250,
      routeChecksCompletedAtMs: 30_250,
      windowsCollectedAtMs: 30_300,
      cleanupStartedAtMs: 30_350,
      cleanupCompletedAtMs: 31_000,
    })).toEqual({
      beforeProcessSpawnMs: 1_000,
      processSpawnToCdpMs: 3_000,
      cdpToMainWindowDetectedMs: 500,
      mainWindowDetectedToVisibleMs: 500,
      mainWindowVisibleToReadyMs: 4_000,
      readyToRouteChecksMs: 250,
      routeChecksMs: 20_000,
      auxiliaryWindowInventoryMs: 50,
      cleanupMs: 650,
      totalMs: 30_000,
    })
  })

  it('shares one timeout budget between Vue navigation and the mounted route probe', () => {
    expect(remainingDesktopRouteTimeout(1_000, 1_000, 30_000)).toBe(30_000)
    expect(remainingDesktopRouteTimeout(1_000, 16_000, 30_000)).toBe(15_000)
    expect(remainingDesktopRouteTimeout(1_000, 30_999, 30_000)).toBe(1)
    expect(() => remainingDesktopRouteTimeout(1_000, 31_000, 30_000)).toThrow('timeout budget')
    expect(() => remainingDesktopRouteTimeout(1_000, 35_000, 30_000)).toThrow('timeout budget')
  })
})
