<script setup lang="ts">
import type { ProductAnnouncement, ProductRelease } from './modules/product-notices'

import { defineInvokeHandler } from '@moeru/eventa'
import { useElectronScreenCapture } from '@proj-airi/electron-screen-capture/vue'
import { useElectronAutoUpdater, useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { BackgroundProvider } from '@proj-airi/stage-layouts/components/Backgrounds'
import { themeColorFromValue, useThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { OnboardingDialog } from '@proj-airi/stage-ui/components'
import { client } from '@proj-airi/stage-ui/composables/api'
import { isVisionScreenshotOwnerHash, useAutomaticVisionScreenshot } from '@proj-airi/stage-ui/composables/use-automatic-vision-screenshot'
import { provideDisplayModelFilePicker } from '@proj-airi/stage-ui/composables/use-display-model-file-dialog'
import { provideVisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import { useMcpRuntimeStatusStore } from '@proj-airi/stage-ui/stores/mcp-runtime'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useSettingsGeneral } from '@proj-airi/stage-ui/stores/settings/general'
import { getSettingsSurfaceStyle, useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { Button, useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { toast, Toaster } from 'vue-sonner'

import ResizeHandler from './components/ResizeHandler.vue'

import {
  electronAppQuit,
  electronButlerRendererRuntimeReady,
  electronExportDesktopDiagnostics,
  electronGetServerChannelConfig,
  electronMainRendererBootstrapVisible,
  electronMainRendererRuntimeReady,
  electronMcpCallTool,
  electronMcpGetRuntimeStatus,
  electronMcpListTools,
  electronOpenDesktopDiagnostics,
  electronPickDisplayModelFile,
  electronPluginInspect,
  electronPluginList,
  electronPluginLoad,
  electronPluginLoadEnabled,
  electronPluginSetEnabled,
  electronPluginUnload,
  electronPluginUpdateCapability,
  electronRendererStateSyncRequested,
  electronReportDesktopCapabilities,
  electronSettingsRouteRequested,
  i18nSetLocale,
  pluginProtocolListProviders,
  pluginProtocolListProvidersEventName,
  quickChatRendererRuntimeReady,
} from '../shared/eventa'
import { createDesktopDisplayModelFilePicker } from './modules/display-model-file-picker'
import {
  announcementPreview,
  announcementStorageKey,
  matchingProductRelease,
  mergeCachedAnnouncements,
  parseCachedAnnouncements,
  parseSeenAnnouncementKeys,
  productUpdateAnnouncementState,
  rememberAnnouncementKey,
  selectUnseenAnnouncements,
} from './modules/product-notices'
import { resyncRendererState } from './modules/renderer-state-sync'
import { createDesktopVisionScreenCapture } from './modules/vision-screen-capture'
import { useServerChannelSettingsStore } from './stores/settings/server-channel'

const { isDark: dark } = useTheme()
const i18n = useI18n()
const settingsGeneralStore = useSettingsGeneral()
const settingsThemeStore = useSettingsTheme()
const onboardingStore = useOnboardingStore()
const { selectedOption: selectedBackground } = storeToRefs(useBackgroundStore())
const { shouldShowSetup } = storeToRefs(onboardingStore)
const { language } = storeToRefs(settingsGeneralStore)
const { chatSurfaceOpacity, settingsSurfacePreset, themeColorsHue, themeColorsHueDynamic } = storeToRefs(settingsThemeStore)
const serverChannelSettingsStore = useServerChannelSettingsStore()
const router = useRouter()
const route = useRoute()
const quitApp = useElectronEventaInvoke(electronAppQuit)
const DEVTOOLS_FLOATING_SELECTORS = [
  '#__vue-devtools-container__ > .vue-devtools__anchor',
  '#vue-devtools-container > .vue-devtools__anchor',
  'vue-devtools-anchor',
]
const LEGACY_DEVTOOLS_CONTAINER_SELECTORS = [
  '#__vue-devtools-container__',
  '#vue-devtools-container',
  'vue-devtools',
]
const isStageRoute = computed(() => route.path === '/')
const isSettingsRoute = computed(() => route.path.startsWith('/settings'))
const isChatRoute = computed(() => route.path === '/chat')
const isComposerRoute = computed(() => route.path === '/composer')
const isQuickChatRoute = computed(() => route.path === '/quick-chat')
const isWorkbenchRoute = computed(() => route.path === '/workbench')
const isQuickChatDialogueOverlayRoute = computed(() => route.path === '/quick-chat-dialogue-overlay')
const chatSurfaceStyle = computed(() => ({
  '--airi-chat-surface-opacity': String(Math.min(1, Math.max(0, chatSurfaceOpacity.value))),
  '--airi-chat-surface-opacity-pct': `${Math.round(Math.min(1, Math.max(0, chatSurfaceOpacity.value)) * 100)}%`,
}))
const workbenchSurfaceStyle = computed(() => ({
  ...getSettingsSurfaceStyle(settingsSurfacePreset.value, dark.value, chatSurfaceOpacity.value),
  ...chatSurfaceStyle.value,
}))
const shouldHideDevtoolsFloatingEntrypoints = computed(() => !route.path.startsWith('/devtools'))
const shouldInitializeFullAppRuntime = computed(() => isStageRoute.value)
const shouldInitializeCardRuntime = computed(() => isStageRoute.value || isChatRoute.value || isQuickChatRoute.value || isWorkbenchRoute.value)
const shouldInitializeChatRuntime = computed(() => isStageRoute.value || isChatRoute.value || isQuickChatRoute.value || isWorkbenchRoute.value)
const shouldRegisterRuntimeBridges = computed(() => isStageRoute.value || isChatRoute.value || isQuickChatRoute.value || isWorkbenchRoute.value)
const shouldInitializeStageRuntime = computed(() => isStageRoute.value)
const shouldInitializeCharacterRuntime = computed(() => isStageRoute.value || isQuickChatRoute.value || isQuickChatDialogueOverlayRoute.value)
const shouldMountChatSpeechRuntime = computed(() => isChatRoute.value || isQuickChatRoute.value)
// The main stage owns the single desktop bootstrap screen. Auxiliary windows
// wait for the main process preload handshake instead of showing their own.
const needsVisibleRuntimeBootstrap = computed(() => isStageRoute.value)
// The stage starts with its own visible loading card. The prelaunch window is
// dismissed only after this surface has painted, avoiding a blank handoff.
const runtimeReady = ref(false)
const runtimeProgress = ref(0)
const runtimePhaseKey = ref('tamagotchi.stage.bootstrap.starting')
const runtimeError = ref('')
const runtimeErrorDetails = ref('')
const shouldShowRuntimeBootstrap = computed(() => needsVisibleRuntimeBootstrap.value && !runtimeReady.value)
const runtimePhaseLabel = computed(() => i18n.t(runtimePhaseKey.value))
const ChatSpeechRuntime = defineAsyncComponent(() => import('@proj-airi/stage-ui/components/speech').then(module => module.ChatSpeechRuntime))
const runtimeCleanups: (() => void)[] = []
let devtoolsFloatingObserver: MutationObserver | undefined
let productNoticesRefreshTimer: number | undefined

const context = useElectronEventaContext()

context.value.on(electronRendererStateSyncRequested, () => {
  void resyncRendererState({
    refreshAccount: async () => {
      const { fetchSession } = await import('@proj-airi/stage-ui/libs/auth')
      await fetchSession()
    },
    refreshProfileAndSettings: async () => {
      const [
        { refreshLocalStorageManualResetBindings },
        { useSettingsQuickChat },
        { useSpeechPlaybackSettingsStore },
      ] = await Promise.all([
        import('@proj-airi/stage-shared/composables'),
        import('@proj-airi/stage-ui/stores/settings/quick-chat'),
        import('@proj-airi/stage-ui/stores/settings/speech-playback'),
      ])
      refreshLocalStorageManualResetBindings()
      useSettingsQuickChat().loadFromStorage()
      useSpeechPlaybackSettingsStore().loadFromStorage()
    },
    refreshChatSessions: shouldInitializeChatRuntime.value
      ? async () => {
        const { useChatSessionStore } = await import('@proj-airi/stage-ui/stores/chat/session-store')
        await useChatSessionStore().refreshFromPersistence()
      }
      : undefined,
  }).catch(error => console.warn('[App] Failed to re-sync renderer state:', error))
})
const getServerChannelConfig = useElectronEventaInvoke(electronGetServerChannelConfig)
const listPlugins = useElectronEventaInvoke(electronPluginList)
const setPluginEnabled = useElectronEventaInvoke(electronPluginSetEnabled)
const loadEnabledPlugins = useElectronEventaInvoke(electronPluginLoadEnabled)
const loadPlugin = useElectronEventaInvoke(electronPluginLoad)
const unloadPlugin = useElectronEventaInvoke(electronPluginUnload)
const inspectPluginHost = useElectronEventaInvoke(electronPluginInspect)
const reportPluginCapability = useElectronEventaInvoke(electronPluginUpdateCapability)
const listMcpTools = useElectronEventaInvoke(electronMcpListTools)
const callMcpTool = useElectronEventaInvoke(electronMcpCallTool)
const getMcpRuntimeStatus = useElectronEventaInvoke(electronMcpGetRuntimeStatus)
const setLocale = useElectronEventaInvoke(i18nSetLocale)
const notifyMainRendererBootstrapVisible = useElectronEventaInvoke(electronMainRendererBootstrapVisible)
const notifyMainRendererRuntimeReady = useElectronEventaInvoke(electronMainRendererRuntimeReady)
const openDesktopDiagnostics = useElectronEventaInvoke(electronOpenDesktopDiagnostics)
const exportDesktopDiagnostics = useElectronEventaInvoke(electronExportDesktopDiagnostics)
const reportDesktopCapabilities = useElectronEventaInvoke(electronReportDesktopCapabilities)
const pickDisplayModelFile = useElectronEventaInvoke(electronPickDisplayModelFile)
const notifyButlerRendererRuntimeReady = useElectronEventaInvoke(electronButlerRendererRuntimeReady)
const notifyQuickChatRendererRuntimeReady = useElectronEventaInvoke(quickChatRendererRuntimeReady)
provideDisplayModelFilePicker(createDesktopDisplayModelFilePicker(pickDisplayModelFile))
let visionCaptureOptions = { types: ['screen', 'window'] as Array<'screen' | 'window'>, thumbnailSize: { width: 480, height: 270 } }
const { getSources: getVisionScreenSources } = useElectronScreenCapture(window.electron.ipcRenderer, () => visionCaptureOptions)
const visionScreenCapture = createDesktopVisionScreenCapture((options) => {
  visionCaptureOptions = options
  return getVisionScreenSources()
})
provideVisionScreenCapture(visionScreenCapture)
// Capture the window role before routing initializes; auxiliary windows must
// not acquire ownership while their route temporarily looks like the stage.
const isMainStageWindow = isVisionScreenshotOwnerHash(window.location.hash)
useAutomaticVisionScreenshot(visionScreenCapture, isMainStageWindow, isStageRoute)
const {
  state: autoUpdaterState,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
} = useElectronAutoUpdater()
let announcedUpdateState = ''
const latestProductRelease = ref<ProductRelease | null>(null)
const requiredUpdateRelease = ref<ProductRelease | null>(null)
const SEEN_ANNOUNCEMENTS_STORAGE_KEY = 'airi/product-notices/seen-announcements'
const CACHED_ANNOUNCEMENTS_STORAGE_KEY = 'airi/product-notices/cached-announcements'
const desktopUpdateChannel = import.meta.env.VITE_DESKTOP_UPDATE_CHANNEL || 'latest'
const requiredUpdateBusy = computed(() => autoUpdaterState.value.status === 'checking' || autoUpdaterState.value.status === 'downloading')
const requiredUpdateProgress = computed(() => autoUpdaterState.value.status === 'downloading'
  ? Math.round(autoUpdaterState.value.progress?.percent ?? 0)
  : 0)

async function handleRequiredUpdate() {
  if (autoUpdaterState.value.status === 'downloaded') {
    await quitAndInstall()
    return
  }
  if (autoUpdaterState.value.status === 'available') {
    await downloadUpdate()
    return
  }
  await checkForUpdates()
}

function showAnnouncement(announcement: ProductAnnouncement) {
  const options = {
    description: announcementPreview(announcement.body),
    duration: announcement.level === 'critical' ? Number.POSITIVE_INFINITY : 20000,
  }
  if (announcement.level === 'critical')
    toast.error(announcement.title, options)
  else if (announcement.level === 'warning')
    toast.warning(announcement.title, options)
  else
    toast.info(announcement.title, options)
}

async function refreshProductNotices() {
  if (import.meta.env.DEV || !isStageRoute.value)
    return

  const [announcementsResult, releaseResult] = await Promise.allSettled([
    client.api.announcements.$get({ query: { locale: language.value } }),
    client.api.releases.$get({ query: { channel: desktopUpdateChannel } }),
  ])

  if (announcementsResult.status === 'fulfilled' && announcementsResult.value.ok) {
    const { announcements } = await announcementsResult.value.json()
    const cached = mergeCachedAnnouncements(
      parseCachedAnnouncements(window.localStorage.getItem(CACHED_ANNOUNCEMENTS_STORAGE_KEY)),
      announcements,
    )
    window.localStorage.setItem(CACHED_ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify(cached))
    let seenKeys = parseSeenAnnouncementKeys(window.localStorage.getItem(SEEN_ANNOUNCEMENTS_STORAGE_KEY))
    for (const announcement of selectUnseenAnnouncements(announcements, seenKeys)) {
      const key = announcementStorageKey(announcement)
      showAnnouncement(announcement)
      seenKeys = rememberAnnouncementKey(seenKeys, key)
    }
    window.localStorage.setItem(SEEN_ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify(seenKeys))
  }

  if (releaseResult.status === 'fulfilled' && releaseResult.value.ok) {
    const { release } = await releaseResult.value.json()
    latestProductRelease.value = release
  }
}

function normalizeSettingsRoute(targetRoute?: string) {
  const route = targetRoute?.trim()
  if (!route?.startsWith('/settings'))
    return '/settings'

  return route
}

async function pushSettingsRoute(targetRoute?: string) {
  const route = normalizeSettingsRoute(targetRoute)
  if (router.currentRoute.value.fullPath === route)
    return

  await router.push(route)
}

context.value.on(electronSettingsRouteRequested, (event) => {
  void pushSettingsRoute(event.body?.route)
})

function hideDevtoolsFloatingEntrypoints() {
  if (shouldHideDevtoolsFloatingEntrypoints.value) {
    for (const selector of LEGACY_DEVTOOLS_CONTAINER_SELECTORS) {
      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        // NOTICE: The transparent desktop stage is sensitive to injected fixed
        // surfaces. Removing the Vue DevTools container on non-devtools routes
        // avoids a hidden Chromium layer being composited behind Live2D.
        element.remove()
      })
    }
  }

  for (const selector of DEVTOOLS_FLOATING_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (shouldHideDevtoolsFloatingEntrypoints.value) {
        element.style.setProperty('display', 'none', 'important')
        element.style.setProperty('visibility', 'hidden', 'important')
        element.style.setProperty('pointer-events', 'none', 'important')
      }
      else {
        element.style.removeProperty('display')
        element.style.removeProperty('visibility')
        element.style.removeProperty('pointer-events')
      }
    })
  }
}

