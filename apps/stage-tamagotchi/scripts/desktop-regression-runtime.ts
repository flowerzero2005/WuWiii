import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process'

import type { Browser, BrowserContext, Page, Request } from 'playwright'

import type { DesktopRuntimeTimingMilestones } from '../src/shared/desktop-regression-runtime-timing'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

import { DESKTOP_REQUIRED_ROUTES } from '../src/shared/desktop-feature-manifest'
import { createDesktopRegressionWindowIds, isApplicationRuntimePageUrl, selectRouteDiagnostics } from '../src/shared/desktop-regression-diagnostics'
import { createDesktopRuntimePhaseTiming, remainingDesktopRouteTimeout } from '../src/shared/desktop-regression-runtime-timing'
import { startDesktopRegressionFixtureService } from './desktop-regression-loopback-service'

type DiagnosticKind = 'console-error' | 'external-request' | 'page-error' | 'request' | 'request-failed'

interface DiagnosticEvent {
  at: string
  detail?: string
  kind: DiagnosticKind
  method?: string
  route?: string
  url?: string
  windowId?: string
  windowUrl?: string
}

interface RouteResult {
  diagnostics: DiagnosticEvent[]
  durationMs: number
  modelRenderEvidence?: MainStageRenderEvidence
  probeMatched?: boolean
  route: string
  routeRootVisible?: boolean
  screenshot?: string
  status: 'failed' | 'passed'
  visibleElements?: number
}

interface MainStageRenderEvidence {
  canvasVisible: boolean
  error?: string
  loadedModelId?: string
  loadedModelUrl?: string
  modelIdentityMatches: boolean
  modelAttached: boolean
  modelIntersectsCanvas: boolean
  opaquePixels: number
  ready: boolean
  renderer?: string
  selectedModel?: string
  selectedModelUrl?: string
  state?: string
}

const DESKTOP_PORT = 5173
const CHANNEL_SERVER_PORT = 6121
const STARTUP_TIMEOUT_MS = 120_000
const ROUTE_TIMEOUT_MS = 30_000
const BEARER_TOKEN_REGEX = /\bbearer\s+[\w.~+/=-]+/gi
const HASH_PREFIX_REGEX = /^#/
const IP_LITERAL_BRACKETS_REGEX = /^\[|\]$/g
const LEADING_SLASH_REGEX = /^\//
const SECRET_ENVIRONMENT_NAME_REGEX = /api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|credential|password|private[_-]?key/i
const SECRET_TEXT_VALUE_REGEX = /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)/gi
const TEMPORARY_PROFILE_PREFIX = 'airi-desktop-runtime-'
const appRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appRoot, '../..')
const networkGuard = join(import.meta.dirname, 'desktop-regression-network-guard.mjs')
const desktopRendererOrigin = `http://localhost:${DESKTOP_PORT}`

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.replace(IP_LITERAL_BRACKETS_REGEX, '').toLowerCase()
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || normalized.startsWith('127.')
}

function sanitizeUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}${url.hash}`
  }
  catch {
    return '<invalid-url>'
  }
}

function currentRoute(page?: Page) {
  if (!page)
    return undefined

  try {
    return new URL(page.url()).hash.replace(HASH_PREFIX_REGEX, '') || '/'
  }
  catch {
    return undefined
  }
}

function createTextRedactor(privateRoot: string, sensitiveValues: string[]) {
  const secrets = sensitiveValues.filter(value => value.length >= 4).sort((a, b) => b.length - a.length)
  return (input: string) => {
    let output = privateRoot ? input.replaceAll(privateRoot, '<temporary-profile>') : input
    for (const secret of secrets)
      output = output.replaceAll(secret, '<redacted>')

    return output
      .replace(BEARER_TOKEN_REGEX, 'Bearer <redacted>')
      .replace(SECRET_TEXT_VALUE_REGEX, '$1$2<redacted>')
  }
}

async function reserveFreePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to reserve a loopback port.'))
        return
      }

      const port = address.port
      server.close(error => error ? reject(error) : resolvePort(port))
    })
  })
}

async function assertPortAvailable(port: number) {
  return await new Promise<void>((resolveAvailable, reject) => {
    const server = createNetServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Desktop runtime gate refused to start because port ${port} is already in use. The existing process was not stopped.`))
        return
      }
      reject(error)
    })
    server.listen({ port, exclusive: true }, () => {
      server.close(error => error ? reject(error) : resolveAvailable())
    })
  })
}

async function startDenyProxy(diagnostics: DiagnosticEvent[]) {
  const server = createHttpServer((request, response) => {
    const target = request.url ?? '<missing-url>'
    diagnostics.push({
      at: new Date().toISOString(),
      detail: 'blocked-by-loopback-deny-proxy',
      kind: 'external-request',
      method: request.method,
      url: sanitizeUrl(target),
    })
    response.writeHead(502, { 'content-type': 'text/plain' })
    response.end('External network blocked by desktop runtime regression gate.')
  })
  server.on('connect', (request, socket) => {
    diagnostics.push({
      at: new Date().toISOString(),
      detail: 'blocked-by-loopback-deny-proxy',
      kind: 'external-request',
      method: 'CONNECT',
      url: request.url ?? '<missing-target>',
    })
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListening)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Deny proxy did not bind a TCP port.')
  }

  return {
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    },
    port: address.port,
  }
}

