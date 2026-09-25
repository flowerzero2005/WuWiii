import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface RegressionSuite {
  areas: string[]
  deferredCoverage?: string[]
  files: string[]
  id: string
  title: string
}

interface SuiteResult extends RegressionSuite {
  durationMs: number
  exitCode: number | null
  logFiles: {
    stderr: string
    stdout: string
  }
  missingFiles: string[]
  status: 'failed' | 'passed'
}

interface HarnessExecutable {
  path: string
  source: string
}

const DESKTOP_PORT = 5173
const repoRoot = resolve(import.meta.dirname, '../../..')
const safeVitestRunner = join(repoRoot, 'scripts', 'run-vitest-safe.mjs')
const regressionConfig = join(import.meta.dirname, 'vitest.desktop-regression.config.mjs')
const networkGuard = join(import.meta.dirname, 'desktop-regression-network-guard.mjs')
const SECRET_ENVIRONMENT_NAME_REGEX = /api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|credential|password|private[_-]?key/i
const ESBUILD_PACKAGE_DIRECTORY_REGEX = /^@esbuild\+([^@]+)@/
const projectRoots = [
  {
    prefix: 'apps/stage-tamagotchi/',
    root: join(repoRoot, 'apps', 'stage-tamagotchi'),
  },
  {
    prefix: 'packages/stage-ui/',
    root: join(repoRoot, 'packages', 'stage-ui'),
  },
]