watch(shouldHideDevtoolsFloatingEntrypoints, (shouldHide) => {
  document.documentElement.classList.toggle('hide-vue-devtools-floating', shouldHide)
  hideDevtoolsFloatingEntrypoints()
}, { immediate: true })

async function registerRuntimeBridges() {
  const [
    { usePluginHostInspectorStore },
    { setMcpToolBridge, clearMcpToolBridge },
  ] = await Promise.all([
    import('@proj-airi/stage-ui/stores/devtools/plugin-host-debug'),
    import('@proj-airi/stage-ui/stores/mcp-tool-bridge'),
  ])
  const pluginHostInspectorStore = usePluginHostInspectorStore()

  // NOTICE: register plugin host bridge during setup to avoid race with pages using it in immediate watchers.
  pluginHostInspectorStore.setBridge({
    list: () => listPlugins(),
    setEnabled: payload => setPluginEnabled(payload),
    loadEnabled: () => loadEnabledPlugins(),
    load: payload => loadPlugin(payload),
    unload: payload => unloadPlugin(payload),
    inspect: () => inspectPluginHost(),
  })

  // NOTICE: MCP tools are declared from stage-ui and executed during model streaming.
  // Register runtime bridge during setup to avoid missing bridge in early tool invocations.
  setMcpToolBridge({
    listTools: () => listMcpTools(),
    callTool: payload => callMcpTool(payload),
  })

  runtimeCleanups.push(() => clearMcpToolBridge())
}

