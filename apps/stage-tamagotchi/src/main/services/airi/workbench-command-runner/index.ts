import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronWorkbenchCommandRunnerStatus,
  ElectronWorkbenchCommandRunRecipePayload,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchProjectPreviewSnapshot,
  ElectronWorkbenchProjectPreviewStartPayload,
  ElectronWorkbenchProjectPreviewStopPayload,
  ElectronWorkbenchWorkspaceRecipe,
} from '../../../../shared/eventa'
import type { WorkbenchPlannerPolicyDecision } from '../../../../shared/workbench-planner-policy'
import type { AgentSessionControllerService } from '../agent-session-controller'
import type { WorkbenchMemoryService } from '../workbench-memory'
import type { WorkbenchWorkspaceService } from '../workbench-workspace'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import {
  electronWorkbenchCommandRunnerGetStatus,
  electronWorkbenchCommandRunnerRunRecipe,
  electronWorkbenchCommandRunnerStartProjectPreview,
  electronWorkbenchCommandRunnerStateChanged,
  electronWorkbenchCommandRunnerStopProjectPreview,
} from '../../../../shared/eventa'
import { classifyWorkbenchRecipeRisk } from '../../../../shared/workbench-planner-policy'

export interface WorkbenchCommandRunnerService {
  getStatus: () => ElectronWorkbenchCommandRunnerStatus
  runRecipe: (payload: ElectronWorkbenchCommandRunRecipePayload) => Promise<ElectronWorkbenchCommandRunSnapshot>
  startProjectPreview: (payload: ElectronWorkbenchProjectPreviewStartPayload) => Promise<ElectronWorkbenchProjectPreviewSnapshot>
  stopProjectPreview: (payload: ElectronWorkbenchProjectPreviewStopPayload) => Promise<ElectronWorkbenchProjectPreviewSnapshot | undefined>
}

type WorkbenchCommandRunnerEventContext = ReturnType<typeof createContext>['context']
type FinishedCommandRunStatus = Exclude<ElectronWorkbenchCommandRunSnapshot['status'], 'running'>
interface ProjectPreviewController {
  child: ChildProcess
  stopRequested: boolean
}

const ALLOWED_PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])
const DEFAULT_MAX_BYTES = 192 * 1024
const MAX_MAX_BYTES = 768 * 1024
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000
const MAX_RUN_HISTORY = 50
const MAX_PROJECT_PREVIEW_HISTORY = 20
const SUMMARY_LENGTH = 220
const OUTPUT_PREVIEW_LENGTH = 2400
const LOCAL_PREVIEW_URL_PATTERN = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?/i

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizePath(path: string) {
  return resolve(path).replace(/\\/g, '/')
}

function normalizeCommand(command: string) {
  return command.trim().replace(/\.cmd$/i, '').toLowerCase()
}

function getSpawnCommand(command: string) {
  const normalized = normalizeCommand(command)
  if (process.platform === 'win32' && normalized === 'pnpm')
    return 'pnpm.cmd'
  if (process.platform === 'win32' && normalized === 'yarn')
    return 'yarn.cmd'
  if (process.platform === 'win32' && normalized === 'npm')
    return 'npm.cmd'
  if (process.platform === 'win32' && normalized === 'bun')
    return 'bun.cmd'
  return normalized
}

function shouldUseWindowsCommandShell(command: string) {
  return process.platform === 'win32' && ALLOWED_PACKAGE_MANAGERS.has(normalizeCommand(command))
}

function toCommandText(command: string, args: string[]) {
  return [command, ...args].join(' ')
}

function spawnWorkbenchCommand(command: string, args: string[], cwd: string) {
  const spawnOptions: SpawnOptions = {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }

  if (shouldUseWindowsCommandShell(command)) {
    // NOTICE: Node documents that Windows .cmd/.bat scripts should be launched via cmd.exe or a shell wrapper.
    // Direct spawn can surface EINVAL here, so keep the allowlisted package-manager recipe text for display
    // while executing through cmd.exe on Windows. Source: https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows
    return spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], spawnOptions)
  }

  return spawn(command, args, spawnOptions)
}