// NOTICE: Every file in this manifest is an offline, mock-based regression test.
// Keeping the list explicit prevents a newly added integration test from silently
// issuing a provider or payment request in the development gate.
const regressionSuites: RegressionSuite[] = [
  {
    id: 'desktop-startup',
    title: 'Desktop startup, IPC, windows, and data isolation',
    areas: ['startup order', 'window lifecycle', 'diagnostics', 'userData isolation', 'permissions'],
    files: [
      'apps/stage-tamagotchi/src/shared/desktop-feature-manifest.test.ts',
      'apps/stage-tamagotchi/src/shared/desktop-regression-network-guard.test.ts',
      'apps/stage-tamagotchi/src/main/startup-ipc-order.test.ts',
      'apps/stage-tamagotchi/src/main/windows/startup/index.test.ts',
      'apps/stage-tamagotchi/src/main/libs/electron/location.test.ts',
      'apps/stage-tamagotchi/src/main/libs/electron/desktop-diagnostics.test.ts',
      'apps/stage-tamagotchi/src/main/libs/electron/window-perf.test.ts',
      'apps/stage-tamagotchi/src/main/services/electron/application-data.test.ts',
      'apps/stage-tamagotchi/src/main/services/electron/window.test.ts',
      'apps/stage-tamagotchi/src/main/services/electron/media-permissions.test.ts',
      'apps/stage-tamagotchi/src/main/windows/shared/display.test.ts',
      'apps/stage-tamagotchi/src/renderer/modules/posthog.test.ts',
    ],
  },
  {
    id: 'conversation-surfaces',
    title: 'Direct chat, group chat, recommendations, and session races',
    areas: ['direct chat', 'group chat', 'recommended replies', 'send queue', 'stream ownership', 'typewriter restore'],
    files: [
      'apps/stage-tamagotchi/src/renderer/components/interactive-area-group-chat.test.ts',
      'apps/stage-tamagotchi/src/renderer/components/interactive-area-recommended-replies.test.ts',
      'apps/stage-tamagotchi/src/renderer/components/interactive-area-ref-unwrapping.test.ts',
      'packages/stage-ui/src/stores/chat/recommended-replies.test.ts',
      'packages/stage-ui/src/stores/chat/group-chat.test.ts',
      'packages/stage-ui/src/stores/chat/chat-sync-members.test.ts',
      'packages/stage-ui/src/stores/chat/send-queue.test.ts',
      'packages/stage-ui/src/stores/chat/stream-store.test.ts',
      'packages/stage-ui/src/stores/chat/turn-context.test.ts',
      'packages/stage-ui/src/stores/chat/turn-snapshot.test.ts',
      'packages/stage-ui/src/stores/chat/session-store.test.ts',
      'packages/stage-ui/src/stores/chat/interrupted-assistant.test.ts',
      'packages/stage-ui/src/stores/chat/auto-cleanup-guard.test.ts',
      'packages/stage-ui/src/stores/chat/chat-diagnostics.test.ts',
      'packages/stage-ui/src/stores/mods/api/context-bridge-session-isolation.test.ts',
      'packages/stage-ui/src/components/scenarios/chat/history-typing-complete.test.ts',
      'packages/stage-ui/src/components/scenarios/chat/history-state.test.ts',
    ],
  },
  {
    id: 'voice-and-call',
    title: 'Speech input, speech output, playback, and voice calls',
    areas: ['ASR', 'TTS', 'manual speech input', 'playback timing', 'voice calls', 'point policy'],
    files: [
      'apps/stage-tamagotchi/src/renderer/components/voice-call-session.test.ts',
      'apps/stage-tamagotchi/src/renderer/stores/tools/builtin/voice-call.test.ts',
      'apps/stage-tamagotchi/src/main/services/electron/realtime-tts.test.ts',
      'packages/stage-ui/src/composables/use-manual-speech-input.test.ts',
      'packages/stage-ui/src/stores/modules/hearing.test.ts',
      'packages/stage-ui/src/stores/modules/speech.test.ts',
      'packages/stage-ui/src/stores/speech-display-sync.test.ts',
      'packages/stage-ui/src/stores/speech-latency.test.ts',
      'packages/stage-ui/src/stores/chat/speech-display-policy.test.ts',
      'packages/stage-ui/src/utils/speech-generation.test.ts',
      'packages/stage-ui/src/utils/tts-request-policy.test.ts',
      'packages/stage-ui/src/utils/official-cloud-audio-points.test.ts',
      'packages/stage-ui/src/utils/chat-playback-timing.test.ts',
      'packages/stage-ui/src/utils/realtime-pcm-playback.test.ts',
    ],
  },
  {
    id: 'persona-and-memory',
    title: 'Persona continuity, reply quality, memory, and feedback',
    areas: ['persona rules', 'relationship continuity', 'memory extraction', 'memory deduplication', 'reply feedback'],
    files: [
      'packages/stage-ui/src/stores/chat/anti-template-guard.test.ts',
      'packages/stage-ui/src/stores/chat/persona-base-prompt.test.ts',
      'packages/stage-ui/src/stores/chat/persona-language-policy.test.ts',
      'packages/stage-ui/src/stores/chat/persona-response-guard.test.ts',
      'packages/stage-ui/src/stores/chat/persona-response-rewriter.test.ts',
      'packages/stage-ui/src/stores/chat/persona-state.test.ts',
      'packages/stage-ui/src/stores/chat/persona-relationship-store.test.ts',
      'packages/stage-ui/src/stores/chat/memory-manager.test.ts',
      'packages/stage-ui/src/stores/chat/memory-extractor.test.ts',
      'packages/stage-ui/src/stores/chat/memory-deduplication.test.ts',
      'packages/stage-ui/src/stores/chat/context-providers/notebook-memory.test.ts',
      'packages/stage-ui/src/stores/chat/context-providers/reply-feedback-memory.test.ts',
      'packages/stage-ui/src/stores/chat/reply-feedback-turn.test.ts',
      'packages/stage-ui/src/database/repos/reply-feedback.repo.test.ts',
      'packages/stage-ui/src/stores/character/diary-generator.test.ts',
    ],
  },
  {
    id: 'models-and-settings',
    title: 'Display models, Live2D, settings, and navigation',
    areas: ['model ownership', 'Live2D settings', 'avatar framing', 'chat appearance', 'settings navigation'],
    files: [
      'apps/stage-tamagotchi/src/renderer/stage-model-load-ownership.test.ts',
      'apps/stage-tamagotchi/src/main/services/electron/live2d-runtime-archive.test.ts',
      'apps/stage-tamagotchi/src/renderer/pages/settings/settings-navigation-data.test.ts',
      'apps/stage-tamagotchi/src/renderer/pages/settings/system/general-startup.test.ts',
      'packages/stage-ui/src/stores/display-models.test.ts',
      'packages/stage-ui/src/stores/settings/stage-model.test.ts',
      'packages/stage-ui/src/stores/settings/live2d.test.ts',
      'packages/stage-ui/src/stores/settings/avatar-framing.test.ts',
      'packages/stage-ui/src/stores/settings/chat-appearance.test.ts',
      'packages/stage-ui/src/stores/settings/quick-chat.test.ts',
      'packages/stage-ui/src/stores/chat/live2d-expression-intent.test.ts',
      'packages/stage-ui/src/stores/chat/live2d-action-fallback.test.ts',
      'packages/stage-ui/src/utils/model-configuration-bundle.test.ts',
      'packages/stage-ui/src/utils/model-performance-config.test.ts',
    ],
  },
  {
    id: 'tools-and-commerce',
    title: 'Tools, butler actions, authentication, and point safety',
    areas: ['tool routing', 'MCP', 'butler tasks', 'command safety', 'authentication', 'commerce mocks', 'official pricing'],
    deferredCoverage: [
      'apps/stage-tamagotchi/src/renderer/stores/tools/builtin/command-execution.test.ts requires the future L1 browser environment',
    ],
    files: [
      'apps/stage-tamagotchi/src/renderer/modules/chat-tool-bundles.test.ts',
      'apps/stage-tamagotchi/src/renderer/stores/tools/builtin/butler-tasks.test.ts',
      'apps/stage-tamagotchi/src/renderer/stores/tools/builtin/widgets.test.ts',
      'apps/stage-tamagotchi/src/main/services/airi/command-execution/restricted-command-adapters.test.ts',
      'packages/stage-ui/src/tools/chat-tool-bundles.test.ts',
      'packages/stage-ui/src/tools/mcp.test.ts',
      'packages/stage-ui/src/tools/memory.test.ts',
      'packages/stage-ui/src/tools/web-search/web-search.test.ts',
      'packages/stage-ui/src/libs/auth.test.ts',
      'packages/stage-ui/src/libs/auth-sync.test.ts',
      'packages/stage-ui/src/stores/commerce.test.ts',
      'packages/stage-ui/src/stores/official-pricing.test.ts',
      'packages/stage-ui/src/stores/settings/official-capability-consent.test.ts',
      'packages/stage-ui/src/libs/providers/providers/official-cloud/index.test.ts',
    ],
  },
]