async function initializeCardRuntime() {
  const { useAiriCardStore } = await import('@proj-airi/stage-ui/stores/modules/airi-card')
  const cardStore = useAiriCardStore()
  cardStore.initialize()
  await cardStore.applyActiveDisplayModel()
}

async function initializeChatRuntime() {
  const { useChatSessionStore } = await import('@proj-airi/stage-ui/stores/chat/session-store')
  await useChatSessionStore().initialize()
}

async function warmActiveChatProvider() {
  const [
    { useConsciousnessStore },
    { useProvidersStore },
  ] = await Promise.all([
    import('@proj-airi/stage-ui/stores/modules/consciousness'),
    import('@proj-airi/stage-ui/stores/providers'),
  ])
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const providerId = consciousnessStore.activeProvider
  if (!providerId)
    return

  await providersStore.startRuntimeValidation({ immediate: false })
  await providersStore.validateProvider(providerId)
  await providersStore.getProviderInstance(providerId)
  void consciousnessStore.loadModelsForProvider(providerId)
    .catch(error => console.warn('[App] Failed to load active chat models:', error))
}

async function initializeCharacterRuntime(proactiveTopicPriority: number) {
  const { useCharacterOrchestratorStore } = await import('@proj-airi/stage-ui/stores/character')
  const characterOrchestratorStore = useCharacterOrchestratorStore()
  characterOrchestratorStore.initialize({ proactiveTopicPriority })
  runtimeCleanups.push(() => {
    characterOrchestratorStore.stopProactiveTopicTimer()
    characterOrchestratorStore.stopTicker()
  })
}

