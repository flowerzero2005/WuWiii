import type { App, BrowserWindow, Details, RenderProcessGoneDetails } from 'electron'

import { Buffer } from 'node:buffer'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { release } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { arch, platform, versions } from 'node:process'

import { normalizeDesktopRendererCapabilities } from '../../../shared/desktop-capabilities'

const MAX_DIAGNOSTIC_BYTES = 1024 * 1024
const MAX_TEXT_LENGTH = 2000
const REGEXP_META_RE = /[.*+?^${}()|[\]\\]/g
const BEARER_RE = /\bbearer\s+[\w.~+/=-]+/gi
const SECRET_VALUE_RE = /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret)(\s*[=:]\s*)([^\s,;]+)/gi
const SECRET_KEY_RE = /^(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)$/i
const NATIVE_RENDERER_FAILURE_RE = /^(?:Uncaught|Failed to load resource)/i

export interface DesktopDiagnosticEntry {
  at: string
  details?: Record<string, unknown>
  event: string
}

export interface DesktopDiagnostics {
  logFile: string
  exportCopy: (destination: string) => boolean
  record: (event: string, details?: Record<string, unknown>) => void
  recordRendererCapabilities: (value: unknown) => boolean
}

function escapeRegExp(value: string) {
  return value.replace(REGEXP_META_RE, '\\$&')
}

export function redactDesktopDiagnosticText(value: string, privateRoots: string[] = []) {
  let redacted = value

  for (const root of [...privateRoots].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(root), 'gi'), '<private-path>')
  }

  redacted = redacted
    .replace(BEARER_RE, 'Bearer <redacted>')
    .replace(SECRET_VALUE_RE, '$1$2<redacted>')

  return redacted.slice(0, MAX_TEXT_LENGTH)
}

function sanitizeDesktopDiagnosticValue(value: unknown, privateRoots: string[], key?: string): unknown {
  if (key && SECRET_KEY_RE.test(key))
    return '<redacted>'
  if (typeof value === 'string')
    return redactDesktopDiagnosticText(value, privateRoots)
  if (Array.isArray(value))
    return value.map(item => sanitizeDesktopDiagnosticValue(item, privateRoots))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeDesktopDiagnosticValue(entryValue, privateRoots, entryKey)]),
    )
  }
  return value
}

export function redactDesktopDiagnosticUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:')
      return `file:///<private-path>/${basename(url.pathname)}`

    return `${url.protocol}//${url.host}${url.pathname}`
  }
  catch {
    return '<invalid-url>'
  }
}

export function createDesktopDiagnosticWriter(params: {
  logFile: string
  maxBytes?: number
  privateRoots?: string[]
}) {
  const maxBytes = params.maxBytes ?? MAX_DIAGNOSTIC_BYTES
  mkdirSync(dirname(params.logFile), { recursive: true })

  return (event: string, details?: Record<string, unknown>) => {
    const sanitizedDetails = details
      ? sanitizeDesktopDiagnosticValue(details, params.privateRoots ?? []) as Record<string, unknown>
      : undefined
    const line = `${JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...(sanitizedDetails ? { details: sanitizedDetails } : {}),
    } satisfies DesktopDiagnosticEntry)}\n`

    if (existsSync(params.logFile) && statSync(params.logFile).size + Buffer.byteLength(line) > maxBytes)
      truncateSync(params.logFile, 0)

    appendFileSync(params.logFile, line, 'utf8')
  }
}

function getWindowTitle(window: BrowserWindow) {
  try {
    return window.getTitle()
  }
  catch {
    return undefined
  }
}

function attachWindowDiagnostics(window: BrowserWindow, record: DesktopDiagnostics['record']) {
  const webContentsId = window.webContents.id
  const windowDetails = () => ({
    title: getWindowTitle(window),
    webContentsId,
  })
  let firstRendererErrorRecorded = false

  record('window-created', windowDetails())
  window.once('ready-to-show', () => record('window-ready-to-show', windowDetails()))
  window.webContents.once('dom-ready', () => record('renderer-dom-ready', windowDetails()))
  window.webContents.once('did-finish-load', () => record('renderer-did-finish-load', windowDetails()))
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    record('renderer-did-fail-load', {
      ...windowDetails(),
      errorCode,
      errorDescription,
      isMainFrame,
      url: redactDesktopDiagnosticUrl(validatedURL),
    })
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    record('preload-error', {
      ...windowDetails(),
      errorName: error.name,
      message: error.message,
      preload: basename(preloadPath),
    })
  })
  window.webContents.on('console-message', (details) => {
    // Only persist native uncaught/load failures. General console errors can
    // contain user chat or provider payloads and must stay out of this log.
    if (firstRendererErrorRecorded || details.level !== 'error' || !NATIVE_RENDERER_FAILURE_RE.test(details.message))
      return

    firstRendererErrorRecorded = true
    record('renderer-first-error', {
      ...windowDetails(),
      lineNumber: details.lineNumber,
      message: details.message,
      sourceUrl: redactDesktopDiagnosticUrl(details.sourceId),
    })
  })
}

export function setupDesktopDiagnostics(electronApp: App, options?: { angleBackend?: string }): DesktopDiagnostics {
  let logFile = ''
  let write: ReturnType<typeof createDesktopDiagnosticWriter> | undefined
  try {
    const logsPath = electronApp.getPath('logs')
    logFile = join(logsPath, 'desktop-startup.jsonl')
    write = createDesktopDiagnosticWriter({
      logFile,
      privateRoots: [electronApp.getPath('home'), electronApp.getPath('userData'), logsPath],
    })
  }
  catch (error) {
    console.error('[DesktopDiagnostics] Failed to initialize persistent diagnostics:', error)
  }
  const record: DesktopDiagnostics['record'] = (event, details) => {
    if (!write)
      return

    try {
      write(event, details)
    }
    catch (error) {
      console.error('[DesktopDiagnostics] Failed to persist diagnostic event:', event, error)
    }
  }

  record('startup', {
    angleBackend: options?.angleBackend ?? 'chromium-default',
    appVersion: electronApp.getVersion(),
    packaged: electronApp.isPackaged,
    platform,
    architecture: arch,
    osRelease: release(),
    electronVersion: versions.electron ?? 'unavailable',
    chromiumVersion: versions.chrome ?? 'unavailable',
  })
  electronApp.on('browser-window-created', (_event, window) => attachWindowDiagnostics(window, record))
  electronApp.on('child-process-gone', (_event, details: Details) => {
    record('child-process-gone', {
      exitCode: details.exitCode,
      name: details.name,
      reason: details.reason,
      serviceName: details.serviceName,
      type: details.type,
    })
  })
  electronApp.on('render-process-gone', (_event, webContents, details: RenderProcessGoneDetails) => {
    record('render-process-gone', {
      exitCode: details.exitCode,
      reason: details.reason,
      url: redactDesktopDiagnosticUrl(webContents.getURL()),
      webContentsId: webContents.id,
    })
  })

  const exportCopy = (destination: string) => {
    if (!logFile || !existsSync(logFile))
      return false

    // Entries are sanitized before they reach the source file, so exporting a
    // byte-for-byte snapshot cannot expose data excluded by the writer.
    copyFileSync(logFile, destination)
    return true
  }

  const recordRendererCapabilities = (value: unknown) => {
    const capabilities = normalizeDesktopRendererCapabilities(value)
    if (!capabilities)
      return false
    record('renderer-capabilities', { ...capabilities })
    return true
  }

  return { exportCopy, logFile, record, recordRendererCapabilities }
}