function printUsage() {
  console.info('Usage: pnpm test:desktop:regression [--suite <id>] [--list] [--runtime]')
}

function requestedSuiteId() {
  const suiteIndex = process.argv.indexOf('--suite')
  if (suiteIndex >= 0)
    return process.argv[suiteIndex + 1]

  return process.argv.find(argument => argument.startsWith('--suite='))?.slice('--suite='.length)
}

async function resolveHarnessExecutables() {
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm')
  const packageDirectories = await readdir(pnpmStore, { withFileTypes: true })
  const candidates: HarnessExecutable[] = []
  for (const entry of packageDirectories) {
    const match = ESBUILD_PACKAGE_DIRECTORY_REGEX.exec(entry.name)
    if (!entry.isDirectory() || !match)
      continue

    const packageRoot = join(pnpmStore, entry.name, 'node_modules', '@esbuild', match[1])
    candidates.push(
      {
        path: join(packageRoot, 'esbuild.exe'),
        source: `workspace pnpm package ${entry.name}`,
      },
      {
        path: join(packageRoot, 'bin', 'esbuild'),
        source: `workspace pnpm package ${entry.name}`,
      },
    )
  }

  const executables: HarnessExecutable[] = []
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      executables.push({
        path: await realpath(candidate.path),
        source: candidate.source,
      })
    }
  }
  if (executables.length === 0)
    throw new Error('Unable to resolve the workspace @esbuild platform binary')

  return [...new Map(executables.map(executable => [executable.path, executable])).values()]
}

function createOfflineEnvironment(userDataRoot: string, harnessExecutables: HarnessExecutable[]) {
  const blockedNames: string[] = []
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const blocked = SECRET_ENVIRONMENT_NAME_REGEX.test(name)
    if (blocked)
      blockedNames.push(name)
    return !blocked
  }))

  const networkGuardOption = `--import=${pathToFileURL(networkGuard).href}`
  delete environment.ESBUILD_BINARY_PATH
  return {
    blockedNames: blockedNames.sort(),
    environment: {
      ...environment,
      AIRI_DESKTOP_REGRESSION_ALLOWED_EXECUTABLES: harnessExecutables.map(executable => executable.path).join(delimiter),
      AIRI_DESKTOP_REGRESSION_OFFLINE: '1',
      AIRI_DESKTOP_REGRESSION_USER_DATA: userDataRoot,
      CI: '1',
      ELECTRON_USER_DATA_DIR: userDataRoot,
      NODE_ENV: 'test',
      NODE_OPTIONS: networkGuardOption,
      PORT: String(DESKTOP_PORT),
      VITE_DEV_SERVER_PORT: String(DESKTOP_PORT),
    },
  }
}