async function waitForStageRendererMounted() {
  const existingError = document.documentElement.dataset.airiStageRendererError
  if (existingError)
    throw new Error(existingError)

  if (document.documentElement.dataset.airiStageMounted === 'true')
    return

  await new Promise<void>((resolve, reject) => {
    let timeout: number
    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('airi:stage-mounted', handleMounted)
      window.removeEventListener('airi:stage-renderer-error', handleError)
    }
    timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(i18n.t('tamagotchi.stage.bootstrap.failed-detail')))
    }, 45_000)
    function handleMounted() {
      cleanup()
      resolve()
    }
    function handleError(event: Event) {
      cleanup()
      const message = event instanceof CustomEvent && typeof event.detail === 'string'
        ? event.detail
        : i18n.t('tamagotchi.stage.bootstrap.failed-detail')
      reject(new Error(message))
    }
    window.addEventListener('airi:stage-mounted', handleMounted, { once: true })
    window.addEventListener('airi:stage-renderer-error', handleError, { once: true })
  })
}

watch(language, () => {
  i18n.locale.value = language.value
  setLocale(language.value)
  if (runtimeReady.value && isStageRoute.value)
    void refreshProductNotices().catch(error => console.warn('[App] Failed to refresh localized product notices:', error))
})

const { updateThemeColor } = useThemeColor(themeColorFromValue({ light: 'rgb(255 255 255)', dark: 'rgb(18 18 18)' }))
watch(dark, () => updateThemeColor(), { immediate: true })
watch(route, () => updateThemeColor(), { immediate: true })
onMounted(() => updateThemeColor())

watch([autoUpdaterState, latestProductRelease], ([state]) => {
  if (import.meta.env.DEV || !shouldInitializeFullAppRuntime.value)
    return

  const version = state.info?.version
  if (!version)
    return

  const release = matchingProductRelease(latestProductRelease.value, version)
  if (release?.forceUpdate)
    requiredUpdateRelease.value = release
  const announcementState = productUpdateAnnouncementState(state.status, version, release)
  if (announcedUpdateState === announcementState)
    return

  if (state.status === 'available') {
    announcedUpdateState = announcementState
    const toastMethod = release?.forceUpdate ? toast.warning : toast.info
    toastMethod(i18n.t(release?.forceUpdate ? 'tamagotchi.stage.update.required' : 'tamagotchi.stage.update.available', { version }), {
      action: {
        label: i18n.t('tamagotchi.stage.update.download'),
        onClick: () => downloadUpdate(),
      },
      description: release?.notes || undefined,
      duration: release?.forceUpdate ? Number.POSITIVE_INFINITY : 20000,
      id: `airi-update-${version}`,
    })
  }
  else if (state.status === 'downloaded') {
    announcedUpdateState = announcementState
    toast.success(i18n.t('tamagotchi.stage.update.downloaded', { version }), {
      action: {
        label: i18n.t('tamagotchi.stage.update.restart'),
        onClick: () => quitAndInstall(),
      },
      duration: 30000,
      id: `airi-update-${version}`,
    })
  }
}, { deep: true })

