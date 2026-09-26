import type {
  ElectronCommandExecutionDiagnosticEntry,
  ElectronCommandExecutionDiagnosticSummary,
  ElectronCommandExecutionGitDiffFileEntry,
  ElectronCommandExecutionLintTarget,
  ElectronCommandExecutionTypecheckTarget,
} from '../../../../shared/eventa'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

export interface RestrictedCommandResult {
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  exitCode: number
  ok: boolean
}

export interface GitStatusEntry {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  renamed: boolean
  originalPath?: string
}

export interface GitStatusSummary {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
  clean: boolean
  entries: GitStatusEntry[]
}

function normalizeDiagnosticPath(path: string) {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
}

function buildDiagnosticSummary(entries: ElectronCommandExecutionDiagnosticEntry[]): ElectronCommandExecutionDiagnosticSummary {
  const filesByPath = new Map<string, {
    path: string
    issueCount: number
    errorCount: number
    warningCount: number
  }>()

  let errorCount = 0
  let warningCount = 0
  for (const entry of entries) {
    if (entry.severity === 'error') {
      errorCount += 1
    }
    else {
      warningCount += 1
    }

    const fileSummary = filesByPath.get(entry.path) ?? {
      path: entry.path,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    }
    fileSummary.issueCount += 1
    if (entry.severity === 'error') {
      fileSummary.errorCount += 1
    }
    else {
      fileSummary.warningCount += 1
    }
    filesByPath.set(entry.path, fileSummary)
  }

  const files = Array.from(filesByPath.values())
    .sort((left, right) => {
      if (right.issueCount !== left.issueCount) {
        return right.issueCount - left.issueCount
      }
      return left.path.localeCompare(right.path)
    })

  return {
    totalIssues: entries.length,
    errorCount,
    warningCount,
    fileCount: files.length,
    files,
    entries,
  }
}

function toDiagnosticEntry(input: {
  path: string
  line?: string
  column?: string
  severity: string
  code?: string
  message: string
}): ElectronCommandExecutionDiagnosticEntry | undefined {
  const path = normalizeDiagnosticPath(input.path)
  const severity = input.severity.toLowerCase()
  if (!path || (severity !== 'error' && severity !== 'warning')) {
    return undefined
  }

  return {
    path,
    line: input.line ? Number(input.line) : undefined,
    column: input.column ? Number(input.column) : undefined,
    severity,
    code: input.code?.trim() || undefined,
    message: input.message.trim(),
  }
}

function parseSeverityCodeMessage(text: string) {
  const compactText = text.trim()
  const firstSpaceIndex = compactText.indexOf(' ')
  if (firstSpaceIndex <= 0) {
    return undefined
  }

  const severity = compactText.slice(0, firstSpaceIndex).toLowerCase()
  const remainder = compactText.slice(firstSpaceIndex + 1).trim()
  const codeSeparatorIndex = remainder.indexOf(':')
  if ((severity !== 'error' && severity !== 'warning') || codeSeparatorIndex <= 0) {
    return undefined
  }

  return {
    severity,
    code: remainder.slice(0, codeSeparatorIndex).trim(),
    message: remainder.slice(codeSeparatorIndex + 1).trim(),
  }
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
  const chunkBytes = Buffer.byteLength(input.chunk, 'utf-8')
  if (chunkBytes <= remainingBytes) {
    return {
      text: input.current + input.chunk,
      truncated: false,
    }
  }

  let consumed = ''
  for (const character of input.chunk) {
    const next = consumed + character
    if (Buffer.byteLength(next, 'utf-8') > remainingBytes) {
      break
    }
    consumed = next
  }

  return {
    text: input.current + consumed,
    truncated: true,
  }
}

export async function runRestrictedCommand(input: {
  command: string
  args: string[]
  cwd: string
  maxBytes: number
  rejectOnNonZeroExit?: boolean
}): Promise<RestrictedCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false

    child.stdout.on('data', (chunk: Buffer | string) => {
      const next = appendCappedText({
        current: stdout,
        chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
        maxBytes: input.maxBytes,
      })
      stdout = next.text
      stdoutTruncated ||= next.truncated
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      const next = appendCappedText({
        current: stderr,
        chunk: typeof chunk === 'string' ? chunk : chunk.toString('utf-8'),
        maxBytes: input.maxBytes,
      })
      stderr = next.text
      stderrTruncated ||= next.truncated
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code) => {
      const exitCode = code ?? -1
      const ok = exitCode === 0
      if (!ok && input.rejectOnNonZeroExit !== false) {
        reject(new Error(stderr.trim() || `Restricted command failed with exit code ${code ?? 'unknown'}.`))
        return
      }

      resolve({
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        exitCode,
        ok,
      })
    })
  })
}

