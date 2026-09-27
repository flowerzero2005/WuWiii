import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { env, execPath, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

import messages from '@proj-airi/i18n/locales'

import { optimizer } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { initScreenCaptureForMain } from '@proj-airi/electron-screen-capture/main'
import { app, dialog, ipcMain, session, shell } from 'electron'
import { createLoggLogger, injeca } from 'injeca'
import { isLinux, isWindows } from 'std-env'

import icon from '../../resources/icon.png?asset'

import { createDesktopFeatureManifest } from '../shared/desktop-feature-manifest'
import { openDebugger, setupDebugger } from './app/debugger'
import { createGlobalAppConfig } from './configs/global'
import { emitAppBeforeQuit, emitAppReady, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setupDesktopDiagnostics } from './libs/electron/desktop-diagnostics'
import { configureDevelopmentProfile } from './libs/electron/development-profile'
import { setElectronMainDirname } from './libs/electron/location'
import { createI18n } from './libs/i18n'
import { setupAgentSessionControllerService } from './services/airi/agent-session-controller'
import { setupButlerReminderService } from './services/airi/butler-reminders'
import { setupButlerTaskService } from './services/airi/butler-tasks'
import { createServerChannelService, setupServerChannel } from './services/airi/channel-server'
import { setupCommandExecutionService } from './services/airi/command-execution'
import { setupMcpStdioManager } from './services/airi/mcp-servers'
import { setupPluginHost } from './services/airi/plugins'
import { setupProtectedResourcesRegistryService } from './services/airi/protected-resources'
import { setupWorkbenchAgentRuntimeService } from './services/airi/workbench-agent-runtime'
import { setupWorkbenchCommandRunnerService } from './services/airi/workbench-command-runner'
import { setupWorkbenchMemoryService } from './services/airi/workbench-memory'
import { setupWorkbenchStaticPreviewService } from './services/airi/workbench-static-preview'
import { setupWorkbenchWorkspaceService } from './services/airi/workbench-workspace'
import { setupAutoUpdater } from './services/electron/auto-updater'
import { createConversationNavigationService } from './services/electron/conversation-navigation'
import { createDetachedComposerService } from './services/electron/detached-composer'
import { setupMediaPermissions } from './services/electron/media-permissions'
import { setupSingleInstance } from './single-instance'
import { setupTray } from './tray'
import { setupAboutWindowReusable } from './windows/about'
import { setupBeatSync } from './windows/beat-sync'
import { setupButlerWindowManager } from './windows/butler'
import { setupCaptionWindowManager } from './windows/caption'
import { setupChatWindowReusableFunc } from './windows/chat'
import { setupMainWindow } from './windows/main'
import { setupNoticeWindowManager } from './windows/notice'
import { setupQuickChatWindowManager } from './windows/quick-chat'
import { setupQuickChatDialogueOverlayWindowManager } from './windows/quick-chat-dialogue-overlay'
import { setupSettingsWindowReusableFunc } from './windows/settings'
import { toggleWindowShow } from './windows/shared/window'
import { setupStartupWindow } from './windows/startup'
import { setupWidgetsWindowManager } from './windows/widgets'
import { setupWorkbenchWindowReusableFunc } from './windows/workbench'

// TODO: once we refactored eventa to support window-namespaced contexts,
// we can remove the setMaxListeners call below since eventa will be able to dispatch and
// manage events within eventa's context system.
ipcMain.setMaxListeners(100)

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
const ENABLED_ENV_VALUE_REGEX = /^(?:1|true|yes|on)$/i
const RUNTIME_ID_UNSAFE_CHARACTERS_RE = /[^a-z0-9.-]/gi
const PATH_BACKSLASHES_RE = /\\/g
const TRAILING_PATH_SLASHES_RE = /\/+$/
function normalizeWorkspaceRoot(root: string) {
  return root.replace(PATH_BACKSLASHES_RE, '/').replace(TRAILING_PATH_SLASHES_RE, '').toLowerCase()
}

function configureDesktopRegressionProfile() {
  if (!envFlagEnabled(env.AIRI_DESKTOP_REGRESSION_RUNTIME))
    return

  const requestedProfile = env.AIRI_DESKTOP_REGRESSION_USER_DATA
  const proofFile = env.AIRI_DESKTOP_REGRESSION_PROFILE_PROOF
  if (!requestedProfile || !proofFile)
    throw new Error('Desktop runtime regression requires an isolated profile and proof file.')

  const profile = resolve(requestedProfile)
  const pathFromTemp = relative(resolve(tmpdir()), profile)
  const proof = resolve(proofFile)
  const proofFromProfile = relative(profile, proof)
  if (!basename(profile).startsWith('airi-desktop-runtime-')
    || !pathFromTemp
    || pathFromTemp.startsWith('..')
    || isAbsolute(pathFromTemp)
    || !proofFromProfile
    || proofFromProfile.startsWith('..')
    || isAbsolute(proofFromProfile)) {
    throw new Error('Desktop runtime regression refused an unsafe profile or proof path.')
  }

  const sessionData = join(profile, 'session')
  const logs = join(profile, 'logs')
  mkdirSync(sessionData, { recursive: true })
  mkdirSync(logs, { recursive: true })
  app.setPath('userData', profile)
  app.setPath('sessionData', sessionData)
  app.setPath('logs', logs)
  writeFileSync(proof, `${JSON.stringify({ userData: app.getPath('userData') })}\n`, 'utf8')
}

configureDesktopRegressionProfile()
configureDevelopmentProfile(app, envFlagEnabled(env.AIRI_DESKTOP_REGRESSION_RUNTIME))
const singleInstance = setupSingleInstance(app)
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)