onMounted(() => {
  hideDevtoolsFloatingEntrypoints()
  devtoolsFloatingObserver = new MutationObserver(hideDevtoolsFloatingEntrypoints)
  devtoolsFloatingObserver.observe(document.documentElement, { childList: true, subtree: true })
})

function setRuntimeProgress(progress: number, phaseKey: string) {
  runtimeProgress.value = Math.max(runtimeProgress.value, Math.min(100, progress))
  runtimePhaseKey.value = phaseKey
}

function reportMainRendererBootstrapVisibleAfterPaint() {
  if (!isStageRoute.value)
    return

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void notifyMainRendererBootstrapVisible()
        .catch(error => console.warn('[App] Failed to report visible bootstrap surface:', error))
    })
  })
}

async function completeRuntimeInitialization() {
  if (isStageRoute.value)
    setRuntimeProgress(96, 'tamagotchi.stage.bootstrap.windows')

  if (isStageRoute.value)
    await notifyMainRendererRuntimeReady()
  else if (isQuickChatRoute.value)
    await notifyQuickChatRendererRuntimeReady()
  else if (route.path === '/butler')
    await notifyButlerRendererRuntimeReady()
  setRuntimeProgress(100, 'tamagotchi.stage.bootstrap.ready')
  runtimeReady.value = true

  if (isStageRoute.value) {
    document.documentElement.dataset.airiRuntimeReady = 'true'
    window.dispatchEvent(new Event('airi:desktop-runtime-ready'))
    void refreshProductNotices().catch(error => console.warn('[App] Failed to load product notices:', error))
    productNoticesRefreshTimer ??= window.setInterval(() => {
      void refreshProductNotices().catch(error => console.warn('[App] Failed to refresh product notices:', error))
    }, 15 * 60 * 1000)
  }
}