function parseGitBranchLine(line: string) {
  if (line === '## HEAD (no branch)') {
    return {
      branch: undefined,
      upstream: undefined,
      ahead: 0,
      behind: 0,
      detached: true,
    }
  }

  if (!line.startsWith('## ')) {
    return {
      branch: undefined,
      upstream: undefined,
      ahead: 0,
      behind: 0,
      detached: false,
    }
  }

  const summary = line.slice(3)
  const trackingStartIndex = summary.indexOf(' [')
  const branchPart = trackingStartIndex >= 0 ? summary.slice(0, trackingStartIndex) : summary
  const trackingPart = trackingStartIndex >= 0 && summary.endsWith(']')
    ? summary.slice(trackingStartIndex + 2, -1)
    : ''
  const branchSeparatorIndex = branchPart.indexOf('...')
  const branch = branchSeparatorIndex >= 0 ? branchPart.slice(0, branchSeparatorIndex) : branchPart
  const upstream = branchSeparatorIndex >= 0 ? branchPart.slice(branchSeparatorIndex + 3) : undefined
  const aheadMatch = /ahead (?<ahead>\d+)/.exec(trackingPart)
  const behindMatch = /behind (?<behind>\d+)/.exec(trackingPart)

  if (branch) {
    return {
      branch,
      upstream: upstream || undefined,
      ahead: aheadMatch?.groups?.ahead ? Number(aheadMatch.groups.ahead) : 0,
      behind: behindMatch?.groups?.behind ? Number(behindMatch.groups.behind) : 0,
      detached: false,
    }
  }

  return {
    branch: undefined,
    upstream: undefined,
    ahead: 0,
    behind: 0,
    detached: false,
  }
}

function parseGitStatusEntry(line: string): GitStatusEntry | undefined {
  if (line.startsWith('?? ')) {
    const path = line.slice(3).trim()
    return {
      path,
      indexStatus: '?',
      workTreeStatus: '?',
      staged: false,
      unstaged: false,
      untracked: true,
      renamed: false,
    }
  }

  if (line.length < 4) {
    return undefined
  }

  const indexStatus = line[0]
  const workTreeStatus = line[1]
  const pathPart = line.slice(3).trim()
  const renameParts = pathPart.split(' -> ')
  const renamed = renameParts.length === 2
  const path = renamed ? renameParts[1] : pathPart
  const originalPath = renamed ? renameParts[0] : undefined

  return {
    path,
    indexStatus,
    workTreeStatus,
    staged: indexStatus !== ' ' && indexStatus !== '?',
    unstaged: workTreeStatus !== ' ' && workTreeStatus !== '?',
    untracked: false,
    renamed,
    originalPath,
  }
}

export function parseGitStatusOutput(output: string): GitStatusSummary {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => line.trim().length > 0)

  let branch: string | undefined
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  let detached = false
  const entries: GitStatusEntry[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const branchInfo = parseGitBranchLine(line)
      branch = branchInfo.branch
      upstream = branchInfo.upstream
      ahead = branchInfo.ahead
      behind = branchInfo.behind
      detached = branchInfo.detached
      continue
    }

    const entry = parseGitStatusEntry(line)
    if (entry) {
      entries.push(entry)
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached,
    clean: entries.length === 0,
    entries,
  }
}

function stripWrappedQuotes(text: string) {
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
}

function parseGitPrefixedPath(input: {
  spec: string
  prefix?: 'a/' | 'b/'
}) {
  const spec = stripWrappedQuotes(input.spec.trim())
  if (!spec || spec === '/dev/null') {
    return undefined
  }

  if (input.prefix && spec.startsWith(input.prefix)) {
    return normalizeDiagnosticPath(spec.slice(input.prefix.length))
  }

  return normalizeDiagnosticPath(spec)
}

function finalizeGitDiffFileEntry(entry?: ElectronCommandExecutionGitDiffFileEntry) {
  if (!entry) {
    return undefined
  }

  const path = entry.path
    ? normalizeDiagnosticPath(entry.path)
    : entry.originalPath
      ? normalizeDiagnosticPath(entry.originalPath)
      : ''

  if (!path) {
    return undefined
  }

  const originalPath = entry.originalPath ? normalizeDiagnosticPath(entry.originalPath) : undefined

  return {
    ...entry,
    path,
    originalPath: entry.renamed && originalPath && originalPath !== path ? originalPath : undefined,
  }
}