const log = useLogg('main').useGlobalConfig()

type DesktopAppEdition = 'consumer' | 'creator' | 'dev'

function isDesktopAppEdition(value: string | undefined): value is DesktopAppEdition {
  return value === 'consumer' || value === 'creator' || value === 'dev'
}

function resolveDesktopAppEdition(): DesktopAppEdition {
  const edition = import.meta.env.VITE_APP_EDITION ?? env.VITE_APP_EDITION

  if (isDesktopAppEdition(edition)) {
    return edition
  }

  return app.isPackaged ? 'consumer' : 'dev'
}

function envFlagEnabled(value?: string) {
  return ENABLED_ENV_VALUE_REGEX.test(value ?? '')
}

function resolveDevelopmentAppUserModelId() {
  const runtimeIdentity = basename(dirname(dirname(execPath))).replace(RUNTIME_ID_UNSAFE_CHARACTERS_RE, '-')
  return `cn.wuwiii.desktop.dev.${runtimeIdentity}`
}

const desktopAppEdition = resolveDesktopAppEdition()
const desktopFeatureManifest = createDesktopFeatureManifest(desktopAppEdition)
// NOTICE: Keep this a build-time constant so consumer bundles omit the
// desktop DevTools window chunk instead of merely hiding its entrypoints.
const developerToolsEnabled = import.meta.env.VITE_DESKTOP_DEVELOPER_TOOLS_ENABLED
const workbenchEnabled = desktopFeatureManifest.features.workbench
const windowsAngleBackend = import.meta.env.VITE_WINDOWS_ANGLE_BACKEND
const desktopDiagnostics = setupDesktopDiagnostics(app, { angleBackend: windowsAngleBackend })
let startupWindow: ReturnType<typeof setupStartupWindow> | undefined
let quitCleanupStarted = false

if (developerToolsEnabled)
  setupDebugger()

function signalPrelaunchSplashReady() {
  startupWindow?.close()
  startupWindow = undefined

  const readyFile = env.AIRI_PRELAUNCH_READY_FILE
  if (!readyFile)
    return

  try {
    writeFileSync(readyFile, '')
    desktopDiagnostics.record('prelaunch-ready-marker-written')
  }
  catch (error) {
    console.warn('[Startup] Failed to close the prelaunch splash:', error)
  }
}