async function runSuite(
  suite: RegressionSuite,
  reportDirectory: string,
  environment: NodeJS.ProcessEnv,
): Promise<SuiteResult> {
  const missingFiles = suite.files.filter(file => !existsSync(join(repoRoot, file)))
  const stdoutPath = join(reportDirectory, `${suite.id}.stdout.log`)
  const stderrPath = join(reportDirectory, `${suite.id}.stderr.log`)
  const startedAt = Date.now()

  console.info(`\n[desktop-regression] ${suite.title}`)
  if (missingFiles.length > 0) {
    console.error(`[desktop-regression] Missing manifest files: ${missingFiles.join(', ')}`)
    await Promise.all([
      writeFile(stdoutPath, '', 'utf8'),
      writeFile(stderrPath, `Missing manifest files:\n${missingFiles.join('\n')}\n`, 'utf8'),
    ])
    return {
      ...suite,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      logFiles: { stderr: stderrPath, stdout: stdoutPath },
      missingFiles,
      status: 'failed',
    }
  }

  const stdout = createWriteStream(stdoutPath, { encoding: 'utf8' })
  const stderr = createWriteStream(stderrPath, { encoding: 'utf8' })
  let exitCode = 0
  for (const project of projectRoots) {
    const projectFiles = suite.files
      .filter(file => file.startsWith(project.prefix))
      .map(file => file.slice(project.prefix.length))
    if (projectFiles.length === 0)
      continue

    console.info(`[desktop-regression] Project: ${basename(project.root)} (${projectFiles.length} files)`)
    const child = spawn(process.execPath, [
      safeVitestRunner,
      'run',
      '--config',
      regressionConfig,
      '--configLoader',
      'native',
      '--root',
      project.root,
      '--pool',
      'threads',
      '--maxWorkers',
      '1',
      '--no-file-parallelism',
      ...projectFiles,
    ], {
      cwd: project.root,
      env: environment,
      stdio: 'pipe',
    })

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      stderr.write(chunk)
    })

    const projectExitCode = await waitForExit(child)
    if (projectExitCode !== 0)
      exitCode = projectExitCode
  }
  stdout.end()
  stderr.end()

  return {
    ...suite,
    durationMs: Date.now() - startedAt,
    exitCode,
    logFiles: { stderr: stderrPath, stdout: stdoutPath },
    missingFiles: [],
    status: exitCode === 0 ? 'passed' : 'failed',
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })
}

async function main() {
  if (process.argv.includes('--help')) {
    printUsage()
    return
  }

  if (process.argv.includes('--list')) {
    for (const suite of regressionSuites) {
      console.info(`${suite.id}: ${suite.title}`)
      console.info(`  ${suite.files.length} files | ${suite.areas.join(', ')}`)
    }
    return
  }

  if (process.argv.includes('--runtime')) {
    const { runDesktopRuntimeRegression } = await import('./desktop-regression-runtime')
    await runDesktopRuntimeRegression()
    return
  }

  const suiteId = requestedSuiteId()
  const selectedSuites = suiteId
    ? regressionSuites.filter(suite => suite.id === suiteId)
    : regressionSuites
  if (selectedSuites.length === 0) {
    printUsage()
    throw new Error(`Unknown regression suite: ${suiteId}`)
  }

  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const reportDirectory = join(repoRoot, 'artifacts', 'desktop-regression', runId)
  const temporaryUserData = await mkdtemp(join(tmpdir(), 'airi-desktop-regression-'))
  const harnessExecutables = await resolveHarnessExecutables()
  const { blockedNames, environment } = createOfflineEnvironment(temporaryUserData, harnessExecutables)
  await mkdir(reportDirectory, { recursive: true })

  const startedAt = new Date()
  const results: SuiteResult[] = []
  try {
    for (const suite of selectedSuites)
      results.push(await runSuite(suite, reportDirectory, environment))
  }
  finally {
    await rm(temporaryUserData, { force: true, recursive: true })
  }

  const finishedAt = new Date()
  const report = {
    schemaVersion: 1,
    runId,
    status: results.every(result => result.status === 'passed') ? 'passed' : 'failed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    safety: {
      configuredDesktopPort: DESKTOP_PORT,
      childProcessLaunch: {
        allowedHarnessExecutables: harnessExecutables.map(({ path, source }) => ({
          executable: basename(path),
          source,
        })),
        configuredExecutableAllowlist: [],
        configuredExecutableAllowlistEnv: 'AIRI_DESKTOP_REGRESSION_ALLOWED_EXECUTABLES',
        guardedApis: ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'],
        policy: 'deny-with-declared-harness-exception',
        scope: 'vitest-node-processes',
      },
      electronRuntime: 'not-launched',
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
        policy: 'deny-non-loopback',
        scope: 'listed-node-apis-only',
      },
      inheritedNodeOptions: 'discarded',
      osFirewall: 'not-applied',
      providerCredentialsRemoved: blockedNames,
      temporaryUserDataRemoved: true,
      userDataIsolation: 'not-applicable-node-gate',
    },
    summary: {
      failed: results.filter(result => result.status === 'failed').length,
      passed: results.filter(result => result.status === 'passed').length,
      suites: results.length,
      testFiles: results.reduce((total, result) => total + result.files.length, 0),
    },
    suites: results,
  }
  const reportPath = join(reportDirectory, 'report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(repoRoot, 'artifacts', 'desktop-regression', 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.info(`\n[desktop-regression] ${report.status.toUpperCase()}`)
  console.info(`[desktop-regression] Report: ${reportPath}`)
  for (const result of results)
    console.info(`[desktop-regression] ${result.status.toUpperCase()} ${result.id} (${result.durationMs} ms)`)

  if (report.status === 'failed')
    process.exitCode = 1
}

main().catch((error) => {
  console.error('[desktop-regression] Fatal error:', error)
  process.exitCode = 1
})