function stopWorkbenchChild(child: ChildProcess) {
  if (child.killed)
    return

  if (process.platform === 'win32' && child.pid) {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    taskkill.once('error', () => {
      if (!child.killed)
        child.kill()
    })
    return
  }

  child.kill()
}

function summarizeOutput(text: string) {
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized)
    return undefined

  const firstLine = normalized.split('\n').find(line => line.trim())?.trim() ?? normalized
  return firstLine.length > SUMMARY_LENGTH ? `${firstLine.slice(0, SUMMARY_LENGTH - 3)}...` : firstLine
}

function combineOutput(stdout: string, stderr: string) {
  const normalizedStdout = stdout.replace(/\r/g, '').trim()
  const normalizedStderr = stderr.replace(/\r/g, '').trim()
  if (normalizedStdout && normalizedStderr)
    return `${normalizedStdout}\n\n[stderr]\n${normalizedStderr}`
  if (normalizedStdout)
    return normalizedStdout
  if (normalizedStderr)
    return `[stderr]\n${normalizedStderr}`
  return ''
}

function appendCappedText(input: {
  current: string
  chunk: string
  maxBytes: number
}) {
  const currentBytes = Buffer.byteLength(input.current, 'utf-8')
  if (currentBytes >= input.maxBytes) {
    return {
      text: input.current,
      truncated: true,
    }
  }

  const remainingBytes = input.maxBytes - currentBytes
  if (Buffer.byteLength(input.chunk, 'utf-8') <= remainingBytes) {
    return {
      text: input.current + input.chunk,
      truncated: false,
    }
  }

  let consumed = ''
  for (const character of input.chunk) {
    const next = consumed + character
    if (Buffer.byteLength(next, 'utf-8') > remainingBytes)
      break

    consumed = next
  }

  return {
    text: input.current + consumed,
    truncated: true,
  }
}

function cloneRun(run: ElectronWorkbenchCommandRunSnapshot): ElectronWorkbenchCommandRunSnapshot {
  return {
    ...run,
    args: [...run.args],
  }
}

function cloneProjectPreview(preview: ElectronWorkbenchProjectPreviewSnapshot): ElectronWorkbenchProjectPreviewSnapshot {
  return {
    ...preview,
    args: [...preview.args],
  }
}

function stringifyError(error: unknown) {
  if (error instanceof Error)
    return error.message

  return String(error)
}

function findProjectPreviewUrl(output: string) {
  return output.match(LOCAL_PREVIEW_URL_PATTERN)?.[0]
}

function assertRecipePolicyAllowsAutonomousRun(policy: WorkbenchPlannerPolicyDecision) {
  if (policy.disposition !== 'allow-autonomous')
    throw new Error(`${policy.reason} (${policy.reasonCode})`)
}

function assertRecipeRunnable(recipe: ElectronWorkbenchWorkspaceRecipe, workspaceRoot: string) {
  const policy = classifyWorkbenchRecipeRisk(recipe, {
    mode: 'run-recipe',
    workspaceRoot,
  })
  assertRecipePolicyAllowsAutonomousRun(policy)
  return policy
}

function assertProjectPreviewRunnable(recipe: ElectronWorkbenchWorkspaceRecipe, workspaceRoot: string) {
  const policy = classifyWorkbenchRecipeRisk(recipe, {
    mode: 'project-preview',
    workspaceRoot,
  })
  assertRecipePolicyAllowsAutonomousRun(policy)
  return policy
}

function getCommandPolicyMetadata(policy: WorkbenchPlannerPolicyDecision) {
  return {
    commandPolicyDisposition: policy.disposition,
    commandRisk: policy.risk,
    commandRiskReason: policy.reason,
    commandRiskReasonCode: policy.reasonCode,
  }
}

function resolveRecipeCwd(workspaceRoot: string, recipe: ElectronWorkbenchWorkspaceRecipe) {
  if (!recipe.cwd)
    return normalizePath(workspaceRoot)

  const candidate = isAbsolute(recipe.cwd)
    ? normalizePath(recipe.cwd)
    : normalizePath(resolve(workspaceRoot, recipe.cwd))
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
  if (candidate !== normalizedWorkspaceRoot && !candidate.startsWith(`${normalizedWorkspaceRoot}/`))
    throw new Error(`Recipe cwd escapes workspace: ${recipe.cwd}`)

  return candidate
}