// Thanks to [@blurymind](https://github.com/blurymind),
//
// When running Electron on Linux, navigator.gpu.requestAdapter() fails.
// In order to enable WebGPU and process the shaders fast enough, we need the following
// command line switches to be set.
//
// https://github.com/electron/electron/issues/41763#issuecomment-2051725363
// https://github.com/electron/electron/issues/41763#issuecomment-3143338995

// Collect all feature flags to enable
const enabledFeatures: string[] = []

if (isLinux) {
  enabledFeatures.push('SharedArrayBuffer', 'Vulkan', 'VaapiVideoDecoder')

  // NOTICE: we need UseOzonePlatform, WaylandWindowDecorations for working on Wayland.
  // Partially related to https://github.com/electron/electron/issues/41551, since X11 is deprecating now,
  // we can safely remove the feature flags for Electron once they made it default supported.
  // Fixes: https://github.com/moeru-ai/airi/issues/757
  // Ref: https://github.com/mmaura/poe2linuxcompanion/blob/90664607a147ea5ccea28df6139bd95fb0ebab0e/electron/main/index.ts#L28-L46
  if (env.XDG_SESSION_TYPE === 'wayland') {
    enabledFeatures.push('GlobalShortcutsPortal', 'UseOzonePlatform', 'WaylandWindowDecorations')
  }
}

// Electron enables hardware acceleration by default. Keep WebGL explicit for
// the character renderer, but let Chromium choose the stable raster/compositor
// path for normal windows unless a GPU diagnostic explicitly overrides it.
app.commandLine.appendSwitch('enable-webgl')
if (isWindows) {
  // NOTICE: Electron 40 enables enlarged transparent HWND surfaces by default.
  // Moving a large transparent surface invalidates the shared Windows compositor
  // area and makes every companion window visibly stall during a drag.
  app.commandLine.appendSwitch('disable-features', 'EnableTransparentHwndEnlargement')
}
if (isWindows && windowsAngleBackend) {
  // NOTICE: This is a diagnostic override only. Forcing a software backend for
  // packaged apps can prevent otherwise healthy Windows BrowserWindows from painting.
  app.commandLine.appendSwitch('use-angle', windowsAngleBackend)
  // NOTICE: Chromium no longer enables the software WebGL fallback implicitly.
  // This opt-in supports the local app's WebGL surfaces, such as Live2D; it does
  // not make embedded content trusted. Workbench HTML previews remain isolated
  // by their iframe sandbox.
  if (windowsAngleBackend === 'swiftshader')
    app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  log.warn(`[GPU] Using the ${windowsAngleBackend} ANGLE backend for Windows consumer compatibility.`)
}
if (envFlagEnabled(env.APP_FORCE_GPU_RASTERIZATION)) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  log.warn('[GPU] Forced GPU rasterization enabled via APP_FORCE_GPU_RASTERIZATION.')
}
if (isWindows && envFlagEnabled(env.APP_DISABLE_DIRECT_COMPOSITION)) {
  // NOTICE: Windows DirectComposition can report WebGL context loss around
  // transparent Electron panels during large/maximize compositor transitions.
  // Chromium exposes this switch for D3D11 swap-chain / context-loss cases:
  // `https://chromium.googlesource.com/chromium/src/+/eab34e6417c78846fd3c185879269cdac17bd68b/ui/gl/gl_switches.cc`
  // `https://issues.chromium.org/issues/40140646`
  app.commandLine.appendSwitch('disable-direct-composition')
  log.warn('[GPU] DirectComposition disabled via APP_DISABLE_DIRECT_COMPOSITION.')
}