export function parseGitDiffChangedFiles(output: string): ElectronCommandExecutionGitDiffFileEntry[] {
  const lines = output.replace(/\r/g, '').split('\n')
  const files: ElectronCommandExecutionGitDiffFileEntry[] = []
  let current: ElectronCommandExecutionGitDiffFileEntry | undefined

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const finalized = finalizeGitDiffFileEntry(current)
      if (finalized) {
        files.push(finalized)
      }

      current = {
        path: '',
        originalPath: undefined,
        added: false,
        deleted: false,
        renamed: false,
      }
      continue
    }

    if (!current) {
      continue
    }

    if (line.startsWith('rename from ')) {
      current.originalPath = parseGitPrefixedPath({
        spec: line.slice('rename from '.length),
      })
      current.renamed = true
      continue
    }

    if (line.startsWith('rename to ')) {
      current.path = parseGitPrefixedPath({
        spec: line.slice('rename to '.length),
      }) ?? current.path
      current.renamed = true
      continue
    }

    if (line.startsWith('new file mode ')) {
      current.added = true
      continue
    }

    if (line.startsWith('deleted file mode ')) {
      current.deleted = true
      continue
    }

    if (line.startsWith('--- ')) {
      const originalPath = parseGitPrefixedPath({
        spec: line.slice(4),
        prefix: 'a/',
      })
      if (originalPath && !current.originalPath) {
        current.originalPath = originalPath
      }
      continue
    }

    if (line.startsWith('+++ ')) {
      const nextPath = parseGitPrefixedPath({
        spec: line.slice(4),
        prefix: 'b/',
      })
      if (nextPath) {
        current.path = nextPath
      }
      continue
    }
  }

  const finalized = finalizeGitDiffFileEntry(current)
  if (finalized) {
    files.push(finalized)
  }

  return files
}

export function parseTypecheckDiagnostics(output: string): ElectronCommandExecutionDiagnosticSummary {
  const lines = output.replace(/\r/g, '').split('\n')
  const entries: ElectronCommandExecutionDiagnosticEntry[] = []

  for (const line of lines) {
    const compactLine = line.trim()
    if (!compactLine) {
      continue
    }

    const parenLocationSeparatorIndex = compactLine.indexOf('): ')
    if (parenLocationSeparatorIndex > 0) {
      const openParenIndex = compactLine.lastIndexOf('(', parenLocationSeparatorIndex)
      if (openParenIndex > 0) {
        const path = compactLine.slice(0, openParenIndex)
        const location = compactLine.slice(openParenIndex + 1, parenLocationSeparatorIndex)
        const [lineNumber, columnNumber] = location.split(',')
        const details = parseSeverityCodeMessage(compactLine.slice(parenLocationSeparatorIndex + 3))
        const entry = details
          ? toDiagnosticEntry({
              path,
              line: lineNumber,
              column: columnNumber,
              ...details,
            })
          : undefined
        if (entry) {
          entries.push(entry)
          continue
        }
      }
    }

    const dashedSeparatorIndex = compactLine.indexOf(' - ')
    if (dashedSeparatorIndex > 0) {
      const location = compactLine.slice(0, dashedSeparatorIndex)
      const lastColonIndex = location.lastIndexOf(':')
      const secondLastColonIndex = location.lastIndexOf(':', lastColonIndex - 1)
      if (secondLastColonIndex > 0 && lastColonIndex > secondLastColonIndex) {
        const path = location.slice(0, secondLastColonIndex)
        const lineNumber = location.slice(secondLastColonIndex + 1, lastColonIndex)
        const columnNumber = location.slice(lastColonIndex + 1)
        const details = parseSeverityCodeMessage(compactLine.slice(dashedSeparatorIndex + 3))
        const entry = details
          ? toDiagnosticEntry({
              path,
              line: lineNumber,
              column: columnNumber,
              ...details,
            })
          : undefined
        if (entry) {
          entries.push(entry)
        }
      }
    }
  }

  return buildDiagnosticSummary(entries)
}

function looksLikeLintFilePath(line: string) {
  if (!line || line.startsWith('! ') || line.startsWith('✖ ') || line.startsWith('Done in ')) {
    return false
  }

  return /[\\/]/.test(line) || /\.[a-z0-9-]+$/i.test(line)
}

