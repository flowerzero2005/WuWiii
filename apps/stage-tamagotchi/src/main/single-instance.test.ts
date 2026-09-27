import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { setupSingleInstance } from './single-instance'

const mainEntrypoint = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

function createApp(lockAcquired: boolean) {
  let secondInstanceListener: (() => void) | undefined
  const app = {
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'second-instance')
        secondInstanceListener = listener
    }),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => lockAcquired),
  }

  return {
    app,
    emitSecondInstance: () => secondInstanceListener?.(),
  }
}

describe('desktop single-instance startup', () => {
  it('keeps the primary instance and delegates later launches to its activation owner', () => {
    const { app, emitSecondInstance } = createApp(true)
    const singleInstance = setupSingleInstance(app)
    const activate = vi.fn()

    singleInstance.setActivationOwner(activate)
    emitSecondInstance()

    expect(singleInstance.isPrimary).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    expect(activate).toHaveBeenCalledOnce()
  })

  it('quits a secondary instance without registering an activation listener', () => {
    const { app } = createApp(false)

    const singleInstance = setupSingleInstance(app)

    expect(singleInstance.isPrimary).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('replays one pending activation after the primary main window becomes available', () => {
    const { app, emitSecondInstance } = createApp(true)
    const singleInstance = setupSingleInstance(app)
    const activate = vi.fn()

    emitSecondInstance()
    emitSecondInstance()
    singleInstance.setActivationOwner(activate)

    expect(activate).toHaveBeenCalledOnce()
  })

  it('claims the lock before primary-only startup and activates through the main window owner', () => {
    const lockIndex = mainEntrypoint.indexOf('setupSingleInstance(app)')
    const screenCaptureIndex = mainEntrypoint.indexOf('initScreenCaptureForMain({ onDiagnostic: desktopDiagnostics.record })')
    const readyIndex = mainEntrypoint.indexOf('app.whenReady().then')

    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(screenCaptureIndex).toBeGreaterThan(lockIndex)
    expect(readyIndex).toBeGreaterThan(screenCaptureIndex)
    expect(mainEntrypoint).toContain('if (singleInstance.isPrimary)\n  initScreenCaptureForMain({ onDiagnostic: desktopDiagnostics.record })')
    expect(mainEntrypoint).toContain('singleInstance.isPrimary && app.whenReady().then')
    expect(mainEntrypoint).toContain('singleInstance.setActivationOwner(() => toggleWindowShow(mainWindow))')
  })
})