async function resolveRuntimeExecutables() {
  const electronPackage = fileURLToPath(import.meta.resolve('electron/package.json'))
  const electronRoot = dirname(electronPackage)
  const executableRelativePath = (await readFile(join(electronRoot, 'path.txt'), 'utf8')).trim()
  const electronExecutable = realpathSync.native(join(electronRoot, 'dist', executableRelativePath))
  const electronVitePackage = fileURLToPath(import.meta.resolve('electron-vite/package.json'))
  const electronViteCli = join(dirname(electronVitePackage), 'bin', 'electron-vite.js')

  if (!existsSync(electronViteCli) || !existsSync(electronExecutable))
    throw new Error('Electron or electron-vite is not installed for stage-tamagotchi.')

  const esbuildPlatform = `${process.platform}-${process.arch}`
  const pnpmModules = join(repoRoot, 'node_modules', '.pnpm')
  const esbuildExecutables = (await readdir(pnpmModules, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`@esbuild+${esbuildPlatform}@`))
    .flatMap(entry => [
      join(pnpmModules, entry.name, 'node_modules', '@esbuild', esbuildPlatform, process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'),
    ])
    .filter(existsSync)
    .map(executable => realpathSync.native(executable))
  if (esbuildExecutables.length === 0)
    throw new Error(`No installed esbuild executable was found for ${esbuildPlatform}.`)

  return { electronExecutable, electronViteCli, esbuildExecutables }
}

function createRuntimeEnvironment(params: {
  debugPort: number
  denyProxyPort: number
  electronExecutable: string
  esbuildExecutables: string[]
  profileProof: string
  fixtureServiceBaseUrl: string
  temporaryProfile: string
}) {
  const blockedNames: string[] = []
  const sensitiveValues: string[] = []
  const environment = Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => {
    if (!SECRET_ENVIRONMENT_NAME_REGEX.test(name))
      return [[name, value]]

    blockedNames.push(name)
    if (value)
      sensitiveValues.push(value)
    return []
  }))
  const networkGuardOption = `--import=${pathToFileURL(networkGuard).href}`
  const chromiumArgs = [
    `--user-data-dir=${params.temporaryProfile}`,
    `--disk-cache-dir=${join(params.temporaryProfile, 'cache')}`,
    `--crash-dumps-dir=${join(params.temporaryProfile, 'crashes')}`,
    `--proxy-server=http://127.0.0.1:${params.denyProxyPort}`,
    '--proxy-bypass-list=localhost;127.*;[::1]',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-quic',
    '--disable-sync',
    '--enable-automation',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ]
  const electronArgv = ['.', ...chromiumArgs]

  return {
    blockedNames: blockedNames.sort(),
    environment: {
      ...environment,
      AIRI_DESKTOP_REGRESSION_ALLOWED_EXECUTABLES: params.esbuildExecutables.join(delimiter),
      AIRI_DESKTOP_REGRESSION_ELECTRON_ARGV: JSON.stringify(electronArgv),
      AIRI_DESKTOP_REGRESSION_ELECTRON_EXECUTABLE: params.electronExecutable,
      AIRI_DESKTOP_REGRESSION_OFFLINE: '1',
      AIRI_DESKTOP_REGRESSION_PROFILE_PROOF: params.profileProof,
      AIRI_DESKTOP_REGRESSION_RUNTIME: '1',
      AIRI_DESKTOP_REGRESSION_USER_DATA: params.temporaryProfile,
      APP_DEBUG: '0',
      APP_REMOTE_DEBUG: 'true',
      APP_REMOTE_DEBUG_PORT: String(params.debugPort),
      CI: '1',
      ELECTRON_ENTRY: '.',
      // electron-vite otherwise honors an inherited ELECTRON_EXEC_PATH. Pin it
      // to the same canonical binary covered by the one-shot launch contract.
      ELECTRON_EXEC_PATH: params.electronExecutable,
      MAIN_APP_DEBUG: '0',
      NODE_OPTIONS: networkGuardOption,
      // electron-vite treats any non-empty value as a request for --no-sandbox;
      // keep it empty so the one-shot argv contract remains exact and Chromium
      // keeps its normal sandbox in the isolated runtime.
      NO_SANDBOX: '',
      // NOTICE: `PORT` controls the Electron main-process channel server, not
      // the renderer dev server. Keep their normal 6121/5173 split explicit.
      PORT: String(CHANNEL_SERVER_PORT),
      REMOTE_DEBUGGING_PORT: '',
      SERVER_RUNTIME_HOSTNAME: '127.0.0.1',
      VITE_AIRI_WS_URL: `ws://127.0.0.1:${CHANNEL_SERVER_PORT}/ws`,
      VITE_APP_EDITION: 'dev',
      VITE_ENABLE_VUE_DEVTOOLS: '0',
      VITE_DEV_SERVER_PORT: String(DESKTOP_PORT),
      VITE_SERVER_URL: params.fixtureServiceBaseUrl,
      V8_INSPECTOR_BRK_PORT: '',
      V8_INSPECTOR_PORT: '',
    },
    electronArgv,
    electronCliArgs: chromiumArgs,
    sensitiveValues,
  }
}

function getRequestWindowId(request: Request, getWindowId: (window: object) => string) {
  try {
    // Service worker requests have no renderer Page to attribute and must remain global.
    if (request.serviceWorker())
      return
    return getWindowId(request.frame().page())
  }
  catch {
    // Pre-frame navigation can throw while the Page is changing; preserve the event globally.
  }
}