// NOTICE: Live2D rendering requires WebGL. Disabling the software rasterizer removes
// Electron's SwiftShader fallback, which can turn GPU blocklist / driver issues into a
// hard "WebGL unsupported" failure. Keep the fallback enabled by default and only disable
// it when explicitly debugging GPU behavior.
if (envFlagEnabled(env.APP_DISABLE_SOFTWARE_RASTERIZER)) {
  app.commandLine.appendSwitch('disable-software-rasterizer')
  log.warn('[GPU] Software WebGL fallback disabled via APP_DISABLE_SOFTWARE_RASTERIZER.')
}

// Apply all feature flags at once (multiple appendSwitch calls with same key will override)
if (enabledFeatures.length > 0) {
  app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','))
}

// Enable unsafe WebGPU for Linux
if (isLinux) {
  app.commandLine.appendSwitch('enable-unsafe-webgpu')
}

app.dock?.setIcon(icon)
// NOTICE: `@electron-toolkit/utils/dist/index.mjs:14-16` substitutes process.execPath
// in development. Calling Electron directly keeps Wuwiii's taskbar identity.
const desktopAppUserModelId = app.isPackaged ? 'cn.wuwiii.desktop.development' : resolveDevelopmentAppUserModelId()
if (isWindows)
  app.setAppUserModelId(desktopAppUserModelId)

if (singleInstance.isPrimary)
  initScreenCaptureForMain({ onDiagnostic: desktopDiagnostics.record })

