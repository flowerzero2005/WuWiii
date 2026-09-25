/* eslint-disable no-template-curly-in-string */

import type { Configuration } from 'electron-builder'

import { env } from 'node:process'

import { resolveDesktopUpdatePublishConfig } from './src/main/services/electron/desktop-update-config'

const desktopUpdatePublishConfig = resolveDesktopUpdatePublishConfig(env)
const allowedPackageIncludes = [
  'out/**',
  'resources/icon-512.png',
  'resources/icon.ico',
  'resources/icon.png',
  'resources/tray-icon.png',
  'resources/tray-icon@2x.png',
  'resources/tray-icon-macos.png',
  'package.json',
  '**/node_modules/debug/**/*',
]

/** Refuse packaging inputs that could capture developer-local or runtime user data. */
export function assertDesktopPackageInputIsolation(config: Configuration) {
  if (config.extraFiles || config.extraResources)
    throw new Error('Desktop packages must not copy files outside the explicit application allowlist.')

  if (!Array.isArray(config.files))
    throw new TypeError('Desktop package files must be an explicit allowlist.')

  const includes = config.files.filter((entry): entry is string => typeof entry === 'string' && !entry.startsWith('!'))
  const unexpectedIncludes = includes.filter(entry => !allowedPackageIncludes.includes(entry))
  const missingIncludes = allowedPackageIncludes.filter(entry => !includes.includes(entry))
  if (unexpectedIncludes.length || missingIncludes.length) {
    throw new Error(`Desktop package allowlist changed. Unexpected: ${unexpectedIncludes.join(', ') || 'none'}; missing: ${missingIncludes.join(', ') || 'none'}.`)
  }
}

const config = {
  appId: 'cn.wuwiii.desktop.development',
  productName: 'Wuwiii Dev',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  // // For self-publishing, testing, and distribution after modified the code without access to
  // // an Apple Developer account, comment and uncomment the following lines.
  // // Later on when you obtained one, you can set up the necessary certificates and provisioning
  // // profiles to enable these security features.
  // //
  // // https://www.bigbinary.com/blog/code-sign-notorize-mac-desktop-app
  // // https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/
  // afterSign: async (context) => {
  //   const { electronPlatformName, appOutDir } = context
  //   if (electronPlatformName !== 'darwin')
  //     return
  //   if (env.CI !== 'true') {
  //     console.warn('Skipping notarizing step. Packaging is not running in CI')
  //     return
  //   }

  //   const appName = context.packager.appInfo.productFilename
  //   await notarize({
  //     appPath: `${appOutDir}/${appName}.app`,
  //     teamId: env.APPLE_DEVELOPER_TEAM_ID!,
  //     appleId: env.APPLE_DEVELOPER_APPLE_ID!,
  //     appleIdPassword: env.APPLE_DEVELOPER_APPLE_APP_SPECIFIC_PASSWORD!,
  //   })
  // },
  files: [
    'out/**',
    'resources/icon-512.png',
    'resources/icon.ico',
    'resources/icon.png',
    'resources/tray-icon.png',
    'resources/tray-icon@2x.png',
    'resources/tray-icon-macos.png',
    'package.json',
    '!**/.vscode/*',
    '!src/**/*',
    '!**/node_modules/**/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/**/{.turbo,test,__tests__,tests,example,examples,story,stories,docs,doc}/**',
    '!**/node_modules/**/src/**/*.{md,markdown}',
    '!**/node_modules/@proj-airi/**/src/**',
    '!**/node_modules/@proj-airi/**/public/**',
    '!**/node_modules/@proj-airi/**/*.{test,spec,story}.{js,jsx,ts,tsx,vue}',
    '!**/node_modules/@proj-airi/**/{histoire,vitest,vite,tsdown,tsconfig,uno,electron.vite}.config.{js,ts,mjs,cjs}',
    '!**/node_modules/@proj-airi/**/{.env,.env.*}',
    '!**/node_modules/**/*.{d.ts,d.cts,d.mts,map}',
    '!**/node_modules/**/{CHANGELOG,HISTORY,History,README,readme,SECURITY,CONTRIBUTING,README_TEST,TEST_GUIDE,DEBUG_MEMORY_USAGE,PROJECT_SUMMARY,QUICK_REFERENCE}.{md,markdown,txt}',
    '!**/node_modules/onnxruntime-node/bin/**/{darwin,linux}/**',
    '!**/node_modules/onnxruntime-node/bin/**/win32/arm64/**',
    '!**/node_modules/clipboardy/fallbacks/{linux,macos}/**',
    '**/node_modules/debug/**/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!vite.config.{js,ts,mjs,cjs}',
    '!uno.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.ts,.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json}',
  ],
  asar: true,
  asarUnpack: [
    '**/*.node',
  ],
  extraMetadata: {
    name: 'cn.wuwiii.desktop.development',
    main: 'out/main/index.js',
    description: 'A desktop digital companion with customizable characters, voice interaction, and local tools.',
    homepage: 'https://wuwiii.cn/',
    license: 'MIT',
  },
  win: {
    executableName: 'wuwiii-dev',
    icon: 'build/icon.ico',
    legalTrademarks: 'Wuwiii',
  },
  nsis: {
    artifactName: 'Wuwiii-Dev-${version}-windows-${arch}-setup.${ext}',
    shortcutName: 'Wuwiii Dev',
    uninstallDisplayName: 'Wuwiii Dev',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    oneClick: false,
    perMachine: false,
    selectPerMachineByDefault: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    displayLanguageSelector: true,
    installerLanguages: ['en_US', 'zh_CN'],
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
  },
  mac: {
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: [
      {
        NSMicrophoneUsageDescription: 'Wuwiii requires microphone access for voice interaction',
      },
      {
        NSCameraUsageDescription: 'Wuwiii requires camera access for vision understanding',
      },
    ],
    // For self-publishing, testing, and distribution after modified the code without access to
    // an Apple Developer account, comment and uncomment the following 4 lines.
    // Later on when you obtained one, you can set up the necessary certificates and provisioning
    // profiles to enable these security features.
    // hardenedRuntime: false,
    hardenedRuntime: true,
    // notarize: false,
    notarize: true,
    executableName: 'wuwiii-dev',
    icon: 'build/icon.icns',
  },
  dmg: {
    artifactName: '${productName}-${version}-darwin-${arch}.${ext}',
  },
  linux: {
    target: [
      'deb',
      'rpm',
    ],
    category: 'Utility',
    synopsis: 'AI VTuber/Waifu chatbot app inspired by Neuro-sama.',
    description: 'Wuwiii is a home for digital residents with Live2D/VRM avatars, natural interaction, and modular stage-based rendering.',
    executableName: 'wuwiii-dev',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    icon: 'build/icons/icon.png',
  },
  appImage: {
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  npmRebuild: false,
  // No repository fallback: unconfigured packages must not poll the upstream project.
  publish: desktopUpdatePublishConfig ? [desktopUpdatePublishConfig] : [],
} as Configuration

// Keep runtime user data and developer-imported assets outside every packaged application.
assertDesktopPackageInputIsolation(config)

export default config