async function initializeAppRuntime() {
  runtimeError.value = ''
  runtimeProgress.value = 0
  try {
    await router.isReady()
    setRuntimeProgress(8, 'tamagotchi.stage.bootstrap.interface')

    if (isSettingsRoute.value) {
      const [serverChannelConfig, mcpRuntimeStatus] = await Promise.all([
        getServerChannelConfig().catch((error) => {
          console.warn('[App] Failed to read server channel config; keeping local settings available:', error)
          return undefined
        }),
        getMcpRuntimeStatus().catch((error) => {
          console.warn('[App] Failed to read MCP runtime status:', error)
          return undefined
        }),
      ])
      if (serverChannelConfig)
        serverChannelSettingsStore.websocketTlsConfig = serverChannelConfig.websocketTlsConfig
      if (mcpRuntimeStatus)
        useMcpRuntimeStatusStore().updateStatus(mcpRuntimeStatus)

      await completeRuntimeInitialization()
      return
    }

    if (!shouldInitializeFullAppRuntime.value) {
      if (shouldRegisterRuntimeBridges.value) {
        await registerRuntimeBridges()
        setRuntimeProgress(24, 'tamagotchi.stage.bootstrap.services')
      }

      if (shouldInitializeCardRuntime.value) {
        await initializeCardRuntime()
        setRuntimeProgress(48, 'tamagotchi.stage.bootstrap.character')
      }

      if (shouldInitializeChatRuntime.value) {
        await initializeChatRuntime()
        setRuntimeProgress(72, 'tamagotchi.stage.bootstrap.conversation')
        await warmActiveChatProvider().catch(error => console.warn('[App] Failed to warm active chat provider:', error))
        setRuntimeProgress(84, 'tamagotchi.stage.bootstrap.provider')
      }

      if (shouldInitializeCharacterRuntime.value) {
        await initializeCharacterRuntime(isQuickChatDialogueOverlayRoute.value ? 0 : 10)
        setRuntimeProgress(92, 'tamagotchi.stage.bootstrap.character')
      }

      await completeRuntimeInitialization()
      return
    }

    if (shouldRegisterRuntimeBridges.value) {
      await registerRuntimeBridges()
      setRuntimeProgress(18, 'tamagotchi.stage.bootstrap.services')
    }

    // NOTICE: The active persona owns the selected display model. Apply that
    // binding once; the renderer watches its source/model ID. A second model
    // initialization repeats the lookup and published-performance request.
    await initializeCardRuntime()
    if (shouldInitializeStageRuntime.value) {
      setRuntimeProgress(38, 'tamagotchi.stage.bootstrap.model')
      await waitForStageRendererMounted()
      setRuntimeProgress(48, 'tamagotchi.stage.bootstrap.character')
    }

    const { useSharedAnalyticsStore } = await import('@proj-airi/stage-ui/stores/analytics')

    try {
      useSharedAnalyticsStore().initialize()
    }
    catch (error) {
      console.warn('[App] Analytics initialization failed; continuing without analytics:', error)
    }
    await onboardingStore.initializeSetupCheck()
    setRuntimeProgress(54, 'tamagotchi.stage.bootstrap.character')

    await initializeChatRuntime()
    setRuntimeProgress(68, 'tamagotchi.stage.bootstrap.conversation')
    await warmActiveChatProvider().catch(error => console.warn('[App] Failed to warm active chat provider:', error))
    setRuntimeProgress(72, 'tamagotchi.stage.bootstrap.provider')

    const serverChannelConfig = await getServerChannelConfig().catch((error) => {
      console.warn('[App] Failed to read server channel config; continuing with local chat:', error)
      return undefined
    })
    if (serverChannelConfig)
      serverChannelSettingsStore.websocketTlsConfig = serverChannelConfig.websocketTlsConfig
    setRuntimeProgress(76, 'tamagotchi.stage.bootstrap.services')

    const [
      { useModsServerChannelStore },
      { useContextBridgeStore },
    ] = await Promise.all([
      import('@proj-airi/stage-ui/stores/mods/api/channel-server'),
      import('@proj-airi/stage-ui/stores/mods/api/context-bridge'),
    ])
    const contextBridgeStore = useContextBridgeStore()

    await useModsServerChannelStore().initialize({ possibleEvents: ['ui:configure'] }).catch(err => console.error('Failed to initialize Mods Server Channel in App.vue:', err))
    try {
      await contextBridgeStore.initialize()
      runtimeCleanups.push(() => contextBridgeStore.dispose())
    }
    catch (error) {
      await contextBridgeStore.dispose().catch(disposeError => console.warn('[App] Failed to clean up context bridge:', disposeError))
      console.warn('[App] Context bridge initialization failed; continuing without remote context sync:', error)
    }
    setRuntimeProgress(84, 'tamagotchi.stage.bootstrap.services')
    if (shouldInitializeCharacterRuntime.value) {
      await initializeCharacterRuntime(isStageRoute.value
        ? 100
        : isQuickChatDialogueOverlayRoute.value
          ? 0
          : 10)
    }
    setRuntimeProgress(92, 'tamagotchi.stage.bootstrap.character')
    const { useCommandExecutionStore } = await import('./stores/command-execution')
    await useCommandExecutionStore().refreshStatus().catch(error => console.warn('Failed to initialize command execution status:', error))

    // Expose stage provider definitions to plugin host APIs.
    const { listProvidersForPluginHost, shouldPublishPluginHostCapabilities } = await import('@proj-airi/stage-ui/stores/plugin-host-capabilities')
    defineInvokeHandler(context.value, pluginProtocolListProviders, async () => listProvidersForPluginHost())

    if (shouldPublishPluginHostCapabilities()) {
      await reportPluginCapability({
        key: pluginProtocolListProvidersEventName,
        state: 'ready',
        metadata: {
          source: 'stage-ui',
        },
      })

      // Plugin setup may call renderer-owned protocol handlers. Start enabled
      // plugins only after publishing those handlers, and keep this optional
      // work outside the visible desktop startup critical path.
      void loadEnabledPlugins()
        .catch(error => console.warn('[App] Failed to load enabled plugins:', error))
    }

    await completeRuntimeInitialization()
  }
  catch (error) {
    console.error('Uncaught renderer runtime initialization error:', error)
    runtimeErrorDetails.value = error instanceof Error ? error.message : String(error)
    runtimeError.value = i18n.t('tamagotchi.stage.bootstrap.failed-detail')
    runtimePhaseKey.value = 'tamagotchi.stage.bootstrap.failed'
  }
}

function retryAppRuntime() {
  // NOTICE: Initialization may have registered handlers and partially mutated
  // stores before failing. A clean renderer reload is the only reliable retry.
  window.location.reload()
}

function handleQuitApp() {
  void quitApp().catch(error => console.warn('[App] Failed to quit after startup error:', error))
}

function handleOpenDesktopDiagnostics() {
  void openDesktopDiagnostics()
    .catch(error => console.warn('[App] Failed to open desktop diagnostics:', error))
}

function handleExportDesktopDiagnostics() {
  void exportDesktopDiagnostics()
    .then((exported) => {
      if (exported)
        toast.success(i18n.t('tamagotchi.stage.bootstrap.diagnostics-exported'))
    })
    .catch(error => console.warn('[App] Failed to export desktop diagnostics:', error))
}

onMounted(() => {
  reportMainRendererBootstrapVisibleAfterPaint()
  void initializeAppRuntime()
  if (isMainStageWindow) {
    void import('./modules/desktop-capabilities')
      .then(({ detectDesktopRendererCapabilities }) => reportDesktopCapabilities(
        detectDesktopRendererCapabilities(typeof visionScreenCapture.listSources === 'function'),
      ))
      .catch(error => console.warn('[App] Failed to report desktop capabilities:', error))
  }
})

watch(themeColorsHue, () => {
  document.documentElement.style.setProperty('--chromatic-hue', themeColorsHue.value.toString())
}, { immediate: true })

watch(themeColorsHueDynamic, () => {
  document.documentElement.classList.toggle('dynamic-hue', themeColorsHueDynamic.value)
}, { immediate: true })

onUnmounted(() => {
  devtoolsFloatingObserver?.disconnect()
  devtoolsFloatingObserver = undefined
  document.documentElement.classList.remove('hide-vue-devtools-floating')
  if (productNoticesRefreshTimer !== undefined)
    window.clearInterval(productNoticesRefreshTimer)
  productNoticesRefreshTimer = undefined

  for (const cleanup of runtimeCleanups.splice(0)) {
    cleanup()
  }
})
</script>