singleInstance.isPrimary && app.whenReady().then(async () => {
  setupMediaPermissions(session.defaultSession)
  startupWindow = app.isPackaged ? setupStartupWindow() : undefined

  // NOTICE: Development startup does not migrate consumer login items.

  desktopDiagnostics.record('electron-app-ready')
  injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

  // 设置 Content Security Policy
  // 在开发环境中需要允许 unsafe-eval 用于 HMR 和开发工具
  // 在生产环境中使用更严格的策略
  const isDev = !app.isPackaged
  const cspDirectives = [
    'default-src \'self\'',
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? ' \'unsafe-eval\'' : ''} https://cdn.jsdelivr.net https://us-assets.i.posthog.com`,
    `script-src-elem 'self' 'unsafe-inline'${isDev ? ' \'unsafe-eval\'' : ''} https://cdn.jsdelivr.net https://us-assets.i.posthog.com`,
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' data: blob: https: http://127.0.0.1:* http://localhost:*',
    'font-src \'self\' data: https://fonts.gstatic.com',
    'connect-src \'self\' ws: wss: http: https: data: blob:',
    'media-src \'self\' blob: http://127.0.0.1:* http://localhost:*',
    'frame-src \'self\' http://127.0.0.1:* http://localhost:*',
    'worker-src \'self\' blob:',
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives],
      },
    })
  })

  const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
  const electronApp = injeca.provide('host:electron:app', () => app)
  const autoUpdater = injeca.provide('services:auto-updater', () => setupAutoUpdater({
    enabled: import.meta.env.VITE_DESKTOP_UPDATES_ENABLED,
  }))

  const i18n = injeca.provide('libs:i18n', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => createI18n({ messages, locale: dependsOn.appConfig.get()?.language }),
  })

  const serverChannel = injeca.provide('modules:channel-server', {
    dependsOn: { app: electronApp },
    build: async () => setupServerChannel(),
  })

  const protectedResources = injeca.provide('modules:protected-resources', {
    build: () => setupProtectedResourcesRegistryService(),
  })

  const agentSessionController = injeca.provide('modules:agent-session-controller', {
    build: () => setupAgentSessionControllerService(),
  })

  const butlerTasks = injeca.provide('modules:butler-tasks', {
    build: () => setupButlerTaskService(),
  })

  const workbenchMemory = injeca.provide('modules:workbench-memory', {
    build: () => setupWorkbenchMemoryService(),
  })

  const workbenchWorkspace = injeca.provide('modules:workbench-workspace', {
    build: () => setupWorkbenchWorkspaceService(),
  })

  const workbenchStaticPreview = injeca.provide('modules:workbench-static-preview', {
    dependsOn: { workbenchWorkspace },
    build: async ({ dependsOn }) => setupWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => dependsOn.workbenchWorkspace.getStatus().workspaces.map(workspace => workspace.root),
    }),
  })

  const commandExecution = injeca.provide('modules:command-execution', {
    dependsOn: { protectedResources, workbenchWorkspace },
    build: async ({ dependsOn }) => setupCommandExecutionService({
      protectedResources: dependsOn.protectedResources,
      resolveWorkspaceProtectedPaths: (workspaceRoot) => {
        const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot)
        const activeWorkspace = dependsOn.workbenchWorkspace
          .getStatus()
          .workspaces
          .find((workspace) => {
            return normalizeWorkspaceRoot(workspace.root) === normalizedWorkspaceRoot
          })

        return activeWorkspace?.protectedPaths ?? []
      },
    }),
  })

  const workbenchCommandRunner = injeca.provide('modules:workbench-command-runner', {
    dependsOn: { agentSessionController, workbenchMemory, workbenchWorkspace },
    build: ({ dependsOn }) => setupWorkbenchCommandRunnerService({
      agentSessionController: dependsOn.agentSessionController,
      workbenchMemory: dependsOn.workbenchMemory,
      workbenchWorkspace: dependsOn.workbenchWorkspace,
    }),
  })

  const workbenchAgentRuntime = injeca.provide('modules:workbench-agent-runtime', {
    dependsOn: { agentSessionController, commandExecution, workbenchCommandRunner },
    build: ({ dependsOn }) => setupWorkbenchAgentRuntimeService({
      agentSessionController: dependsOn.agentSessionController,
      commandExecution: dependsOn.commandExecution,
      workbenchCommandRunner: dependsOn.workbenchCommandRunner,
    }),
  })

  const mcpStdioManager = injeca.provide('modules:mcp-stdio-manager', {
    build: async () => setupMcpStdioManager(),
  })

  const pluginHost = injeca.provide('modules:plugin-host', {
    dependsOn: { serverChannel },
    build: () => setupPluginHost(),
  })

  const serverChannelIpc = injeca.provide('modules:channel-server:ipc', {
    dependsOn: { serverChannel },
    build: ({ dependsOn }) => createServerChannelService({ serverChannel: dependsOn.serverChannel }),
  })

  const detachedComposer = injeca.provide('modules:detached-composer', () => createDetachedComposerService(undefined, desktopDiagnostics))
  // Register the source/editor commands before any chat renderer can load.
  // injeca.invoke schedules work; resolving here makes ordering explicit.
  await injeca.resolve({ detachedComposer })

  // BeatSync will create a background window to capture and process audio.
  const beatSync = injeca.provide('windows:beat-sync', () => setupBeatSync())

  const noticeWindow = injeca.provide('windows:notice', {
    dependsOn: { i18n, serverChannel },
    build: ({ dependsOn }) => setupNoticeWindowManager(dependsOn),
  })

  const widgetsManager = injeca.provide('windows:widgets', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupWidgetsWindowManager(dependsOn),
  })

  const aboutWindow = injeca.provide('windows:about', {
    dependsOn: { autoUpdater, i18n, serverChannel },
    build: ({ dependsOn }) => setupAboutWindowReusable(dependsOn),
  })

  const workbenchWindow = injeca.provide('windows:workbench', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, i18n },
    build: ({ dependsOn }) => setupWorkbenchWindowReusableFunc({ ...dependsOn, developerToolsEnabled }),
  })

  const settingsWindow = injeca.provide('windows:settings', {
    dependsOn: { widgetsManager, beatSync, autoUpdater, serverChannel, mcpStdioManager, i18n },
    build: async ({ dependsOn }) => setupSettingsWindowReusableFunc({
      ...dependsOn,
      appUserModelId: desktopAppUserModelId,
      developerToolsEnabled,
      devtoolsMarkdownStressWindow: developerToolsEnabled
        ? (await import('./windows/devtools')).setupDevtoolsWindow()
        : undefined,
    }),
  })

  const chatWindow = injeca.provide('windows:chat', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, i18n, settingsWindow },
    build: ({ dependsOn }) => setupChatWindowReusableFunc({ ...dependsOn, developerToolsEnabled }),
  })

  const quickChatWindow = injeca.provide('windows:quick-chat', {
    dependsOn: { serverChannel, settingsWindow, i18n },
    build: ({ dependsOn }) => setupQuickChatWindowManager(dependsOn),
  })

  const butlerWindow = injeca.provide('windows:butler', {
    dependsOn: { settingsWindow, chatWindow, workbenchWindow, quickChatWindow, serverChannel, i18n },
    build: ({ dependsOn }) => setupButlerWindowManager({ ...dependsOn, workbenchEnabled }),
  })

  const mainWindow = injeca.provide('windows:main', {
    // NOTICE: The renderer invokes command and plugin IPC during bootstrap.
    // Make handler registration a prerequisite for loading the renderer so
    // Eventa requests cannot be lost before their main-process listeners exist.
    dependsOn: { settingsWindow, chatWindow, workbenchWindow, butlerWindow, widgetsManager, quickChatWindow, noticeWindow, beatSync, autoUpdater, serverChannel, serverChannelIpc, mcpStdioManager, commandExecution, pluginHost, i18n },
    build: async ({ dependsOn }) => setupMainWindow({
      ...dependsOn,
      developerToolsEnabled,
      onRendererBootstrapVisible: signalPrelaunchSplashReady,
      onRendererRuntimeReady: () => {
        desktopDiagnostics.record('main-renderer-runtime-ready')
        // Production launches must expose the quick-chat surface after the
        // main renderer has completed its handshake. Merely pre-creating the
        // hidden window leaves a clean install looking as if the feature is
        // missing until the user discovers the tray action.
        void dependsOn.quickChatWindow.openWindow()
          .catch(error => console.warn('[QuickChatWindow] Failed to open after main renderer became ready:', error))
      },
      openDesktopDiagnostics: () => {
        if (desktopDiagnostics.logFile)
          shell.showItemInFolder(desktopDiagnostics.logFile)
      },
      reportRendererCapabilities: desktopDiagnostics.recordRendererCapabilities,
      exportDesktopDiagnostics: async () => {
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: 'wuwiii-desktop-diagnostics.jsonl',
          filters: [{ extensions: ['jsonl'], name: 'Wuwiii diagnostics' }],
          title: 'Export Wuwiii diagnostics',
        })
        if (canceled || !filePath)
          return false

        return desktopDiagnostics.exportCopy(filePath)
      },
      workbenchEnabled,
    }),
  })

  const butlerReminders = injeca.provide('modules:butler-reminders', {
    dependsOn: { butlerTasks, butlerWindow, mainWindow },
    build: async ({ dependsOn }) => {
      const butlerRendererWindow = await dependsOn.butlerWindow.getWindow()
      return setupButlerReminderService({
        eventTargets: [dependsOn.mainWindow, butlerRendererWindow],
        initialTasks: await dependsOn.butlerTasks.readAll(),
        sourceWindow: butlerRendererWindow,
        taskService: dependsOn.butlerTasks,
      })
    },
  })

  const conversationNavigation = injeca.provide('modules:conversation-navigation', {
    dependsOn: { chatWindow },
    build: ({ dependsOn }) => createConversationNavigationService(dependsOn.chatWindow),
  })
  await injeca.resolve({ conversationNavigation })

  injeca.invoke({
    dependsOn: { mainWindow },
    callback: ({ mainWindow }) => {
      singleInstance.setActivationOwner(() => toggleWindowShow(mainWindow))
    },
  })

  injeca.invoke({
    dependsOn: { butlerReminders },
    callback: () => undefined,
  })

  injeca.invoke({
    dependsOn: { mainWindow, butlerWindow },
    callback: ({ butlerWindow }) => {
      void butlerWindow.openWindow()
        .catch(error => console.warn('[ButlerWindow] Failed to open butler window:', error))
    },
  })

  const captionWindow = injeca.provide('windows:caption', {
    dependsOn: { mainWindow, serverChannel, i18n },
    build: async ({ dependsOn }) => setupCaptionWindowManager(dependsOn),
  })

  const quickChatDialogueOverlayWindow = injeca.provide('windows:quick-chat-dialogue-overlay', {
    dependsOn: { mainWindow, serverChannel, i18n },
    build: ({ dependsOn }) => setupQuickChatDialogueOverlayWindowManager(dependsOn),
  })

  injeca.invoke({
    dependsOn: { quickChatDialogueOverlayWindow },
    callback: ({ quickChatDialogueOverlayWindow }) => {
      void quickChatDialogueOverlayWindow.openWindow()
        .catch(error => console.warn('[QuickChatDialogueOverlayWindow] Failed to open dialogue overlay:', error))
    },
  })

  const tray = injeca.provide('app:tray', {
    dependsOn: { mainWindow, settingsWindow, captionWindow, quickChatWindow, butlerWindow, widgetsWindow: widgetsManager, serverChannel, beatSyncBgWindow: beatSync, aboutWindow, i18n },
    build: async ({ dependsOn }) => setupTray({ ...dependsOn, developerToolsEnabled }),
  })

  if (workbenchEnabled) {
    injeca.invoke({
      dependsOn: { mainWindow, tray, workbenchWindow, serverChannel, serverChannelIpc, pluginHost, mcpStdioManager, protectedResources, commandExecution, agentSessionController, workbenchMemory, workbenchWorkspace, workbenchStaticPreview, workbenchCommandRunner, workbenchAgentRuntime },
      callback: () => {
        // Keep workbench services ready, but create its heavy renderer only
        // when the user opens it so startup does not compete for Vite transforms.
        console.info('[WorkbenchWindow] Deferred renderer creation until first open.')
      },
    })
  }
  else {
    injeca.invoke({
      dependsOn: { mainWindow, tray, serverChannel, serverChannelIpc, pluginHost, mcpStdioManager, protectedResources, commandExecution, agentSessionController, workbenchWorkspace },
      callback: () => {
        console.info('[WorkbenchWindow] Skipped workbench warm-up for consumer edition.')
      },
    })
  }

  injeca.start().catch((err) => {
    desktopDiagnostics.record('dependency-start-failed', {
      errorName: err instanceof Error ? err.name : 'UnknownError',
      message: err instanceof Error ? err.message : String(err),
    })
    console.error(err)
  })

  // Lifecycle
  emitAppReady()

  // Extra
  if (developerToolsEnabled)
    openDebugger()

  // Open or close DevTools by F12 only in developer editions,
  // and keep production shortcut blocking for packaged editions.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    if (developerToolsEnabled || app.isPackaged)
      optimizer.watchWindowShortcuts(window)
  })
}).catch((err) => {
  startupWindow?.close()
  startupWindow = undefined
  desktopDiagnostics.record('electron-app-initialization-failed', {
    errorName: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
  })
  log.withError(err).error('Error during app initialization')
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  desktopDiagnostics.record('electron-window-all-closed')
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

// Clean up server and intervals when app quits
app.on('before-quit', (event) => {
  desktopDiagnostics.record('electron-before-quit', { cleanupStarted: quitCleanupStarted })
  if (quitCleanupStarted)
    return

  event.preventDefault()
  quitCleanupStarted = true
  startupWindow?.close()
  startupWindow = undefined
  // External MCP processes and sockets must never hold the user-visible exit.
  void emitAppBeforeQuit()
  void injeca.stop()
  app.exit(0)
})