export function createWorkbenchCommandRunnerService(options: {
  agentSessionController: AgentSessionControllerService
  context?: WorkbenchCommandRunnerEventContext
  workbenchMemory: WorkbenchMemoryService
  workbenchWorkspace: WorkbenchWorkspaceService
}): WorkbenchCommandRunnerService {
  const runs = new Map<string, ElectronWorkbenchCommandRunSnapshot>()
  const projectPreviews = new Map<string, ElectronWorkbenchProjectPreviewSnapshot>()
  const runningChildren = new Map<string, ChildProcess>()
  const runningProjectPreviews = new Map<string, ProjectPreviewController>()

  function getStatus(): ElectronWorkbenchCommandRunnerStatus {
    return {
      projectPreviews: Array.from(projectPreviews.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_PROJECT_PREVIEW_HISTORY)
        .map(cloneProjectPreview),
      runs: Array.from(runs.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_RUN_HISTORY)
        .map(cloneRun),
    }
  }

  function emitStatusChanged() {
    options.context?.emit(electronWorkbenchCommandRunnerStateChanged, getStatus())
  }

  function saveRun(run: ElectronWorkbenchCommandRunSnapshot) {
    runs.set(run.runId, run)
    emitStatusChanged()
    return cloneRun(run)
  }

  function saveProjectPreview(preview: ElectronWorkbenchProjectPreviewSnapshot) {
    projectPreviews.set(preview.previewId, preview)
    emitStatusChanged()
    return cloneProjectPreview(preview)
  }

  function requireWorkspaceAndRecipe(payload: ElectronWorkbenchCommandRunRecipePayload) {
    const workspace = options.workbenchWorkspace
      .getStatus()
      .workspaces
      .find(candidate => candidate.workspaceId === payload.workspaceId)
    if (!workspace)
      throw new Error(`Workbench workspace not found: ${payload.workspaceId}`)

    const recipe = workspace.recipes.find(candidate => candidate.recipeId === payload.recipeId)
    if (!recipe)
      throw new Error(`Workbench recipe not found: ${payload.recipeId}`)

    return { recipe, workspace }
  }

  async function runRecipe(payload: ElectronWorkbenchCommandRunRecipePayload): Promise<ElectronWorkbenchCommandRunSnapshot> {
    const { recipe, workspace } = requireWorkspaceAndRecipe(payload)
    const commandPolicy = assertRecipeRunnable(recipe, workspace.root)

    const maxBytes = clamp(payload.maxBytes ?? DEFAULT_MAX_BYTES, 1, MAX_MAX_BYTES)
    const timeoutMs = clamp(payload.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS)
    const runId = `workbench-command-run-${randomUUID()}`
    const command = getSpawnCommand(recipe.command)
    const cwd = resolveRecipeCwd(workspace.root, recipe)
    const now = Date.now()
    let cancellationRequested = false
    const run: ElectronWorkbenchCommandRunSnapshot = {
      args: [...recipe.args],
      command,
      commandText: toCommandText(command, recipe.args),
      cwd,
      outputTruncated: false,
      recipeId: recipe.recipeId,
      recipeKind: recipe.kind,
      recipeLabel: recipe.label,
      runId,
      sessionId: payload.sessionId,
      startedAt: now,
      status: 'running',
      taskCardId: payload.taskCardId,
      updatedAt: now,
      workspaceId: workspace.workspaceId,
    }
    await Promise.resolve(options.agentSessionController.startRun({
      cancellable: true,
      kind: 'command',
      label: run.commandText,
      metadata: {
        ...getCommandPolicyMetadata(commandPolicy),
        recipeId: recipe.recipeId,
        recipeKind: recipe.kind,
        taskCardId: payload.taskCardId,
        workspaceId: workspace.workspaceId,
      },
      runId,
      sessionId: payload.sessionId,
    }, {
      cancel: () => {
        cancellationRequested = true
        const child = runningChildren.get(runId)
        if (child && !child.killed)
          child.kill()
      },
    }))
    saveRun(run)

    return await new Promise((resolveRun) => {
      let stdout = ''
      let stderr = ''
      let stdoutTruncated = false
      let stderrTruncated = false
      let settled = false
      let timedOut = false
      let timeout: ReturnType<typeof setTimeout> | undefined

      function finish(status: FinishedCommandRunStatus, exitCode?: number, error?: string) {
        if (settled)
          return

        settled = true
        if (timeout)
          clearTimeout(timeout)
        runningChildren.delete(runId)

        const finishedAt = Date.now()
        const output = combineOutput(stdout, stderr)
        const outputPreview = output.length > OUTPUT_PREVIEW_LENGTH
          ? `${output.slice(0, OUTPUT_PREVIEW_LENGTH - 3)}...`
          : output
        const nextRun: ElectronWorkbenchCommandRunSnapshot = {
          ...run,
          durationMs: finishedAt - run.startedAt,
          error,
          exitCode,
          finishedAt,
          outputPreview,
          outputTruncated: stdoutTruncated || stderrTruncated || output.length > OUTPUT_PREVIEW_LENGTH,
          status,
          stderrSummary: summarizeOutput(stderr),
          stdoutSummary: summarizeOutput(stdout),
          updatedAt: finishedAt,
        }
        saveRun(nextRun)

        void Promise.resolve(options.agentSessionController.finishRun({
          reason: error,
          runId,
          sessionId: payload.sessionId,
          status,
        })).catch(() => {})

        try {
          options.workbenchMemory.append({
            artifactRefs: [{
              id: runId,
              kind: 'command',
              label: nextRun.commandText,
              metadata: {
                ...getCommandPolicyMetadata(commandPolicy),
                exitCode,
                status,
                taskCardId: payload.taskCardId,
              },
              sessionId: payload.sessionId,
            }],
            body: outputPreview || error,
            kind: 'command-output',
            metadata: {
              ...getCommandPolicyMetadata(commandPolicy),
              commandText: nextRun.commandText,
              durationMs: nextRun.durationMs,
              exitCode,
              recipeId: recipe.recipeId,
              status,
              taskCardId: payload.taskCardId,
            },
            retention: 'artifact-ref',
            sessionId: payload.sessionId,
            sourceRunId: runId,
            summary: error ?? `${nextRun.commandText}: ${status}${exitCode == null ? '' : ` (exit ${exitCode})`}`,
            tags: payload.taskCardId ? ['command', recipe.kind, `task:${payload.taskCardId}`] : ['command', recipe.kind],
            title: `${recipe.label}: ${status}`,
          })
        }
        catch (cause) {
          const memoryError = `Failed to record command output: ${stringifyError(cause)}`
          nextRun.error = nextRun.error ? `${nextRun.error}; ${memoryError}` : memoryError
          saveRun(nextRun)
        }

        resolveRun(nextRun)
      }

      if (cancellationRequested) {
        finish('cancelled', undefined, 'Command cancelled before spawn')
        return
      }

      let child: ChildProcess
      try {
        child = spawnWorkbenchCommand(command, recipe.args, cwd)
      }
      catch (cause) {
        finish('failed', undefined, stringifyError(cause))
        return
      }

      runningChildren.set(runId, child)
      if (cancellationRequested && !child.killed)
        child.kill()

      timeout = setTimeout(() => {
        timedOut = true
        if (!child.killed)
          child.kill()
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const next = appendCappedText({
          chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
          current: stdout,
          maxBytes,
        })
        stdout = next.text
        stdoutTruncated ||= next.truncated
      })

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const next = appendCappedText({
          chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
          current: stderr,
          maxBytes,
        })
        stderr = next.text
        stderrTruncated ||= next.truncated
      })

      child.once('error', (error) => {
        finish('failed', undefined, stringifyError(error))
      })

      child.once('close', (code, signal) => {
        const exitCode = code ?? (signal ? -1 : undefined)
        if (timedOut) {
          finish('cancelled', exitCode, `Command timed out after ${timeoutMs} ms`)
          return
        }
        if (signal) {
          finish('cancelled', exitCode, `Command cancelled with signal ${signal}`)
          return
        }

        finish(exitCode === 0 ? 'success' : 'failed', exitCode)
      })
    })
  }

  function getActiveProjectPreview(workspaceId: string, recipeId: string) {
    return Array.from(projectPreviews.values()).find(preview => (
      preview.workspaceId === workspaceId
      && preview.recipeId === recipeId
      && (preview.status === 'starting' || preview.status === 'running' || preview.status === 'stopping')
    ))
  }

  async function startProjectPreview(payload: ElectronWorkbenchProjectPreviewStartPayload): Promise<ElectronWorkbenchProjectPreviewSnapshot> {
    const { recipe, workspace } = requireWorkspaceAndRecipe(payload)
    const commandPolicy = assertProjectPreviewRunnable(recipe, workspace.root)

    const existingPreview = getActiveProjectPreview(workspace.workspaceId, recipe.recipeId)
    if (existingPreview)
      return cloneProjectPreview(existingPreview)

    const maxBytes = clamp(payload.maxBytes ?? DEFAULT_MAX_BYTES, 1, MAX_MAX_BYTES)
    const previewId = `workbench-project-preview-${randomUUID()}`
    const command = getSpawnCommand(recipe.command)
    const cwd = resolveRecipeCwd(workspace.root, recipe)
    const now = Date.now()
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let cancellationRequested = false
    let settled = false
    let preview: ElectronWorkbenchProjectPreviewSnapshot = {
      args: [...recipe.args],
      command,
      commandText: toCommandText(command, recipe.args),
      cwd,
      outputTruncated: false,
      previewId,
      recipeId: recipe.recipeId,
      recipeKind: recipe.kind,
      recipeLabel: recipe.label,
      sessionId: payload.sessionId,
      startedAt: now,
      status: 'starting',
      updatedAt: now,
      workspaceId: workspace.workspaceId,
    }

    function updatePreviewFromOutput() {
      const updatedAt = Date.now()
      const output = combineOutput(stdout, stderr)
      const outputPreview = output.length > OUTPUT_PREVIEW_LENGTH
        ? `${output.slice(0, OUTPUT_PREVIEW_LENGTH - 3)}...`
        : output
      preview = saveProjectPreview({
        ...preview,
        outputPreview,
        outputTruncated: stdoutTruncated || stderrTruncated || output.length > OUTPUT_PREVIEW_LENGTH,
        stderrSummary: summarizeOutput(stderr),
        stdoutSummary: summarizeOutput(stdout),
        updatedAt,
        url: preview.url ?? findProjectPreviewUrl(output),
      })
    }

    function finishProjectPreview(status: ElectronWorkbenchProjectPreviewSnapshot['status'], error?: string) {
      if (settled)
        return

      settled = true
      const controller = runningProjectPreviews.get(previewId)
      runningProjectPreviews.delete(previewId)
      const stoppedAt = Date.now()
      const output = combineOutput(stdout, stderr)
      const outputPreview = output.length > OUTPUT_PREVIEW_LENGTH
        ? `${output.slice(0, OUTPUT_PREVIEW_LENGTH - 3)}...`
        : output
      preview = saveProjectPreview({
        ...preview,
        durationMs: stoppedAt - preview.startedAt,
        error,
        outputPreview,
        outputTruncated: stdoutTruncated || stderrTruncated || output.length > OUTPUT_PREVIEW_LENGTH,
        status,
        stderrSummary: summarizeOutput(stderr),
        stdoutSummary: summarizeOutput(stdout),
        stoppedAt,
        updatedAt: stoppedAt,
        url: preview.url ?? findProjectPreviewUrl(output),
      })

      void Promise.resolve(options.agentSessionController.finishRun({
        reason: error,
        runId: previewId,
        sessionId: payload.sessionId,
        status: status === 'failed'
          ? 'failed'
          : (controller?.stopRequested || cancellationRequested ? 'cancelled' : 'success'),
      })).catch(() => {})
    }

    saveProjectPreview(preview)
    await Promise.resolve(options.agentSessionController.startRun({
      cancellable: true,
      kind: 'command',
      label: preview.commandText,
      metadata: {
        ...getCommandPolicyMetadata(commandPolicy),
        previewId,
        recipeId: recipe.recipeId,
        recipeKind: recipe.kind,
        workspaceId: workspace.workspaceId,
      },
      runId: previewId,
      sessionId: payload.sessionId,
    }, {
      cancel: () => {
        cancellationRequested = true
        void stopProjectPreview({ previewId })
      },
    }))

    if (cancellationRequested) {
      finishProjectPreview('stopped', 'Project preview cancelled before spawn')
      return cloneProjectPreview(preview)
    }

    let child: ChildProcess
    try {
      child = spawnWorkbenchCommand(command, recipe.args, cwd)
    }
    catch (cause) {
      finishProjectPreview('failed', stringifyError(cause))
      return cloneProjectPreview(preview)
    }

    const controller: ProjectPreviewController = {
      child,
      stopRequested: false,
    }
    runningProjectPreviews.set(previewId, controller)
    preview = saveProjectPreview({
      ...preview,
      status: 'running',
      updatedAt: Date.now(),
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const next = appendCappedText({
        chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
        current: stdout,
        maxBytes,
      })
      stdout = next.text
      stdoutTruncated ||= next.truncated
      updatePreviewFromOutput()
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const next = appendCappedText({
        chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
        current: stderr,
        maxBytes,
      })
      stderr = next.text
      stderrTruncated ||= next.truncated
      updatePreviewFromOutput()
    })

    child.once('error', (error) => {
      finishProjectPreview('failed', stringifyError(error))
    })

    child.once('close', (code, signal) => {
      if (controller.stopRequested || cancellationRequested) {
        finishProjectPreview('stopped')
        return
      }

      if (signal) {
        finishProjectPreview('failed', `Project preview exited with signal ${signal}`)
        return
      }

      if (code === 0) {
        finishProjectPreview('stopped')
        return
      }

      finishProjectPreview('failed', `Project preview exited with code ${code ?? 'unknown'}`)
    })

    if (cancellationRequested)
      stopWorkbenchChild(child)

    return cloneProjectPreview(preview)
  }

  async function stopProjectPreview(payload: ElectronWorkbenchProjectPreviewStopPayload): Promise<ElectronWorkbenchProjectPreviewSnapshot | undefined> {
    const preview = projectPreviews.get(payload.previewId)
    if (!preview)
      return undefined

    const controller = runningProjectPreviews.get(payload.previewId)
    if (!controller)
      return cloneProjectPreview(preview)

    controller.stopRequested = true
    stopWorkbenchChild(controller.child)
    return saveProjectPreview({
      ...preview,
      status: 'stopping',
      updatedAt: Date.now(),
    })
  }

  return {
    getStatus,
    runRecipe,
    startProjectPreview,
    stopProjectPreview,
  }
}

export function createWorkbenchCommandRunnerHandlers(params: {
  context: WorkbenchCommandRunnerEventContext
  service: WorkbenchCommandRunnerService
}) {
  defineInvokeHandler(params.context, electronWorkbenchCommandRunnerGetStatus, () => {
    return params.service.getStatus()
  })

  defineInvokeHandler(params.context, electronWorkbenchCommandRunnerRunRecipe, async (payload) => {
    return await params.service.runRecipe(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchCommandRunnerStartProjectPreview, async (payload) => {
    return await params.service.startProjectPreview(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchCommandRunnerStopProjectPreview, async (payload) => {
    return await params.service.stopProjectPreview(payload)
  })
}

export function setupWorkbenchCommandRunnerService(options: {
  agentSessionController: AgentSessionControllerService
  workbenchMemory: WorkbenchMemoryService
  workbenchWorkspace: WorkbenchWorkspaceService
}) {
  const { context } = createElectronContext(ipcMain)
  const service = createWorkbenchCommandRunnerService({
    ...options,
    context,
  })
  createWorkbenchCommandRunnerHandlers({ context, service })
  return service
}