<template>
  <Toaster />
  <ResizeHandler v-if="!isStageRoute" />
  <ChatSpeechRuntime v-if="shouldMountChatSpeechRuntime" />
  <OnboardingDialog
    v-if="isStageRoute && runtimeReady && !requiredUpdateRelease"
    v-model="shouldShowSetup"
    @configured="onboardingStore.markSetupCompleted"
    @skipped="onboardingStore.markSetupSkipped"
  />
  <div
    v-if="isStageRoute && requiredUpdateRelease"
    :class="[
      'fixed inset-0 z-[2147483200] grid place-items-center bg-black/55 px-5 backdrop-blur-sm',
      'font-cute',
    ]"
    role="dialog"
    aria-modal="true"
    :aria-label="i18n.t('tamagotchi.stage.update.required', { version: requiredUpdateRelease.version })"
  >
    <section
      :class="[
        'w-full max-w-[31rem] overflow-hidden rounded-lg border p-6 shadow-2xl',
        'border-[var(--airi-border-accent)] bg-[var(--airi-surface-panel)] airi-text',
      ]"
    >
      <div :class="['flex items-start gap-4']">
        <div :class="['grid size-11 shrink-0 place-items-center rounded-md airi-status-warning']">
          <span class="i-solar:shield-warning-bold-duotone size-6" />
        </div>
        <div :class="['min-w-0 flex-1']">
          <h2 :class="['text-lg font-semibold']">
            {{ i18n.t('tamagotchi.stage.update.required', { version: requiredUpdateRelease.version }) }}
          </h2>
          <p :class="['mt-1 text-sm leading-6 airi-text-muted']">
            {{ i18n.t('tamagotchi.stage.update.required-description') }}
          </p>
        </div>
      </div>

      <div
        v-if="requiredUpdateRelease.notes"
        :class="[
          'mt-5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md px-4 py-3 text-sm leading-6',
          'bg-[var(--airi-surface-control-muted)]',
        ]"
      >
        {{ requiredUpdateRelease.notes }}
      </div>

      <div v-if="autoUpdaterState.status === 'downloading'" :class="['mt-5']">
        <div :class="['mb-2 flex justify-between text-xs airi-text-muted']">
          <span>{{ i18n.t('tamagotchi.stage.update.about.downloading') }}</span>
          <span>{{ requiredUpdateProgress }}%</span>
        </div>
        <div :class="['h-2 overflow-hidden rounded-full bg-[var(--airi-surface-control-muted)]']">
          <div
            :class="['h-full rounded-full bg-[var(--airi-accent-strong)] transition-[width] duration-300']"
            :style="{ width: `${requiredUpdateProgress}%` }"
          />
        </div>
      </div>

      <p v-if="autoUpdaterState.status === 'error'" :class="['mt-4 text-sm airi-status-danger']">
        {{ i18n.t('tamagotchi.stage.update.about.error', { message: autoUpdaterState.error?.message || i18n.t('tamagotchi.stage.update.about.unknown-error') }) }}
      </p>

      <div :class="['mt-6 flex justify-end']">
        <Button
          variant="primary"
          :loading="requiredUpdateBusy"
          :disabled="requiredUpdateBusy"
          :icon="autoUpdaterState.status === 'downloaded' ? 'i-solar:restart-bold' : 'i-solar:download-minimalistic-outline'"
          @click="handleRequiredUpdate"
        >
          {{ autoUpdaterState.status === 'downloaded'
            ? i18n.t('tamagotchi.stage.update.restart')
            : autoUpdaterState.status === 'error'
              ? i18n.t('tamagotchi.stage.update.about.retry')
              : i18n.t('tamagotchi.stage.update.download') }}
        </Button>
      </div>
    </section>
  </div>
  <div
    :class="[
      'h-full w-full transition-opacity duration-300',
      shouldShowRuntimeBootstrap ? 'pointer-events-none opacity-0' : 'opacity-100',
    ]"
    :style="isChatRoute || isComposerRoute || isQuickChatRoute ? chatSurfaceStyle : isWorkbenchRoute ? workbenchSurfaceStyle : undefined"
    :aria-hidden="shouldShowRuntimeBootstrap"
  >
    <BackgroundProvider
      v-if="(isChatRoute || isComposerRoute || isSettingsRoute || isWorkbenchRoute) && selectedBackground"
      :background="selectedBackground"
      class="h-full min-h-0"
    >
      <RouterView />
    </BackgroundProvider>
    <RouterView v-else />
  </div>

  <Transition name="runtime-bootstrap">
    <div
      v-if="shouldShowRuntimeBootstrap"
      :class="[
        'fixed inset-0 z-[2147483000] grid place-items-center px-8',
        'runtime-bootstrap-surface',
      ]"
      role="status"
      aria-live="polite"
    >
      <div :class="['runtime-bootstrap-panel w-full max-w-[23rem] flex flex-col gap-5 rounded-lg px-6 py-6']">
        <div :class="['flex items-center gap-3']">
          <div :class="['runtime-bootstrap-mark grid size-11 shrink-0 place-items-center rounded-md']">
            <span class="i-solar:stars-minimalistic-bold-duotone size-6" />
          </div>
          <div :class="['min-w-0']">
            <div :class="['airi-text text-lg font-semibold tracking-[0.08em]']">
              Wuwiii
            </div>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ i18n.t('tamagotchi.stage.bootstrap.waiting') }}
            </div>
          </div>
        </div>

        <div :class="['flex items-end justify-between gap-4']">
          <div :class="['min-w-0 truncate text-sm airi-text font-medium']">
            {{ runtimeError || runtimePhaseLabel }}
          </div>
          <span :class="['shrink-0 font-mono text-sm font-semibold airi-text']">{{ runtimeProgress }}%</span>
        </div>

        <div :class="['runtime-bootstrap-track h-2 overflow-hidden rounded-full']">
          <div
            :class="[
              'runtime-bootstrap-progress h-full rounded-full transition-[width] duration-500 ease-out',
              runtimeError ? 'opacity-55' : '',
            ]"
            :style="{ width: `${runtimeProgress}%` }"
          />
        </div>

        <div :class="['flex items-center gap-2 text-xs airi-text-muted']">
          <span :class="['runtime-bootstrap-pulse size-1.5 rounded-full']" />
          <span>{{ i18n.t('tamagotchi.stage.bootstrap.waiting') }}</span>
        </div>

        <div v-if="runtimeError" :class="['mt-1 grid grid-cols-3 gap-2']">
          <button
            type="button"
            :class="[
              'col-span-2 h-9 flex items-center justify-center gap-2 rounded-md px-3 text-sm font-medium',
              'airi-overlay-control-muted transition-colors active:scale-95',
            ]"
            @click="retryAppRuntime"
          >
            <span class="i-solar:refresh-outline size-4" />
            <span>{{ i18n.t('tamagotchi.stage.bootstrap.retry') }}</span>
          </button>
          <button
            type="button"
            :class="[
              'h-9 flex items-center justify-center gap-2 rounded-md px-3 text-sm font-medium',
              'airi-overlay-control-muted transition-colors active:scale-95',
            ]"
            @click="handleOpenDesktopDiagnostics"
          >
            <span class="i-solar:folder-open-outline size-4" />
            <span>{{ i18n.t('tamagotchi.stage.bootstrap.open-diagnostics') }}</span>
          </button>
          <button
            type="button"
            :class="[
              'h-9 flex items-center justify-center gap-2 rounded-md px-3 text-sm font-medium',
              'airi-overlay-control-muted transition-colors active:scale-95',
            ]"
            @click="handleExportDesktopDiagnostics"
          >
            <span class="i-solar:download-minimalistic-outline size-4" />
            <span>{{ i18n.t('tamagotchi.stage.bootstrap.export-diagnostics') }}</span>
          </button>
          <button
            type="button"
            :class="[
              'h-9 flex items-center justify-center gap-2 rounded-md px-3 text-sm font-medium',
              'airi-overlay-control-muted transition-colors active:scale-95',
            ]"
            @click="handleQuitApp"
          >
            <span class="i-solar:logout-2-outline size-4" />
            <span>{{ i18n.t('tamagotchi.stage.bootstrap.quit') }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
/* We need this to properly animate the CSS variable */
@property --chromatic-hue {
  syntax: '<number>';
  initial-value: 0;
  inherits: true;
}

@keyframes hue-anim {
  from {
    --chromatic-hue: 0;
  }
  to {
    --chromatic-hue: 360;
  }
}

.dynamic-hue {
  animation: hue-anim 10s linear infinite;
}

.runtime-bootstrap-enter-active,
.runtime-bootstrap-leave-active {
  transition: opacity 280ms ease;
}

.runtime-bootstrap-enter-from,
.runtime-bootstrap-leave-to {
  opacity: 0;
}

.runtime-bootstrap-surface {
  /* Keep the transparent character window transparent; only the centered panel
     below should paint a surface while the runtime is preparing. */
  background: transparent;
}

.runtime-bootstrap-panel {
  border: 1px solid color-mix(in srgb, var(--airi-border-accent) 46%, transparent);
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--airi-surface-panel) 94%, var(--airi-accent-soft)), color-mix(in srgb, var(--airi-surface-overlay) 88%, transparent));
  box-shadow:
    0 24px 72px color-mix(in srgb, var(--airi-accent-strong) 18%, transparent),
    0 12px 30px rgba(0, 0, 0, 0.14),
    inset 0 1px 0 color-mix(in srgb, white 34%, transparent);
}

.runtime-bootstrap-mark {
  color: var(--airi-accent-strong);
  background: color-mix(in srgb, var(--airi-accent-surface) 74%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 24%, transparent);
}

.runtime-bootstrap-track {
  background: color-mix(in srgb, var(--airi-surface-control-muted) 78%, transparent);
}

.runtime-bootstrap-progress {
  background: linear-gradient(90deg, var(--airi-accent-strong), var(--airi-accent-soft));
  box-shadow: 0 0 18px color-mix(in srgb, var(--airi-accent-strong) 54%, transparent);
}

.runtime-bootstrap-pulse {
  background: var(--airi-accent-strong);
  box-shadow: 0 0 10px color-mix(in srgb, var(--airi-accent-strong) 70%, transparent);
  animation: runtime-bootstrap-pulse 1.4s ease-in-out infinite;
}

@keyframes runtime-bootstrap-pulse {
  0%,
  100% {
    opacity: 0.42;
    transform: scale(0.82);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}
</style>
