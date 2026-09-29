import type { Plugin } from 'vite'

import process from 'node:process'

import { join, resolve } from 'node:path'

import VueI18n from '@intlify/unplugin-vue-i18n/vite'
import Vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'unplugin-vue-router/vite'
import Yaml from 'unplugin-yaml/vite'
import Inspect from 'vite-plugin-inspect'
import VitePluginVueDevTools from 'vite-plugin-vue-devtools'
import Layouts from 'vite-plugin-vue-layouts'
import VueMacros from 'vue-macros/vite'

import { Download } from '@proj-airi/unplugin-fetch'
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk'
import { templateCompilerOptions } from '@tresjs/core'
import { defineConfig } from 'electron-vite'

import { prepareLive2dRuntimeArchive } from './src/main/services/electron/live2d-runtime-archive'
import { assertDesktopFeatureManifest, createDesktopFeatureManifest } from './src/shared/desktop-feature-manifest'

const stageUIAssetsRoot = resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src', 'assets'))
const sharedCacheDir = resolve(join(import.meta.dirname, '..', '..', '.cache'))

export const desktopBundledDisplayModels = [
  {
    filename: 'hiyori_pro_zh.zip',
    url: 'https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip',
  },
] as const

function DownloadRuntimeOnlyLive2d(url: string, filename: string) {
  const download = Download(url, filename, 'live2d/models', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir })
  const configResolved = download.configResolved
  if (typeof configResolved !== 'function')
    throw new TypeError(`Live2D download plugin has no configResolved hook: ${filename}`)

  return {
    ...download,
    name: `${download.name}-runtime-only`,
    async configResolved(config) {
      await configResolved.call(this, config)
      const archivePath = resolve(stageUIAssetsRoot, 'live2d', 'models', filename)
      const result = await prepareLive2dRuntimeArchive(archivePath)
      if (result.changed) {
        config.logger.info(`${filename} runtime-only: ${result.beforeBytes} -> ${result.afterBytes} bytes; removed ${result.removedEntries} entries.`)
      }
    },
  } satisfies Plugin
}

type DesktopAppEdition = 'consumer' | 'creator' | 'dev'

export function resolveDesktopWindowsAngleBackend(value?: string) {
  return value?.trim() || undefined
}

export function shouldEnableDesktopBuildMetadata(runtimeRegressionFlag?: string) {
  return runtimeRegressionFlag !== '1'
}

/**
 * Keeps the offline regression build independent from Git. `unplugin-info`
 * normally populates these virtual modules by launching Git; the regression
 * network/child-process guard must reject that launch. The fallback preserves
 * the small build-info contract consumed by the app with deterministic values.
 */
function DesktopRegressionBuildMetadata(): Plugin {
  const modules = new Map([
    ['~build/time', '\0airi-desktop-regression-build-time'],
    ['~build/git', '\0airi-desktop-regression-build-git'],
    ['~build/package', '\0airi-desktop-regression-build-package'],
  ])
  const sources = new Map([
    ['\0airi-desktop-regression-build-time', 'export default new Date(0)'],
    ['\0airi-desktop-regression-build-git', 'export const abbreviatedSha = "regression"; export const branch = "desktop-regression"; export const committerDate = "1970-01-01T00:00:00.000Z"; export const github = null;'],
    ['\0airi-desktop-regression-build-package', 'export const name = "@proj-airi/stage-tamagotchi"; export const version = "desktop-regression";'],
  ])

  return {
    name: 'proj-airi:desktop-regression-build-metadata',
    resolveId(id) {
      return modules.get(id)
    },
    load(id) {
      return sources.get(id)
    },
  }
}

function resolveDesktopAppEdition(): DesktopAppEdition {
  // The release packager must win over local Vite env files, including a
  // developer's .env.development.local. Never emit developer windows in a
  // consumer installer because a local file selected the dev edition.
  if (process.env.AIRI_CONSUMER_PACKAGE === '1')
    return 'consumer'

  const edition = process.env.VITE_APP_EDITION

  if (edition === 'consumer' || edition === 'creator' || edition === 'dev') {
    return edition
  }

  // NOTICE: The isolated repository packages the development edition by default.
  return 'dev'
}

const desktopAppEdition = resolveDesktopAppEdition()
const desktopBuildMetadataEnabled = shouldEnableDesktopBuildMetadata(process.env.AIRI_DESKTOP_REGRESSION_RUNTIME)
// NOTICE: Chromium's default backend is the only path exercised by both development
// and packaged apps. Keep ANGLE selection as an explicit diagnostic override instead
// of forcing SwiftShader across every Windows consumer window.
const desktopWindowsAngleBackend = resolveDesktopWindowsAngleBackend(process.env.VITE_WINDOWS_ANGLE_BACKEND)
// NOTICE: The development mirror never uses the official update feed.
const desktopUpdatesEnabled = false
const isConsumerEditionBuild = desktopAppEdition === 'consumer'
const isDeveloperEditionBuild = desktopAppEdition === 'dev'
const shouldInstallVueDevtools = isDeveloperEditionBuild && process.env.VITE_ENABLE_VUE_DEVTOOLS === '1'
const desktopFeatureManifest = createDesktopFeatureManifest(desktopAppEdition)

