import type { ComponentInternalInstance, ComponentPublicInstance, Plugin } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

import NProgress from 'nprogress'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { getStageProductEdition, isProductAudienceVisible } from '@proj-airi/stage-shared'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { isDesktopRouteEnabled } from '../shared/desktop-feature-manifest'
import { setupHttpFetchProxy } from './modules/http-fetch-proxy'
import { i18n } from './modules/i18n'

import './modules/posthog'
import '@unocss/reset/tailwind.css'
import 'splitpanes/dist/splitpanes.css'
import 'vue-sonner/style.css'
import 'uno.css'
// Fonts
import '@proj-airi/font-cjkfonts-allseto/index.css'
import '@proj-airi/font-xiaolai/index.css'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/jura'
import '@fontsource-variable/quicksand'
import '@fontsource-variable/urbanist'
import '@fontsource-variable/comfortaa'
import '@fontsource/dm-mono'
import '@fontsource/dm-serif-display'
import '@fontsource/gugi'
import '@fontsource/kiwi-maru'
import '@fontsource/m-plus-rounded-1c'
import '@fontsource/sniglet'
// KaTeX CSS for math rendering
import 'katex/dist/katex.min.css'
import './styles/main.css'

const pinia = createPinia()
setupHttpFetchProxy()

function enforceTransparentRootSurface() {
  const roots = () => [
    document.documentElement,
    document.body,
    document.getElementById('app'),
  ].filter((element): element is HTMLElement => !!element)

  const enforce = () => {
    for (const element of roots()) {
      if (element.style.getPropertyValue('background-color') !== 'transparent' || element.style.getPropertyPriority('background-color') !== 'important') {
        element.style.setProperty('background-color', 'transparent', 'important')
      }
      if (element.style.getPropertyValue('background-image') !== 'none' || element.style.getPropertyPriority('background-image') !== 'important') {
        element.style.setProperty('background-image', 'none', 'important')
      }
    }
  }

  enforce()

  // NOTICE: The stage BrowserWindow is transparent. Any theme/devtool/runtime
  // background that lands on html/body becomes a visible rectangle behind Live2D.
  const observer = new MutationObserver(enforce)
  for (const element of roots()) {
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] })
  }
}

enforceTransparentRootSurface()

function shouldInstallStageOnlyPlugins() {
  const hashRoute = window.location.hash.replace(/^#/, '') || '/'
  return hashRoute === '/' || hashRoute.startsWith('/?')
}

const router = createRouter({
  history: createWebHashHistory(),
  // TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
  routes: setupLayouts(routes as RouteRecordRaw[]),
})
let settingsRouteProgressTimer: number | undefined
let settingsHomePreloadStarted = false

NProgress.configure({
  showSpinner: false,
  trickleSpeed: 120,
})

function getComponentName(instance?: ComponentInternalInstance | ComponentPublicInstance | null) {
  const internalInstance = '$' in (instance ?? {}) ? (instance as ComponentPublicInstance).$ : instance as ComponentInternalInstance | undefined
  const type = internalInstance?.type as { __file?: string, __name?: string, name?: string } | undefined
  return type?.name ?? type?.__name ?? type?.__file ?? 'unknown'
}

function installDevErrorLogging(app: ReturnType<typeof createApp>) {
  if (!import.meta.env.DEV)
    return

  app.config.errorHandler = (error, instance, info) => {
    console.error('[Wuwiii Vue error]', {
      component: getComponentName(instance),
      info,
      route: router.currentRoute.value.fullPath,
    }, error)
  }

  app.config.warnHandler = (message, instance, trace) => {
    if (!message.includes('Unhandled error during execution')) {
      console.warn(`[Vue warn]: ${message}${trace}`)
      return
    }

    console.warn('[Wuwiii Vue warn]', {
      component: getComponentName(instance),
      message,
      route: router.currentRoute.value.fullPath,
      trace,
    })
  }
}

function clearSettingsRouteProgressTimer() {
  if (!settingsRouteProgressTimer)
    return

  window.clearTimeout(settingsRouteProgressTimer)
  settingsRouteProgressTimer = undefined
}

function startSettingsRouteProgressAfterDelay(path: string) {
  clearSettingsRouteProgressTimer()
  if (!path.startsWith('/settings'))
    return

  settingsRouteProgressTimer = window.setTimeout(() => {
    NProgress.start()
  }, 120)
}

function finishSettingsRouteProgress() {
  clearSettingsRouteProgressTimer()
  NProgress.done()
}

function runAfterStartupIdle(callback: () => void) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const idleWindow = window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
        }

        if (idleWindow.requestIdleCallback) {
          idleWindow.requestIdleCallback(callback, { timeout: 3000 })
          return
        }

        window.setTimeout(callback, 1000)
      }, 1000)
    })
  })
}

function preloadSettingsHomeRouteAfterStagePaint() {
  if (settingsHomePreloadStarted || router.currentRoute.value.path !== '/')
    return

  settingsHomePreloadStarted = true
  runAfterStartupIdle(() => {
    void Promise.all([
      import('./layouts/settings.vue'),
      import('./pages/settings/index.vue'),
    ]).catch(error => console.warn('Failed to preload settings route:', error))
  })
}

function warmStageAudioOutput() {
  if (router.currentRoute.value.path !== '/')
    return

  // NOTICE: Creating an AudioContext can fail or wait for user interaction on
  // Windows. Keep that optional work outside the visible renderer bootstrap.
  void import('@proj-airi/stage-ui/stores/audio')
    .then(({ useAudioContext: createAudioContextStore }) => createAudioContextStore(pinia))
    .catch(error => console.warn('Failed to warm stage audio output:', error))
}

router.beforeEach((to) => {
  startSettingsRouteProgressAfterDelay(to.path)

  const edition = getStageProductEdition()

  if (!isProductAudienceVisible(to.meta?.productAudience, edition)) {
    return '/settings'
  }

  if (!isDesktopRouteEnabled(to.path, edition)) {
    return '/settings'
  }
})

router.beforeResolve((to) => {
  if (!to.path.startsWith('/settings'))
    return

})

router.afterEach((to) => {
  finishSettingsRouteProgress()

  if (!to.path.startsWith('/settings'))
    return

})

router.onError(() => {
  finishSettingsRouteProgress()
})

async function bootstrap() {
  const app = createApp(App)

  installDevErrorLogging(app)

  app
    .use(MotionPlugin)
    // TODO: Fix autoAnimatePlugin type error
    .use(autoAnimatePlugin as unknown as Plugin)
    .use(router)
    .use(pinia)
    .use(i18n)

  if (shouldInstallStageOnlyPlugins()) {
    const { default: Tres } = await import('@tresjs/core')
    app.use(Tres)
  }

  app.mount('#app')

  void router.isReady()
    .then(() => {
      warmStageAudioOutput()
      preloadSettingsHomeRouteAfterStagePaint()
    })
    .catch((error) => {
      console.error('Uncaught renderer router readiness error:', error)
    })
}

void bootstrap().catch((error) => {
  console.error('Uncaught renderer bootstrap error:', error)
})