function attachDiagnostics(context: BrowserContext, diagnostics: DiagnosticEvent[], getWindowId: (window: object) => string) {
  const attachPage = (page: Page) => {
    const windowId = getWindowId(page)
    page.on('console', (message) => {
      if (message.type() !== 'error')
        return
      if (!isApplicationRuntimePageUrl(page.url()))
        return
      diagnostics.push({
        at: new Date().toISOString(),
        detail: message.text(),
        kind: 'console-error',
        route: currentRoute(page),
        windowId,
        windowUrl: sanitizeUrl(page.url()),
      })
    })
    page.on('pageerror', (error) => {
      if (!isApplicationRuntimePageUrl(page.url()))
        return
      diagnostics.push({
        at: new Date().toISOString(),
        detail: error.message,
        kind: 'page-error',
        route: currentRoute(page),
        windowId,
        windowUrl: sanitizeUrl(page.url()),
      })
    })
  }

  context.pages().forEach(attachPage)
  context.on('page', attachPage)
  context.on('request', (request) => {
    if (diagnostics.filter(event => event.kind === 'request').length >= 1000)
      return
    diagnostics.push({
      at: new Date().toISOString(),
      kind: 'request',
      method: request.method(),
      url: sanitizeUrl(request.url()),
      windowId: getRequestWindowId(request, getWindowId),
    })
  })
  context.on('requestfailed', (request) => {
    diagnostics.push({
      at: new Date().toISOString(),
      detail: request.failure()?.errorText,
      kind: 'request-failed',
      method: request.method(),
      url: sanitizeUrl(request.url()),
      windowId: getRequestWindowId(request, getWindowId),
    })
  })
}

async function installRendererNetworkGuard(context: BrowserContext, diagnostics: DiagnosticEvent[], getWindowId: (window: object) => string) {
  await context.route('**/*', async (route) => {
    const request = route.request()
    let hostname = ''
    try {
      hostname = new URL(request.url()).hostname
    }
    catch {
      await route.abort('blockedbyclient')
      return
    }

    if (isLoopbackHostname(hostname) || request.url().startsWith('file:') || request.url().startsWith('data:') || request.url().startsWith('blob:')) {
      await route.continue()
      return
    }

    diagnostics.push({
      at: new Date().toISOString(),
      detail: 'blocked-by-playwright-context',
      kind: 'external-request',
      method: request.method(),
      url: sanitizeUrl(request.url()),
      windowId: getRequestWindowId(request, getWindowId),
    })
    await route.abort('blockedbyclient')
  })
}

async function installIsolatedProfileSeed(context: BrowserContext) {
  // NOTICE: L2 uses a new profile on every run. Seed only that temporary
  // browser context before any stage renderer is created so route checks are
  // not hidden behind first-run onboarding.
  await context.addInitScript(() => {
    const isHttp = location.protocol === 'http:' || location.protocol === 'https:'
    const isLoopback = location.hostname === 'localhost'
      || location.hostname === '::1'
      || location.hostname === '0.0.0.0'
      || location.hostname.startsWith('127.')
    if (!isHttp || !isLoopback || location.port !== '5173')
      return

    try {
      localStorage.setItem('onboarding/completed', 'false')
      localStorage.setItem('onboarding/skipped', 'true')
    }
    catch {
      // The verified main page is seeded and asserted explicitly below.
    }
  })
}

async function prepareIsolatedMainPage(page: Page) {
  const alreadySeeded = await page.evaluate(() => {
    return localStorage.getItem('onboarding/completed') === 'false'
      && localStorage.getItem('onboarding/skipped') === 'true'
  })
  if (alreadySeeded)
    return false

  // The main document may have started before CDP installed the context init
  // script. Seed and reload it only after its first runtime-ready signal so we
  // never abort Electron main's initial loadURL ownership.
  await page.evaluate(() => {
    localStorage.setItem('onboarding/completed', 'false')
    localStorage.setItem('onboarding/skipped', 'true')
  })
  await page.reload({ timeout: STARTUP_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    return localStorage.getItem('onboarding/completed') === 'false'
      && localStorage.getItem('onboarding/skipped') === 'true'
  }, undefined, { timeout: STARTUP_TIMEOUT_MS })
  return true
}