assertDesktopFeatureManifest(desktopFeatureManifest)

// Workspace junctions are unavailable after installation, so main-process imports must be bundled.
// @electron-toolkit/utils is also bundled here because electron-builder + pnpm's symlink-based
// node_modules does not reliably include it in the packaged ASAR's node_modules at runtime.
export const mainBundledWorkspaceDependencies = [
  '@proj-airi/electron-eventa',
  '@proj-airi/electron-screen-capture',
  '@proj-airi/electron-vueuse',
  '@proj-airi/i18n',
  '@proj-airi/plugin-sdk',
  // NOTICE: Match the package name so the aliased vision-limits source is bundled;
  // leaving the UI re-export external made Node load the unbuilt dist module.
  // See `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:1127-1150`.
  '@proj-airi/server-shared',
  '@electron-toolkit/utils',
]

function assertConsumerBuildServerUrl() {
  if (!isConsumerEditionBuild || process.env.NODE_ENV !== 'production') {
    return
  }

  const serverUrl = process.env.VITE_SERVER_URL?.trim()
  if (!serverUrl) {
    throw new Error('VITE_SERVER_URL is required for a consumer production build. Set it to your own API server before packaging.')
  }

  try {
    const parsed = new URL(serverUrl)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('Consumer production API server must use HTTPS unless it is localhost.')
    }
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('HTTPS')) {
      throw error
    }

    throw new Error(`VITE_SERVER_URL is not a valid URL: ${serverUrl}`)
  }
}

