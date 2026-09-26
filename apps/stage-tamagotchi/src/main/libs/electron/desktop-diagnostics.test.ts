import type { App } from 'electron'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDesktopDiagnosticWriter,
  redactDesktopDiagnosticText,
  redactDesktopDiagnosticUrl,
  setupDesktopDiagnostics,
} from './desktop-diagnostics'

describe('desktop startup diagnostics', () => {
  let root = ''

  afterEach(() => {
    if (root)
      rmSync(root, { force: true, recursive: true })
    root = ''
  })

  it('redacts secrets, private paths, and URL query values', () => {
    expect(redactDesktopDiagnosticText(
      'C:\\Users\\alice\\AIRI token=abc123 Authorization: Bearer secret-token',
      ['C:\\Users\\alice'],
    )).toBe('<private-path>\\AIRI token=<redacted> Authorization: Bearer <redacted>')
    expect(redactDesktopDiagnosticUrl('file:///C:/Users/alice/AIRI/out/renderer/index.html?token=secret#/settings'))
      .toBe('file:///<private-path>/index.html')
    expect(redactDesktopDiagnosticUrl('https://example.test/app.js?token=secret#frame'))
      .toBe('https://example.test/app.js')

    root = mkdtempSync(join(tmpdir(), 'airi-desktop-redaction-'))
    const logFile = join(root, 'desktop-startup.jsonl')
    const write = createDesktopDiagnosticWriter({ logFile })
    write('provider-error', { apiKey: 'secret-value', message: 'token=secret-value' })
    expect(JSON.parse(readFileSync(logFile, 'utf8'))).toMatchObject({
      details: { apiKey: '<redacted>', message: 'token=<redacted>' },
    })
  })

  it('persists bounded JSON lines and keeps the newest event after rotation', () => {
    root = mkdtempSync(join(tmpdir(), 'airi-desktop-diagnostics-'))
    const logFile = join(root, 'desktop-startup.jsonl')
    const write = createDesktopDiagnosticWriter({ logFile, maxBytes: 220 })

    write('startup', { message: 'x'.repeat(120) })
    write('renderer-first-error', { message: 'y'.repeat(120) })

    const entries = readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'renderer-first-error',
      details: { message: 'y'.repeat(120) },
    })
  })

  it('exports only the sanitized persisted snapshot', () => {
    root = mkdtempSync(join(tmpdir(), 'airi-desktop-export-'))
    const logsPath = join(root, 'logs')
    const diagnostics = setupDesktopDiagnostics({
      getPath: (name: string) => name === 'logs' ? logsPath : join(root, name),
      getVersion: () => 'test',
      isPackaged: true,
      on: () => undefined,
    } as unknown as App)
    diagnostics.record('provider-error', { apiKey: 'secret-value' })
    const report = { version: 1, webAssemblyValidated: true, wasmSimdValidated: false, webGlAvailable: true, webGl2Available: false, workerConstructorAvailable: true, audioWorkletConstructorAvailable: false, desktopScreenCaptureBridgeAvailable: true, displayMediaApiAvailable: false }
    expect(diagnostics.recordRendererCapabilities({ ...report, deviceName: 'private-device', username: 'private-user' })).toBe(true)
    expect(diagnostics.recordRendererCapabilities({ ...report, wasmSimdValidated: 'invalid' })).toBe(false)

    const destination = join(root, 'airi-diagnostics.jsonl')
    expect(diagnostics.exportCopy(destination)).toBe(true)
    expect(readFileSync(destination, 'utf8')).toContain('"apiKey":"<redacted>"')
    expect(readFileSync(destination, 'utf8')).not.toContain('secret-value')
    const exported = readFileSync(destination, 'utf8')
    expect(exported).not.toContain('private-device')
    expect(exported).not.toContain('private-user')
    expect(exported).toContain('"event":"renderer-capabilities"')
    expect(JSON.parse(exported.split('\n')[0])).toMatchObject({ details: { architecture: expect.any(String), osRelease: expect.any(String), electronVersion: expect.any(String), chromiumVersion: expect.any(String) } })
  })
})