export function parseLintDiagnostics(output: string): ElectronCommandExecutionDiagnosticSummary {
  const lines = output.replace(/\r/g, '').split('\n')
  const entries: ElectronCommandExecutionDiagnosticEntry[] = []
  let currentFile: string | undefined

  for (const line of lines) {
    const trimmedEndLine = line.trimEnd()
    const compactLine = trimmedEndLine.trim()
    if (!compactLine) {
      continue
    }

    if (currentFile) {
      const parts = compactLine.split(/\s{2,}/).filter(Boolean)
      if (parts.length >= 4) {
        const [location, severity, ...rest] = parts
        const code = rest.at(-1)
        const message = rest.slice(0, -1).join('  ')
        const [lineNumber, columnNumber] = location.split(':')

        const entry = code && lineNumber && columnNumber
          ? toDiagnosticEntry({
              path: currentFile,
              line: lineNumber,
              column: columnNumber,
              severity,
              code,
              message,
            })
          : undefined
        if (entry) {
          entries.push(entry)
          continue
        }
      }
    }

    if (!/^\s/.test(trimmedEndLine) && looksLikeLintFilePath(compactLine)) {
      currentFile = compactLine
    }
  }

  return buildDiagnosticSummary(entries)
}

export function buildGitStatusArgs() {
  return [
    'status',
    '--short',
    '--branch',
    '--untracked-files=all',
    '--no-renames',
  ]
}

export function buildGitDiffArgs(input?: {
  staged?: boolean
  contextLines?: number
  path?: string
}) {
  const contextLines = Math.min(20, Math.max(0, input?.contextLines ?? 3))
  const args = [
    'diff',
    '--no-color',
    '--no-ext-diff',
    `--unified=${contextLines}`,
  ]

  if (input?.staged) {
    args.push('--cached')
  }

  if (input?.path) {
    args.push('--', input.path)
  }

  return args
}

const typecheckTargetPackages: Record<ElectronCommandExecutionTypecheckTarget, {
  packageName: string
  packageRoot: string
}> = {
  'stage-tamagotchi': {
    packageName: '@proj-airi/stage-tamagotchi',
    packageRoot: 'apps/stage-tamagotchi',
  },
  'stage-web': {
    packageName: '@proj-airi/stage-web',
    packageRoot: 'apps/stage-web',
  },
  'stage-ui': {
    packageName: '@proj-airi/stage-ui',
    packageRoot: 'packages/stage-ui',
  },
  'stage-pages': {
    packageName: '@proj-airi/stage-pages',
    packageRoot: 'packages/stage-pages',
  },
  'stage-shared': {
    packageName: '@proj-airi/stage-shared',
    packageRoot: 'packages/stage-shared',
  },
  'ui': {
    packageName: '@proj-airi/ui',
    packageRoot: 'packages/ui',
  },
  'i18n': {
    packageName: '@proj-airi/i18n',
    packageRoot: 'packages/i18n',
  },
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function buildPnpmScriptCommand(input: {
  packageName: string
  packageRoot: string
  script: string
}) {
  const command = getPnpmCommand()
  const args = ['-F', input.packageName, 'run', input.script]

  return {
    packageName: input.packageName,
    packageRoot: input.packageRoot,
    command,
    args,
    commandText: [command, ...args].join(' '),
  }
}

export function buildTypecheckCommand(input: {
  target: ElectronCommandExecutionTypecheckTarget
}) {
  const targetPackage = typecheckTargetPackages[input.target]
  const pnpmScriptCommand = buildPnpmScriptCommand({
    packageName: targetPackage.packageName,
    packageRoot: targetPackage.packageRoot,
    script: 'typecheck',
  })

  return {
    target: input.target,
    ...pnpmScriptCommand,
  }
}

const lintTargetPackages: Record<ElectronCommandExecutionLintTarget, {
  packageName: string
  packageRoot: string
}> = {
  'stage-tamagotchi': {
    packageName: '@proj-airi/stage-tamagotchi',
    packageRoot: 'apps/stage-tamagotchi',
  },
  'stage-web': {
    packageName: '@proj-airi/stage-web',
    packageRoot: 'apps/stage-web',
  },
}

export function buildLintCommand(input: {
  target: ElectronCommandExecutionLintTarget
}) {
  const targetPackage = lintTargetPackages[input.target]
  const pnpmScriptCommand = buildPnpmScriptCommand({
    packageName: targetPackage.packageName,
    packageRoot: targetPackage.packageRoot,
    script: 'lint',
  })

  return {
    target: input.target,
    ...pnpmScriptCommand,
  }
}