async function connectToElectron(debugPort: number, childExited: () => boolean) {
  const endpoint = `http://127.0.0.1:${debugPort}`
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    if (childExited())
      throw new Error('Electron development process exited before CDP became available.')

    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 1000 })
    }
    catch (error) {
      lastError = error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
    }
  }

  throw new Error(`Timed out connecting to Electron CDP at ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function waitForMainPage(context: BrowserContext) {
  const findMainPage = () => context.pages().find((page) => {
    try {
      const url = new URL(page.url())
      return isLoopbackHostname(url.hostname)
        && Number(url.port || '80') === DESKTOP_PORT
        && url.pathname === '/'
        && (url.hash === '' || url.hash === '#/')
    }
    catch {
      return false
    }
  })
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const page = findMainPage()
    if (page)
      return page
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`No Electron renderer reached localhost:${DESKTOP_PORT}.`)
}

function significantDiagnostics(events: DiagnosticEvent[]) {
  return events.filter(event => event.kind !== 'request')
}

async function captureFailureScreenshot(page: Page, reportDirectory: string, route: string) {
  const routeName = route === '/' ? 'root' : route.replace(LEADING_SLASH_REGEX, '').replaceAll('/', '-')
  const path = join(reportDirectory, `${routeName}.png`)
  await page.screenshot({ path, fullPage: true, timeout: 10_000 }).catch(() => undefined)
  return existsSync(path) ? path : undefined
}

async function readMainStageRenderEvidence(page: Page): Promise<MainStageRenderEvidence> {
  return await page.evaluate(() => {
    interface Bounds { x: number, y: number, width: number, height: number }
    interface RenderTarget {
      parent?: RenderTarget
      worldVisible: boolean
      worldAlpha: number
      getBounds: () => Bounds
    }
    interface Renderer {
      gl: WebGLRenderingContext
      screen: Bounds
      render: (target: RenderTarget) => void
    }
    interface SceneInstance {
      exposed?: {
        app?: () => { renderer: Renderer, stage: RenderTarget } | undefined
        canvasElement?: () => HTMLCanvasElement | undefined
        displayObject?: () => RenderTarget | undefined
        modelIdentity?: () => { modelId?: string, modelSrc: string } | undefined
      }
      setupState?: { componentState?: string }
      subTree?: SceneVNode
      type?: { __file?: string }
    }
    interface SceneVNode {
      children?: unknown
      component?: SceneInstance
    }
    const evidence: MainStageRenderEvidence = {
      canvasVisible: false,
      modelIdentityMatches: false,
      modelAttached: false,
      modelIntersectsCanvas: false,
      opaquePixels: 0,
      ready: false,
    }
    const app = document.querySelector('#app') as HTMLElement & {
      __vue_app__?: {
        config: { globalProperties: { $pinia?: { _s: Map<string, Record<string, unknown>> } } }
      }
    }
    const settings = app?.__vue_app__?.config.globalProperties.$pinia?._s.get('settings-stage-model')
    // Only these public display settings enter the report; no provider/account state.
    for (const [field, key] of [
      ['renderer', 'stageModelRenderer'],
      ['selectedModel', 'stageModelSelected'],
      ['selectedModelUrl', 'stageModelSelectedUrl'],
    ] as const) {
      const value = settings?.[key]
      if (typeof value === 'string')
        evidence[field] = value
    }
    const routeRoot = document.querySelector('[data-airi-runtime-route="/"]') as HTMLElement & {
      __vueParentComponent?: SceneInstance
    }
    const visited = new Set<SceneInstance>()
    const pending: (SceneVNode | undefined)[] = [routeRoot?.__vueParentComponent?.subTree]
    let scene: SceneInstance | undefined
    while (pending.length) {
      const node = pending.pop()
      const instance = node?.component
      if (instance && !visited.has(instance)) {
        visited.add(instance)
        if (instance.type?.__file?.endsWith('/scenes/Stage.vue')) {
          scene = instance
          break
        }
        pending.push(instance.subTree)
      }
      if (Array.isArray(node?.children))
        pending.push(...node.children as SceneVNode[])
    }
    evidence.state = scene?.setupState?.componentState
    if (evidence.renderer !== 'live2d') {
      evidence.error = `The clean-profile default character requires Live2D, received ${evidence.renderer ?? 'no renderer'}.`
      return evidence
    }
    const canvas = scene?.exposed?.canvasElement?.()
    const pixi = scene?.exposed?.app?.()
    const target = scene?.exposed?.displayObject?.()
    const loadedIdentity = scene?.exposed?.modelIdentity?.()
    evidence.loadedModelId = loadedIdentity?.modelId
    evidence.loadedModelUrl = loadedIdentity?.modelSrc
    evidence.modelIdentityMatches = loadedIdentity?.modelId === evidence.selectedModel
      && loadedIdentity?.modelSrc === evidence.selectedModelUrl && Boolean(loadedIdentity)
    if (!canvas || !pixi || !target || evidence.state !== 'mounted')
      return evidence
    if (!evidence.modelIdentityMatches) {
      evidence.error = 'The loaded model identity/source does not match the selected stage model.'
      return evidence
    }

    const rect = canvas.getBoundingClientRect()
    const style = getComputedStyle(canvas)
    evidence.canvasVisible = rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
    for (let element = canvas.parentElement; element; element = element.parentElement) {
      const ancestorStyle = getComputedStyle(element)
      if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) === 0)
        evidence.canvasVisible = false
    }
    let ancestor: RenderTarget | undefined = target
    while (ancestor && ancestor !== pixi.stage)
      ancestor = ancestor.parent
    evidence.modelAttached = ancestor === pixi.stage && target.worldVisible && target.worldAlpha > 0
    if (!evidence.canvasVisible || !evidence.modelAttached)
      return evidence

    try {
      // Render and read the screen synchronously: Chromium may clear a WebGL
      // drawing buffer between frames when preserveDrawingBuffer is disabled.
      pixi.renderer.render(pixi.stage)
      const bounds = target.getBounds()
      const screen = pixi.renderer.screen
      const left = Math.max(bounds.x, screen.x)
      const top = Math.max(bounds.y, screen.y)
      const right = Math.min(bounds.x + bounds.width, screen.x + screen.width)
      const bottom = Math.min(bounds.y + bounds.height, screen.y + screen.height)
      evidence.modelIntersectsCanvas = right > left && bottom > top
      if (!evidence.modelIntersectsCanvas)
        return evidence

      const gl = pixi.renderer.gl
      const scaleX = gl.drawingBufferWidth / screen.width
      const scaleY = gl.drawingBufferHeight / screen.height
      const x = Math.max(0, Math.floor((left - screen.x) * scaleX))
      const y = Math.max(0, Math.floor((screen.y + screen.height - bottom) * scaleY))
      const width = Math.min(gl.drawingBufferWidth - x, Math.floor((right - left) * scaleX))
      const height = Math.min(gl.drawingBufferHeight - y, Math.floor((bottom - top) * scaleY))
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] >= 20)
          evidence.opaquePixels += 1
      }
      evidence.ready = evidence.opaquePixels >= 32
    }
    catch (error) {
      evidence.error = error instanceof Error ? error.message : String(error)
    }
    return evidence
  })
}

async function exerciseRoute(page: Page, windowId: string, route: string, diagnostics: DiagnosticEvent[], reportDirectory: string): Promise<RouteResult> {
  const startedAt = Date.now()
  const diagnosticStart = diagnostics.length
  let probeMatched = false
  let routeRootVisible = false
  let visibleElements: number | undefined
  let modelRenderEvidence: MainStageRenderEvidence | undefined
  let failure: unknown
  try {
    await page.evaluate(async ({ targetRoute, timeoutMs }) => {
      const app = document.querySelector('#app') as HTMLElement & {
        __vue_app__?: {
          config: {
            globalProperties: {
              $router?: {
                currentRoute: { value: { path: string } }
                isReady: () => Promise<void>
                push: (path: string) => Promise<unknown>
              }
            }
          }
        }
      }
      const router = app?.__vue_app__?.config.globalProperties.$router
      if (!router)
        throw new Error('Vue Router is unavailable from the mounted desktop application.')

      let navigationTimeout: number | undefined
      try {
        await Promise.race([
          router.push(targetRoute).then(() => router.isReady()),
          new Promise<never>((_, reject) => {
            navigationTimeout = window.setTimeout(
              () => reject(new Error(`Vue Router navigation to ${targetRoute} timed out.`)),
              timeoutMs,
            )
          }),
        ])
      }
      finally {
        if (navigationTimeout !== undefined)
          window.clearTimeout(navigationTimeout)
      }
      if (router.currentRoute.value.path !== targetRoute)
        throw new Error(`Vue Router resolved ${router.currentRoute.value.path} instead of ${targetRoute}.`)
    }, { targetRoute: route, timeoutMs: remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS) })

    await page.waitForFunction((targetRoute) => {
      const probes = [...document.querySelectorAll<HTMLElement>('[data-airi-runtime-route]')]
      const matching = probes.filter(element => element.dataset.airiRuntimeRoute === targetRoute)
      if (matching.length !== 1)
        return false

      const style = getComputedStyle(matching[0])
      const rect = matching[0].getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }, route, { timeout: remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS) })
    remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS)
    await page.evaluate(async (timeoutMs) => {
      let frameTimeout: number | undefined
      try {
        await Promise.race([
          new Promise<void>((resolveFrame) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
          }),
          new Promise<never>((_, reject) => {
            frameTimeout = window.setTimeout(
              () => reject(new Error('Route probe did not remain renderable for two animation frames.')),
              timeoutMs,
            )
          }),
        ])
      }
      finally {
        if (frameTimeout !== undefined)
          window.clearTimeout(frameTimeout)
      }
    }, remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS))
    remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS)
    const probe = await page.evaluate((targetRoute) => {
      const probes = [...document.querySelectorAll<HTMLElement>('[data-airi-runtime-route]')]
      const matching = probes.filter(element => element.dataset.airiRuntimeRoute === targetRoute)
      const routeRoot = matching[0]
      if (!routeRoot)
        throw new Error(`Route probe ${targetRoute} is not mounted.`)

      const rootStyle = getComputedStyle(routeRoot)
      const rootRect = routeRoot.getBoundingClientRect()
      const rootVisible = rootStyle.display !== 'none'
        && rootStyle.visibility !== 'hidden'
        && rootRect.width > 0
        && rootRect.height > 0
      const visibleDescendants = [routeRoot, ...routeRoot.querySelectorAll<HTMLElement>('*')].filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
      return {
        matched: matching.length === 1 && routeRoot.dataset.airiRuntimeRoute === targetRoute,
        rootVisible,
        visibleElements: visibleDescendants.length,
      }
    }, route)
    remainingDesktopRouteTimeout(startedAt, Date.now(), ROUTE_TIMEOUT_MS)
    probeMatched = probe.matched
    routeRootVisible = probe.rootVisible
    visibleElements = probe.visibleElements
    if (!probeMatched)
      throw new Error(`Route ${route} did not mount one unique runtime probe.`)
    if (!routeRootVisible)
      throw new Error(`Route ${route} mounted a hidden or zero-sized runtime root.`)
    if (visibleElements === 0)
      throw new Error(`Route ${route} rendered no visible elements.`)
    if (route === '/') {
      do {
        modelRenderEvidence = await readMainStageRenderEvidence(page)
        if (modelRenderEvidence.ready)
          break
        if (modelRenderEvidence.error)
          throw new Error(`Main stage model render failed: ${modelRenderEvidence.error}`)
        if (Date.now() - startedAt >= ROUTE_TIMEOUT_MS)
          throw new Error(`Main stage model did not render visible pixels: ${JSON.stringify(modelRenderEvidence)}`)
        await page.waitForTimeout(100)
      } while (true)
    }
  }
  catch (error) {
    failure = error
  }

  const routeDiagnostics = selectRouteDiagnostics(diagnostics.slice(diagnosticStart), windowId)
  if (failure) {
    routeDiagnostics.unshift({
      at: new Date().toISOString(),
      detail: failure instanceof Error ? failure.message : String(failure),
      kind: 'page-error',
      route,
      windowId,
      windowUrl: sanitizeUrl(page.url()),
    })
  }
  const status = routeDiagnostics.length === 0 ? 'passed' : 'failed'
  // Keep visual evidence for the two chat surfaces even when their route roots
  // mount successfully: a root probe alone cannot demonstrate the character or
  // collapsed input actually renders correctly.
  const screenshot = status === 'failed' || route === '/' || route === '/quick-chat'
    ? await captureFailureScreenshot(page, reportDirectory, route)
    : undefined
  return {
    diagnostics: routeDiagnostics,
    durationMs: Date.now() - startedAt,
    modelRenderEvidence,
    probeMatched,
    route,
    routeRootVisible,
    screenshot,
    status,
    visibleElements,
  }
}

async function readProfileProof(profileProof: string, temporaryProfile: string) {
  const proof = JSON.parse(await readFile(profileProof, 'utf8')) as { userData?: string }
  if (!proof.userData || resolve(proof.userData) !== resolve(temporaryProfile))
    throw new Error('Electron main process did not prove that app.getPath(\'userData\') matches the temporary profile.')
  return { matched: true }
}

function assertSafeTemporaryProfile(profile: string) {
  const resolvedProfile = resolve(profile)
  const resolvedTemporaryRoot = resolve(tmpdir())
  const pathFromTemporaryRoot = relative(resolvedTemporaryRoot, resolvedProfile)
  if (!basename(resolvedProfile).startsWith(TEMPORARY_PROFILE_PREFIX)
    || !pathFromTemporaryRoot
    || pathFromTemporaryRoot.startsWith('..')
    || isAbsolute(pathFromTemporaryRoot)) {
    throw new Error(`Refusing to remove unverified desktop runtime profile: ${resolvedProfile}`)
  }
}

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (childExited(child))
    return true

  return await new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.removeListener('close', handleClose)
      resolveExit(false)
    }, timeoutMs)
    function handleClose() {
      clearTimeout(timeout)
      resolveExit(true)
    }
    child.once('close', handleClose)
  })
}

function ownedChildPid(child: ChildProcess) {
  const pid = child.pid
  if (!pid || !Number.isInteger(pid) || pid <= 0 || pid === process.pid)
    throw new Error(`Refusing to terminate an invalid or unowned process id: ${pid}`)
  return pid
}

async function runWindowsTaskkill(pid: number) {
  const systemRoot = process.env.SystemRoot
  if (!systemRoot || !isAbsolute(systemRoot))
    throw new Error('Cannot resolve the absolute Windows System32 directory.')

  const system32 = resolve(systemRoot, 'System32')
  const taskkill = realpathSync.native(join(system32, 'taskkill.exe'))
  const pathFromSystem32 = relative(system32, taskkill)
  if (pathFromSystem32.startsWith('..') || isAbsolute(pathFromSystem32) || basename(taskkill).toLowerCase() !== 'taskkill.exe')
    throw new Error(`Refusing to execute taskkill outside System32: ${taskkill}`)

  const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    killer.once('error', reject)
    killer.once('close', resolveExit)
  })
  return exitCode
}

function signalOwnedProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH')
      return false
    throw error
  }
}

async function closeOwnedRuntime(child: ChildProcessWithoutNullStreams, browser?: Browser) {
  const pid = ownedChildPid(child)
  if (browser?.isConnected()) {
    try {
      const session = await browser.newBrowserCDPSession()
      await session.send('Browser.close')
    }
    catch {
      await browser.close().catch(() => undefined)
    }
  }

  if (await waitForChildExit(child, 5000))
    return { exited: true, method: 'browser-close' }

  if (process.platform === 'win32') {
    const taskkillExitCode = await runWindowsTaskkill(pid)
    if (!await waitForChildExit(child, 5000))
      throw new Error(`Owned Windows process tree ${pid} did not exit after taskkill (exit ${taskkillExitCode}).`)
    return { exited: true, method: 'taskkill-tree', taskkillExitCode }
  }

  signalOwnedProcessGroup(pid, 'SIGTERM')
  if (await waitForChildExit(child, 5000))
    return { exited: true, method: 'process-group-term' }

  signalOwnedProcessGroup(pid, 'SIGKILL')
  if (!await waitForChildExit(child, 5000))
    throw new Error(`Owned POSIX process group ${pid} did not exit after SIGKILL.`)
  return { exited: true, method: 'process-group-kill' }
}

export async function runDesktopRuntimeRegression() {
  await assertPortAvailable(DESKTOP_PORT)
  await assertPortAvailable(CHANNEL_SERVER_PORT)

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const reportDirectory = join(repoRoot, 'output', 'playwright', `desktop-runtime-${runId}`)
  const diagnostics: DiagnosticEvent[] = []
  const routeResults: RouteResult[] = []
  const startedAt = new Date()
  const timingMilestones: DesktopRuntimeTimingMilestones = { startedAtMs: startedAt.getTime() }
  let browser: Browser | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  let childExitCode: number | null | undefined
  let profileIsolation = { matched: false }
  let commandLineIsolation = false
  let routeDiagnosticStart = 0
  let fatalError: string | undefined
  let windows: Array<{ title: string, url: string, windowId: string }> = []
  const windowIds = createDesktopRegressionWindowIds()
  let blockedNames: string[] = []
  let esbuildExecutableNames: string[] = []
  let electronArgvCount = 0
  let redactText = createTextRedactor('', [])
  const stdout: string[] = []
  const stderr: string[] = []
  const cleanupErrors: string[] = []
  const cleanup = {
    denyProxyClosed: false,
    processTree: { exited: true, method: 'not-started' } as { exited: boolean, method: string, taskkillExitCode?: number | null },
    profileRemoved: false,
    testServiceClosed: false,
  }

  await mkdir(reportDirectory, { recursive: true })
  const denyProxy = await startDenyProxy(diagnostics)
  const temporaryProfile = await mkdtemp(join(tmpdir(), TEMPORARY_PROFILE_PREFIX)).catch(async (error) => {
    await denyProxy.close().catch(() => undefined)
    throw error
  })
  const fixtureService = await startDesktopRegressionFixtureService(desktopRendererOrigin).catch(async (error) => {
    await denyProxy.close().catch(() => undefined)
    assertSafeTemporaryProfile(temporaryProfile)
    await rm(temporaryProfile, { recursive: true, force: true }).catch(() => undefined)
    throw error
  })
  const profileProof = join(temporaryProfile, 'profile-proof.json')
  redactText = createTextRedactor(temporaryProfile, [])
  try {
    try {
      const debugPort = await reserveFreePort()
      const { electronExecutable, electronViteCli, esbuildExecutables } = await resolveRuntimeExecutables()
      const runtime = createRuntimeEnvironment({
        debugPort,
        denyProxyPort: denyProxy.port,
        electronExecutable,
        esbuildExecutables,
        fixtureServiceBaseUrl: fixtureService.baseUrl,
        profileProof,
        temporaryProfile,
      })
      blockedNames = runtime.blockedNames
      electronArgvCount = runtime.electronArgv.length
      esbuildExecutableNames = esbuildExecutables.map(executable => basename(executable))
      redactText = createTextRedactor(temporaryProfile, runtime.sensitiveValues)

      child = spawn(process.execPath, [
        electronViteCli,
        'dev',
        '--mode',
        'desktop-regression',
        '--',
        ...runtime.electronCliArgs,
      ], {
        cwd: appRoot,
        detached: process.platform !== 'win32',
        env: runtime.environment,
        stdio: 'pipe',
        windowsHide: true,
      })
      timingMilestones.processSpawnedAtMs = Date.now()
      console.info('[desktop-runtime] Electron process spawned; waiting for the main window to become visible...')
      child.stdout.on('data', (chunk) => {
        const text = redactText(String(chunk))
        stdout.push(text)
        process.stdout.write(text)
      })
      child.stderr.on('data', (chunk) => {
        const text = redactText(String(chunk))
        stderr.push(text)
        process.stderr.write(text)
      })
      child.once('close', (exitCode) => {
        childExitCode = exitCode
      })

      browser = await connectToElectron(debugPort, () => childExitCode !== undefined)
      timingMilestones.cdpConnectedAtMs = Date.now()
      const context = browser.contexts()[0]
      if (!context)
        throw new Error('Electron CDP exposed no default browser context.')
      await installIsolatedProfileSeed(context)
      attachDiagnostics(context, diagnostics, windowIds.getWindowId)
      await installRendererNetworkGuard(context, diagnostics, windowIds.getWindowId)

      const browserSession = await browser.newBrowserCDPSession()
      const commandLine = await browserSession.send('Browser.getBrowserCommandLine') as { arguments?: string[] }
      const userDataArgument = commandLine.arguments?.find(argument => argument.startsWith('--user-data-dir='))
      commandLineIsolation = !!userDataArgument && resolve(userDataArgument.slice('--user-data-dir='.length)) === resolve(temporaryProfile)
      if (!commandLineIsolation)
        throw new Error('CDP could not prove the Electron --user-data-dir argument matches the temporary profile.')

      profileIsolation = await readProfileProof(profileProof, temporaryProfile)

      const page = await waitForMainPage(context)
      const mainWindowId = windowIds.getWindowId(page)
      timingMilestones.mainWindowDetectedAtMs = Date.now()
      await page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: STARTUP_TIMEOUT_MS })
      timingMilestones.mainWindowVisibleAtMs = Date.now()
      console.info(`[desktop-runtime] Main Electron window visible after ${timingMilestones.mainWindowVisibleAtMs - startedAt.getTime()}ms; waiting for renderer runtime-ready...`)
      await page.waitForFunction(() => document.documentElement.dataset.airiRuntimeReady === 'true', undefined, { timeout: STARTUP_TIMEOUT_MS })
      if (await prepareIsolatedMainPage(page))
        await page.waitForFunction(() => document.documentElement.dataset.airiRuntimeReady === 'true', undefined, { timeout: STARTUP_TIMEOUT_MS })
      timingMilestones.mainWindowReadyAtMs = Date.now()
      const onboardingDialogCount = await page.getByRole('dialog', { name: 'Onboarding' }).count()
      if (onboardingDialogCount !== 0)
        throw new Error('Desktop route checks are blocked by the first-run onboarding dialog.')

      routeDiagnosticStart = diagnostics.length
      timingMilestones.routeChecksStartedAtMs = Date.now()
      console.info(`[desktop-runtime] Renderer ready; probing ${DESKTOP_REQUIRED_ROUTES.length} Vue routes serially...`)
      for (const [index, route] of DESKTOP_REQUIRED_ROUTES.entries()) {
        const result = await exerciseRoute(page, mainWindowId, route, diagnostics, reportDirectory)
        routeResults.push(result)
        console.info(`[desktop-runtime] Route ${index + 1}/${DESKTOP_REQUIRED_ROUTES.length} ${result.status.toUpperCase()}: ${route} (${result.durationMs}ms)`)
      }
      timingMilestones.routeChecksCompletedAtMs = Date.now()

      windows = await Promise.all(context.pages().map(async window => ({
        title: await window.title().catch(() => ''),
        url: sanitizeUrl(window.url()),
        windowId: windowIds.getWindowId(window),
      })))
      timingMilestones.windowsCollectedAtMs = Date.now()
      console.info(`[desktop-runtime] Route probes complete; inventoried ${windows.length} Electron windows. Cleaning up isolated runtime...`)
    }
    catch (error) {
      fatalError = redactText(error instanceof Error ? error.stack ?? error.message : String(error))
      if (browser?.isConnected()) {
        const context = browser.contexts()[0]
        for (const [index, page] of (context?.pages() ?? []).entries())
          await page.screenshot({ path: join(reportDirectory, `fatal-window-${index}.png`), fullPage: true, timeout: 10_000 }).catch(() => undefined)
      }
    }
  }
  finally {
    timingMilestones.cleanupStartedAtMs = Date.now()
    if (child) {
      try {
        cleanup.processTree = await closeOwnedRuntime(child, browser)
      }
      catch (error) {
        cleanup.processTree = { exited: false, method: 'failed' }
        cleanupErrors.push(error instanceof Error ? error.message : String(error))
      }
    }
    try {
      await denyProxy.close()
      cleanup.denyProxyClosed = true
    }
    catch (error) {
      cleanupErrors.push(`Deny proxy cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      await fixtureService.close()
      cleanup.testServiceClosed = true
    }
    catch (error) {
      cleanupErrors.push(`Test fixture service cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (cleanup.processTree.exited) {
      try {
        assertSafeTemporaryProfile(temporaryProfile)
        await rm(temporaryProfile, { recursive: true, force: true })
        if (existsSync(temporaryProfile))
          throw new Error('Temporary profile still exists after removal.')
        cleanup.profileRemoved = true
      }
      catch (error) {
        cleanupErrors.push(`Temporary profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    else {
      cleanupErrors.push('Temporary profile retained because the owned process tree did not exit.')
    }

    await writeFile(join(reportDirectory, 'runtime.stdout.log'), stdout.join(''), 'utf8')
    await writeFile(join(reportDirectory, 'runtime.stderr.log'), stderr.join(''), 'utf8')
    timingMilestones.cleanupCompletedAtMs = Date.now()
  }

  if (cleanupErrors.length > 0) {
    const cleanupMessage = cleanupErrors.map(redactText).join('; ')
    fatalError = fatalError ? `${fatalError}\nCleanup: ${cleanupMessage}` : `Cleanup: ${cleanupMessage}`
  }
  const finishedAt = new Date()
  const unexpectedNetwork = diagnostics.filter(event => event.kind === 'external-request')
  const unexpectedTestServiceRequests = fixtureService.unexpectedRequests
  const runtimeErrors = diagnostics.filter(event => event.kind === 'console-error' || event.kind === 'page-error')
  const status = !fatalError
    && profileIsolation.matched
    && commandLineIsolation
    && cleanup.processTree.exited
    && cleanup.denyProxyClosed
    && cleanup.profileRemoved
    && cleanup.testServiceClosed
    && unexpectedNetwork.length === 0
    && unexpectedTestServiceRequests.length === 0
    && runtimeErrors.length === 0
    && routeResults.length === DESKTOP_REQUIRED_ROUTES.length
    && routeResults.every(result => result.status === 'passed')
    ? 'passed'
    : 'failed'
  const report = {
    schemaVersion: 1,
    regressionLevel: 'L2',
    runId,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    fatalError,
    timing: createDesktopRuntimePhaseTiming(timingMilestones),
    safety: {
      childProcessLaunch: {
        electron: {
          argvCount: electronArgvCount,
          customEnvironment: 'denied',
          executableContract: 'exact-realpath',
          generalExecutableAllowlist: false,
          maximumLaunchesPerProcess: 1,
          shell: 'denied',
          spawnOptions: 'exact-stdio-inherit-only',
        },
        generalExecutableAllowlist: esbuildExecutableNames,
      },
      cleanup,
      configuredDesktopPort: DESKTOP_PORT,
      existingDesktopProcessStopped: false,
      externalNetwork: {
        allowedHosts: ['localhost', '127.0.0.0/8', '::1', '0.0.0.0'],
        guardedApis: [
          'fetch',
          'http',
          'https',
          'http2',
          'WebSocket',
          'net',
          'net.Socket',
          'tls',
          'dgram.Socket.connect',
          'dgram.Socket.send',
          'dns.lookup',
          'dns.lookupService',
          'dns.resolve*',
          'dns.reverse',
          'dns.promises.lookup',
          'dns.promises.lookupService',
          'dns.promises.resolve*',
          'dns.promises.reverse',
          'dns.Resolver.resolve*',
          'dns.Resolver.reverse',
          'dns.promises.Resolver.resolve*',
          'dns.promises.Resolver.reverse',
        ],
        rendererGuard: 'test-owned deny proxy before launch plus Playwright context interception',
        scope: 'listed-node-apis-plus-chromium-proxy-and-route',
        unexpectedAttempts: unexpectedNetwork,
      },
      testService: {
        allowedPaths: fixtureService.allowedPaths,
        baseUrl: fixtureService.baseUrl,
        endpointCounts: fixtureService.endpointCounts,
        requests: fixtureService.requests,
        unexpectedRequests: unexpectedTestServiceRequests,
      },
      inheritedNodeOptions: 'discarded',
      osFirewall: 'not-applied',
      providerCredentialsRemoved: blockedNames,
      userData: {
        cdpCommandLineMatched: commandLineIsolation,
        electronMainMatched: profileIsolation.matched,
        temporaryProfileRemoved: cleanup.profileRemoved,
      },
    },
    summary: {
      failedRoutes: routeResults.filter(result => result.status === 'failed').length,
      passedRoutes: routeResults.filter(result => result.status === 'passed').length,
      requiredRoutes: DESKTOP_REQUIRED_ROUTES.length,
      runtimeErrors: runtimeErrors.length,
      unexpectedTestServiceRequests: unexpectedTestServiceRequests.length,
      windows: windows.length,
    },
    startupDiagnostics: significantDiagnostics(diagnostics.slice(0, routeDiagnosticStart))
      .filter(event => event.kind === 'console-error' || event.kind === 'page-error')
      .map(event => ({
        ...event,
        detail: event.detail ? redactText(event.detail) : undefined,
      })),
    windows,
    routes: routeResults,
    diagnostics: diagnostics.map(event => ({
      ...event,
      detail: event.detail ? redactText(event.detail) : undefined,
    })),
    runtimeExitCode: childExitCode,
    reproduction: 'pnpm -F @proj-airi/stage-tamagotchi test:desktop:regression:runtime',
  }
  const reportPath = join(reportDirectory, 'report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(repoRoot, 'output', 'playwright', 'desktop-runtime-latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.info(`\n[desktop-runtime] ${status.toUpperCase()}`)
  console.info(`[desktop-runtime] Report: ${reportPath}`)
  if (status === 'failed')
    process.exitCode = 1
}

const executedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (executedDirectly) {
  runDesktopRuntimeRegression().catch((error) => {
    console.error('[desktop-runtime] Fatal error:', error)
    process.exitCode = 1
  })
}