assertConsumerBuildServerUrl()

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: mainBundledWorkspaceDependencies,
      },
    },

    define: {
      'import.meta.env.VITE_APP_EDITION': JSON.stringify(desktopAppEdition),
      'import.meta.env.VITE_DESKTOP_DEVELOPER_TOOLS_ENABLED': JSON.stringify(desktopFeatureManifest.features.developerTools),
      'import.meta.env.VITE_DESKTOP_UPDATES_ENABLED': JSON.stringify(desktopUpdatesEnabled),
      'import.meta.env.VITE_WINDOWS_ANGLE_BACKEND': JSON.stringify(desktopWindowsAngleBackend),
    },

    plugins: [
      Yaml(),
      ...(desktopBuildMetadataEnabled ? [Info()] : []),
      ...(!desktopBuildMetadataEnabled ? [DesktopRegressionBuildMetadata()] : []),
      {
        // To replace `build.rolldownOptions`, as electron-vite still uses the deprecated
        // `rollupOptions`, using `rollupOptions` and `rolldownOptions` at the same
        // time may lead to unexpected merge results. Using `rollupOptions` to manipulate
        // `manualChunks` also did not work. Therefore, it was transformed into a plugin
        // declaration with the recommended `codeSplitting` option.
        name: 'manual-chunks',
        outputOptions(options) {
          options.codeSplitting = {
            groups: [{
              name(moduleId) {
                // https://github.com/lobehub/lobehub/blob/6ecba929b738e1259e15d17e7643941e015324ee/apps/desktop/electron.vite.config.ts#L54
                // Prevent debug package from being bundled into index.js to avoid side-effect pollution
                if (moduleId.includes('node_modules/debug')) {
                  return 'vendor-debug'
                }
              },
            }],
          }
          return options
        },
      },
    ],

    resolve: {
      alias: {
        // Keep capture handlers and renderer contracts on the same source revision.
        '@proj-airi/electron-screen-capture': resolve(join(import.meta.dirname, '..', '..', 'packages', 'electron-screen-capture', 'src')),
        '@proj-airi/server-shared/vision-limits': resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-shared', 'src', 'vision-limits.ts')),
        '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: {
          'index': resolve(join(import.meta.dirname, 'src', 'preload', 'index.ts')),
          'beat-sync': resolve(join(import.meta.dirname, 'src', 'preload', 'beat-sync.ts')),
          'quick-chat-user-bubble': resolve(join(import.meta.dirname, 'src', 'preload', 'quick-chat-user-bubble.ts')),
        },
      },
    },
    plugins: [],
  },
  renderer: {
    // Thanks to [@Maqsyo](https://github.com/Maqsyo)
    // https://github.com/alex8088/electron-vite/issues/99#issuecomment-1862671727
    base: './',

    build: {
      rolldownOptions: {
        input: {
          'main': resolve(join(import.meta.dirname, 'src', 'renderer', 'index.html')),
          'beat-sync': resolve(join(import.meta.dirname, 'src', 'renderer', 'beat-sync.html')),
        },
      },
    },

    optimizeDeps: {
      // The stage and general settings route are loaded dynamically. Discover
      // their dependencies before serving modules to avoid a rebundle that
      // reloads windows and splits active Vue/Pinia instances.
      include: ['@proj-airi/stage-ui-live2d > pixi-filters', 'std-env'],
      exclude: [
        // Internal Packages
        '@proj-airi/stage-ui/*',
        '@proj-airi/drizzle-duckdb-wasm',
        '@proj-airi/drizzle-duckdb-wasm/*',
        '@proj-airi/electron-screen-capture',

        // Static Assets: Models, Images, etc.
        'src/renderer/public/assets/*',

        // Live2D SDK
        '@framework/live2dcubismframework',
        '@framework/math/cubismmatrix44',
        '@framework/type/csmvector',
        '@framework/math/cubismviewmatrix',
        '@framework/cubismdefaultparameterid',
        '@framework/cubismmodelsettingjson',
        '@framework/effect/cubismbreath',
        '@framework/effect/cubismeyeblink',
        '@framework/model/cubismusermodel',
        '@framework/motion/acubismmotion',
        '@framework/motion/cubismmotionqueuemanager',
        '@framework/type/csmmap',
        '@framework/utils/cubismdebug',
        '@framework/model/cubismmoc',
      ],
    },

    resolve: {
      alias: {
        '@proj-airi/electron-screen-capture': resolve(join(import.meta.dirname, '..', '..', 'packages', 'electron-screen-capture', 'src')),
        '@proj-airi/server-shared/vision-limits': resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-shared', 'src', 'vision-limits.ts')),
        '@proj-airi/server-sdk': resolve(join(import.meta.dirname, '..', '..', 'packages', 'server-sdk', 'src')),
        '@proj-airi/i18n': resolve(join(import.meta.dirname, '..', '..', 'packages', 'i18n', 'src')),
        '@proj-airi/stage-ui': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src')),
        '@proj-airi/stage-pages': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src')),
        '@proj-airi/stage-shared': resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-shared', 'src')),
      },
    },

    server: {
      // Keep the renderer origin stable so per-origin settings survive restarts.
      port: 5173,
      strictPort: true,
      warmup: {
        clientFiles: [
          `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-ui', 'src'))}/*.vue`,
          `${resolve(join(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src'))}/*.vue`,
        ],
      },
    },

    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          inlineDynamicImports: false,
        },
      },
    },

    plugins: [
      ...(desktopBuildMetadataEnabled ? [Info()] : []),
      ...(!desktopBuildMetadataEnabled ? [DesktopRegressionBuildMetadata()] : []),

      {
        name: 'proj-airi:defines',
        config(ctx) {
          const define: Record<string, any> = {
            'import.meta.env.VITE_APP_EDITION': JSON.stringify(desktopAppEdition),
            'import.meta.env.VITE_DESKTOP_FEATURE_MANIFEST': JSON.stringify(desktopFeatureManifest),
            'import.meta.env.VITE_DESKTOP_UPDATE_CHANNEL': JSON.stringify('development'),
            'import.meta.env.RUNTIME_ENVIRONMENT': '\'electron\'',
          }
          if (ctx.mode === 'development') {
            define['import.meta.env.URL_MODE'] = '\'server\''
          }
          if (ctx.mode === 'production') {
            define['import.meta.env.URL_MODE'] = '\'file\''
          }

          return { define }
        },
      },

      ...(isDeveloperEditionBuild ? [Inspect()] : []),

      Yaml(),

      VueMacros({
        plugins: {
          vue: Vue({
            include: [/\.vue$/, /\.md$/],
            ...templateCompilerOptions,
          }),
          vueJsx: false,
        },
        betterDefine: false,
      }),

      VueRouter({
        dts: resolve(import.meta.dirname, 'src/renderer/typed-router.d.ts'),
        routesFolder: [
          {
            src: resolve(import.meta.dirname, '..', '..', 'packages', 'stage-pages', 'src', 'pages'),
            exclude: base => [
              ...base,
              '**/settings/index.vue',
              '**/settings/system/general.vue',
              '**/settings/modules/mcp.vue',
              ...desktopFeatureManifest.routeExcludes.shared,
            ],
          },
          {
            src: resolve(import.meta.dirname, 'src', 'renderer', 'pages'),
            exclude: base => [
              ...base,
              ...desktopFeatureManifest.routeExcludes.desktop,
            ],
          },
        ],
        exclude: ['**/components/**'],
      }),

      ...(shouldInstallVueDevtools ? [VitePluginVueDevTools()] : []),

      // https://github.com/JohnCampionJr/vite-plugin-vue-layouts
      Layouts({
        layoutsDirs: [
          resolve(import.meta.dirname, 'src', 'renderer', 'layouts'),
          resolve(import.meta.dirname, '..', '..', 'packages', 'stage-layouts', 'src', 'layouts'),
        ],
        pagesDirs: [resolve(import.meta.dirname, 'src', 'renderer', 'pages')],
      }),

      UnoCss(),

      // https://github.com/intlify/bundle-tools/tree/main/packages/unplugin-vue-i18n
      VueI18n({
        runtimeOnly: true,
        compositionOnly: true,
        fullInstall: true,
      }),

      DownloadLive2DSDK(),
      ...desktopBundledDisplayModels.map(model => DownloadRuntimeOnlyLive2d(model.url, model.filename)),
    ],
  },
})
