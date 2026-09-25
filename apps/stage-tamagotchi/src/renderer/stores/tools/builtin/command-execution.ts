import type { StreamToolFallbackContextBuilder } from '@proj-airi/stage-ui/stores/llm'
import type { Message } from '@xsai/shared-chat'

import type {
  ElectronCommandExecutionDiagnosticSummary,
  ElectronCommandExecutionGitDiffResult,
  ElectronCommandExecutionGitStatusResult,
  ElectronCommandExecutionLintResult,
  ElectronCommandExecutionTypecheckResult,
} from '../../../../shared/eventa'
import type { SearchCandidateSelectionResult } from '../../../modules/command-execution-search-selection'

import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { electronCommandExecutionLintTargets, electronCommandExecutionTypecheckTargets } from '../../../../shared/eventa'
import { resolveSearchCandidateSelection } from '../../../modules/command-execution-search-selection'
import { useCommandExecutionStore } from '../../command-execution'

function toToolErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const COMMAND_RESULT_PREVIEW_LIMIT = 8
const WORKSPACE_READONLY_FALLBACK_DIRECTORY_LIMIT = 200
const WORKSPACE_READONLY_FALLBACK_READ_MAX_BYTES = 64 * 1024

const windowsAbsolutePathPattern = /[A-Z]:[\\/][^\s"'`<>|?*\u4E00-\u9FFF]+/i
const quotedPathPattern = /["'`]([^"'/\\`]*[/\\][^"'`]*)["'`]/
const relativePathPattern = /(?:^|[\s"'`])([\w@.-]+(?:[\\/][\w@(). -]+)+)/
const simpleDirectoryReferencePattern = /(?:list|read|inspect|open|show|check|\u67E5\u770B|\u770B\u4E00\u4E0B|\u770B\u770B|\u5217\u51FA|\u8BFB\u53D6)\s*([\w.@-]+)(?=\s*(?:folder|directory|\u6587\u4EF6\u5939|\u76EE\u5F55|\u6587\u4EF6))/i
const directoryListRequestPattern = /list\s+(?:files|directory|folder)|directory\s+contents|folder\s+contents|what\s+files|show\s+(?:files|directory|folder)|inspect\s+(?:directory|folder)|\u6709\u54EA\u4E9B\u6587\u4EF6|\u6587\u4EF6\u5217\u8868|\u5217\u51FA|\u5217\u4E00\u4E0B|\u67E5\u770B(?:\u4E00\u4E0B)?(?:\u6587\u4EF6\u5939|\u76EE\u5F55)|\u770B(?:\u4E00\u4E0B|\u770B)?(?:\u6587\u4EF6\u5939|\u76EE\u5F55)/i
const searchRequestPattern = /workspace_search|search|find|grep|rg|\u641C\u7D22|\u67E5\u627E|\u5B9A\u4F4D/i
const readFileRequestPattern = /workspace_read_file|read\s+file|\u8BFB\u53D6\u6587\u4EF6|\u67E5\u770B\u6587\u4EF6/i
const fileLikePathPattern = /\.(?:[cm]?[jt]sx?|vue|json|ya?ml|toml|md|txt|rs|swift|kt|css|scss|html)$/i

const writeTextModeSchema = z.enum(['replace', 'append', 'replace-range', 'replace-first-match', 'replace-all-matches', 'replace-nth-match', 'insert-before-marker', 'insert-after-marker'])
const writeTextRangeSchema = z.object({
  start: z.number().int().min(0).describe('Inclusive character offset where replace-range starts.'),
  end: z.number().int().min(0).describe('Exclusive character offset where replace-range ends.'),
}).strict()

function requireActiveSessionId() {
  const chatSessionStore = useChatSessionStore()
  const sessionId = chatSessionStore.activeSessionId

  if (!sessionId) {
    throw new Error('No active chat session is available for command execution.')
  }

  return sessionId
}

function getMessageText(content: unknown): string {
  if (typeof content === 'string')
    return content

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string')
        return part

      if (!part || typeof part !== 'object')
        return ''

      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    }).filter(Boolean).join('\n')
  }

  return ''
}

function getLastUserMessageText(messages: Array<{ role?: string, content?: unknown }>) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user')
      continue

    const text = getMessageText(message.content).trim()
    if (text)
      return text
  }

  return ''
}

function normalizePathForCompare(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function toWorkspaceRelativeInputPath(path: string | undefined, workspaceRoot: string) {
  if (!path)
    return undefined

  const normalizedPath = normalizePathForCompare(path)
  const normalizedRoot = normalizePathForCompare(workspaceRoot)
  const normalizedPathLower = normalizedPath.toLowerCase()
  const normalizedRootLower = normalizedRoot.toLowerCase()

  if (normalizedPathLower === normalizedRootLower)
    return undefined

  if (normalizedPathLower.startsWith(`${normalizedRootLower}/`))
    return normalizedPath.slice(normalizedRoot.length + 1)

  return normalizedPath
}

function extractRequestedWorkspacePath(messageText: string, workspaceRoot: string) {
  const quotedPath = messageText.match(quotedPathPattern)?.[1]
  const absolutePath = messageText.match(windowsAbsolutePathPattern)?.[0]
  const relativePath = messageText.match(relativePathPattern)?.[1]
  const simpleDirectoryReference = messageText.match(simpleDirectoryReferencePattern)?.[1]

  return toWorkspaceRelativeInputPath(
    quotedPath ?? absolutePath ?? relativePath ?? simpleDirectoryReference,
    workspaceRoot,
  )
}

function createWorkspaceReadonlyFallbackMessage(payload: Record<string, unknown>): Message[] {
  return [{
    role: 'system',
    content: [
      'Local tool context: provider-side tool calling failed, so the desktop app executed a read-only workspace command locally.',
      'Use the JSON result below as the only workspace command evidence for this turn.',
      'Do not claim that the workspace is invisible when success is true.',
      JSON.stringify(payload, null, 2),
    ].join('\n'),
  }]
}

function createWorkspaceReadonlyFallbackFailureMessage(input: {
  error: unknown
  operation: string
  requestedPath?: string
}) {
  return createWorkspaceReadonlyFallbackMessage({
    error: toToolErrorMessage(input.error),
    operation: input.operation,
    requestedPath: input.requestedPath,
    success: false,
  })
}

export const buildWorkspaceReadonlyFallbackContext: StreamToolFallbackContextBuilder = async ({ abortSignal, messages }) => {
  if (abortSignal?.aborted)
    return []

  const messageText = getLastUserMessageText(messages)
  if (!messageText)
    return []

  let operation = 'workspace_list_directory'
  let requestedPath: string | undefined

  try {
    const commandExecution = useCommandExecutionStore()
    const status = commandExecution.status ?? await commandExecution.refreshStatus()
    const sessionId = requireActiveSessionId()
    requestedPath = extractRequestedWorkspacePath(messageText, status.workspaceRoot)
    const wantsSearch = searchRequestPattern.test(messageText)
    const wantsReadFile = readFileRequestPattern.test(messageText) || (requestedPath ? fileLikePathPattern.test(requestedPath) : false)
    const wantsDirectoryList = directoryListRequestPattern.test(messageText)

    if (wantsDirectoryList) {
      operation = 'workspace_list_directory'
      const result = await commandExecution.listDirectory({
        limit: WORKSPACE_READONLY_FALLBACK_DIRECTORY_LIMIT,
        path: requestedPath,
        readScope: 'computer-readonly',
        sessionId,
      })

      return createWorkspaceReadonlyFallbackMessage({
        entries: result.entries,
        operation,
        path: result.path,
        requestedPath,
        success: true,
        transactionId: result.transactionId,
        truncated: result.truncated,
        workspaceRoot: result.workspaceRoot,
      })
    }

    if (wantsReadFile && requestedPath) {
      operation = 'workspace_read_file'
      const result = await commandExecution.read({
        maxBytes: WORKSPACE_READONLY_FALLBACK_READ_MAX_BYTES,
        path: requestedPath,
        readScope: 'computer-readonly',
        sessionId,
      })

      return createWorkspaceReadonlyFallbackMessage({
        byteLength: result.byteLength,
        content: result.content,
        operation,
        path: result.path,
        requestedPath,
        success: true,
        transactionId: result.transactionId,
        truncated: result.truncated,
        workspaceRoot: result.workspaceRoot,
      })
    }

    if (wantsSearch) {
      operation = 'workspace_search'
      const result = await commandExecution.search({
        limit: 50,
        mode: requestedPath ? 'path' : 'auto',
        query: requestedPath ?? messageText,
        readScope: 'computer-readonly',
        sessionId,
      })

      return createWorkspaceReadonlyFallbackMessage({
        matches: result.matches,
        operation,
        query: result.query,
        requestedPath,
        scope: result.scope,
        success: true,
        transactionId: result.transactionId,
        truncated: result.truncated,
        workspaceRoot: result.workspaceRoot,
      })
    }

    return []
  }
  catch (error) {
    return createWorkspaceReadonlyFallbackFailureMessage({
      error,
      operation,
      requestedPath,
    })
  }
}

function createCandidateSelectionResult(input: {
  searchTransactionId: string
  query: string
  selection: Exclude<SearchCandidateSelectionResult, { status: 'resolved' }>
}) {
  return {
    success: true,
    searchTransactionId: input.searchTransactionId,
    query: input.query,
    requiresCandidateSelection: true,
    candidatePaths: input.selection.matchedPaths,
    candidateCount: input.selection.matchedPaths.length,
    selectionMessage: input.selection.message,
    usageHint: 'Retry with candidatePath for an exact path, or candidateIndex as a 1-based position from candidatePaths.',
  }
}

function pluralize(count: number, singular: string, plural = singular.endsWith('y') ? `${singular.slice(0, -1)}ies` : `${singular}s`) {
  return count === 1 ? singular : plural
}

function formatBranchLabel(input: {
  branch?: string
  detached: boolean
}) {
  return input.detached ? 'detached HEAD' : input.branch ?? 'current branch'
}

function formatGitPathLabel(input: {
  path: string
  originalPath?: string
}) {
  return input.originalPath
    ? `${input.originalPath} -> ${input.path}`
    : input.path
}

function createTruncationUsageHint(commandLabel: string) {
  return `${commandLabel} output was truncated. Use the structured preview fields first, or rerun with a narrower scope / larger maxBytes if you need the full raw output.`
}

export function buildGitStatusToolSummary(result: ElectronCommandExecutionGitStatusResult) {
  const stagedCount = result.entries.filter(entry => entry.staged).length
  const unstagedCount = result.entries.filter(entry => entry.unstaged).length
  const untrackedCount = result.entries.filter(entry => entry.untracked).length
  const renamedCount = result.entries.filter(entry => entry.renamed).length
  const branchLabel = formatBranchLabel(result)

  const detailParts = [
    stagedCount > 0 ? `${stagedCount} staged` : undefined,
    unstagedCount > 0 ? `${unstagedCount} unstaged` : undefined,
    untrackedCount > 0 ? `${untrackedCount} untracked` : undefined,
    renamedCount > 0 ? `${renamedCount} renamed` : undefined,
  ].filter(Boolean)

  return {
    message: result.clean
      ? `Git status on ${branchLabel}: clean working tree.`
      : `Git status on ${branchLabel}: ${result.entries.length} changed ${pluralize(result.entries.length, 'entry')}${detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''}.`,
    changedEntryCount: result.entries.length,
    branchLabel,
    entryCounts: {
      total: result.entries.length,
      staged: stagedCount,
      unstaged: unstagedCount,
      untracked: untrackedCount,
      renamed: renamedCount,
    },
    entriesPreview: result.entries.slice(0, COMMAND_RESULT_PREVIEW_LIMIT).map(entry => ({
      ...entry,
      label: formatGitPathLabel(entry),
    })),
    usageHint: result.truncated
      ? createTruncationUsageHint('Git status')
      : undefined,
  }
}

export function buildGitDiffToolSummary(result: ElectronCommandExecutionGitDiffResult) {
  const scopeLabel = result.path ?? 'entire workspace'
  const modeLabel = result.staged ? 'staged' : 'unstaged'

  return {
    message: !result.hasChanges
      ? `Git diff for ${scopeLabel} (${modeLabel}) found no changes.`
      : result.files.length > 0
        ? `Git diff for ${scopeLabel} (${modeLabel}) changed ${result.files.length} ${pluralize(result.files.length, 'file')}.`
        : `Git diff for ${scopeLabel} (${modeLabel}) detected changes, but no structured file headers were parsed.`,
    changedFileCount: result.files.length,
    scopeLabel,
    modeLabel,
    filesPreview: result.files.slice(0, COMMAND_RESULT_PREVIEW_LIMIT).map(file => ({
      ...file,
      label: formatGitPathLabel(file),
    })),
    usageHint: result.truncated
      ? createTruncationUsageHint('Git diff')
      : result.hasChanges && result.files.length === 0
        ? 'Inspect the raw diff output because no structured file list could be parsed from the current patch headers.'
        : undefined,
  }
}

function buildDiagnosticPreviewEntries(summary: ElectronCommandExecutionDiagnosticSummary) {
  return summary.entries.slice(0, COMMAND_RESULT_PREVIEW_LIMIT).map(entry => ({
    ...entry,
    location: entry.line != null
      ? `${entry.path}:${entry.line}${entry.column != null ? `:${entry.column}` : ''}`
      : entry.path,
  }))
}

export function buildDiagnosticCommandToolSummary(input: {
  commandLabel: 'Typecheck' | 'Lint'
  result: ElectronCommandExecutionTypecheckResult | ElectronCommandExecutionLintResult
}) {
  const { commandLabel, result } = input
  const { diagnostics } = result

  return {
    message: result.passed
      ? `${commandLabel} for ${result.target} passed.`
      : diagnostics.totalIssues > 0
        ? `${commandLabel} for ${result.target} failed with ${diagnostics.totalIssues} ${pluralize(diagnostics.totalIssues, 'issue')} in ${diagnostics.fileCount} ${pluralize(diagnostics.fileCount, 'file')}.`
        : `${commandLabel} for ${result.target} failed with exit code ${result.exitCode} and no parsed diagnostics.`,
    issueCount: diagnostics.totalIssues,
    errorCount: diagnostics.errorCount,
    warningCount: diagnostics.warningCount,
    fileCount: diagnostics.fileCount,
    diagnosticFilesPreview: diagnostics.files.slice(0, COMMAND_RESULT_PREVIEW_LIMIT),
    diagnosticEntriesPreview: buildDiagnosticPreviewEntries(diagnostics),
    usageHint: result.truncated
      ? createTruncationUsageHint(commandLabel)
      : !result.passed && diagnostics.totalIssues === 0
          ? 'Inspect the raw command output because no structured diagnostics were parsed from this failure.'
          : undefined,
  }
}

async function searchAndResolveCandidatePath(input: {
  commandExecution: ReturnType<typeof useCommandExecutionStore>
  sessionId: string
  query: string
  scope?: string
  searchLimit?: number
  searchMode?: 'auto' | 'path' | 'text'
  candidatePath?: string
  candidateIndex?: number
}) {
  const searchResult = await input.commandExecution.search({
    sessionId: input.sessionId,
    query: input.query,
    scope: input.scope,
    limit: input.searchLimit,
    mode: input.searchMode,
  })

  const selection = resolveSearchCandidateSelection({
    matchedPaths: searchResult.matches.map(match => match.path),
    candidatePath: input.candidatePath,
    candidateIndex: input.candidateIndex,
  })
  const matchedPaths = selection.matchedPaths
  if (matchedPaths.length === 0) {
    throw new Error(`No files matched search query: ${input.query}`)
  }

  return {
    searchResult,
    selection,
    matchedPaths,
  }
}

const tools = [
  tool({
    name: 'workspace_list_directory',
    description: 'List file and directory names inside the current Wuwiii workspace. Use this when the user asks what files are in a folder or asks to inspect the current workspace structure before reading a specific file.',
    parameters: z.object({
      path: z.string().optional().describe('Optional workspace-relative directory path to list. Defaults to the workspace root.'),
      recursive: z.boolean().optional().describe('Whether to include nested files and subdirectories recursively.'),
      limit: z.number().int().min(1).max(1000).optional().describe('Maximum number of entries to return.'),
    }).strict(),
    execute: async ({ path, recursive, limit }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        return {
          success: true,
          ...await commandExecution.listDirectory({
            sessionId: requireActiveSessionId(),
            path,
            recursive,
            limit,
            readScope: 'computer-readonly',
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_search',
    description: 'Search files inside the current Wuwiii workspace. Use this before reading or editing when you need to locate code, config, or text.',
    parameters: z.object({
      query: z.string().min(1).describe('Text or path fragment to search for.'),
      scope: z.string().optional().describe('Optional workspace-relative directory to narrow the search, e.g. apps/stage-tamagotchi/src.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of matches to return.'),
      mode: z.enum(['auto', 'path', 'text']).optional().describe('Search mode: auto tries both path and text; path only matches file paths; text only scans file contents.'),
    }).strict(),
    execute: async ({ query, scope, limit, mode }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        return {
          success: true,
          ...await commandExecution.search({
            sessionId: requireActiveSessionId(),
            query,
            scope,
            limit,
            mode,
            readScope: 'computer-readonly',
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_read_file',
    description: 'Read a text file inside the current Wuwiii workspace. Use this after searching when you need the actual file contents.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path to read.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Optional read size cap in bytes.'),
    }).strict(),
    execute: async ({ path, maxBytes }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        return {
          success: true,
          ...await commandExecution.read({
            sessionId: requireActiveSessionId(),
            path,
            maxBytes,
            readScope: 'computer-readonly',
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_git_status',
    description: 'Inspect the current Git working tree inside the Wuwiii workspace using a fixed read-only adapter. Use this when the user asks what changed, what is uncommitted, or what files are modified. This does not run arbitrary shell input.',
    parameters: z.object({}).strict(),
    execute: async () => {
      try {
        const commandExecution = useCommandExecutionStore()
        const result = await commandExecution.gitStatus({
          sessionId: requireActiveSessionId(),
        })
        return {
          success: true,
          ...result,
          ...buildGitStatusToolSummary(result),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_git_diff',
    description: 'Inspect the current Git diff inside the Wuwiii workspace using a fixed read-only adapter. Use this when the user asks what changed in the repo or in one file. This does not run arbitrary shell input.',
    parameters: z.object({
      path: z.string().min(1).optional().describe('Optional workspace-relative path to limit the diff to one file or directory.'),
      staged: z.boolean().optional().describe('Whether to inspect the staged diff instead of the unstaged working tree diff.'),
      contextLines: z.number().int().min(0).max(20).optional().describe('How many context lines to include around each diff hunk.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Maximum diff output to capture before truncating the response.'),
    }).strict(),
    execute: async ({ path, staged, contextLines, maxBytes }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        const result = await commandExecution.gitDiff({
          sessionId: requireActiveSessionId(),
          path,
          staged,
          contextLines,
          maxBytes,
        })
        return {
          success: true,
          ...result,
          ...buildGitDiffToolSummary(result),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_typecheck',
    description: 'Run a fixed package-scoped typecheck inside the Wuwiii workspace using a restricted read-only adapter. Use this when the user asks for TypeScript or Vue type errors in a known Wuwiii package. This does not accept arbitrary package names or shell input.',
    parameters: z.object({
      target: z.enum(electronCommandExecutionTypecheckTargets).describe('Allowed Wuwiii workspace target to typecheck.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Maximum command output to capture before truncating the response.'),
    }).strict(),
    execute: async ({ target, maxBytes }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        const result = await commandExecution.typecheck({
          sessionId: requireActiveSessionId(),
          target,
          maxBytes,
        })
        return {
          success: true,
          ...result,
          ...buildDiagnosticCommandToolSummary({
            commandLabel: 'Typecheck',
            result,
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_lint',
    description: 'Run a fixed package-scoped lint command inside the Wuwiii workspace using a restricted read-only adapter. Use this when the user asks for ESLint or lint errors in a known Wuwiii package. This does not accept arbitrary package names or shell input.',
    parameters: z.object({
      target: z.enum(electronCommandExecutionLintTargets).describe('Allowed Wuwiii workspace target to lint.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Maximum command output to capture before truncating the response.'),
    }).strict(),
    execute: async ({ target, maxBytes }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        const result = await commandExecution.lint({
          sessionId: requireActiveSessionId(),
          target,
          maxBytes,
        })
        return {
          success: true,
          ...result,
          ...buildDiagnosticCommandToolSummary({
            commandLabel: 'Lint',
            result,
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_write_text',
    description: 'Write a text file inside the current Wuwiii workspace with transaction logging and rollback metadata. Supports full replacement, appending text, replacing a character range, replacing the first match, and inserting text before/after a marker after you have inspected the file.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path to update.'),
      content: z.string().describe('Text to write. In replace mode this is the full file content; in append mode this is appended; in replace-range mode this replaces the selected character range; in marker/match modes this is the inserted or replacement text.'),
      createIfMissing: z.boolean().optional().describe('Whether a missing file may be created.'),
      expectedSha256: z.string().optional().describe('Optional SHA-256 guard for optimistic concurrency.'),
      mode: writeTextModeSchema.optional().describe('Edit strategy. Defaults to replace.'),
      range: writeTextRangeSchema.optional().describe('Character offsets used only when mode is replace-range.'),
      target: z.string().min(1).optional().describe('Marker or match text used only by replace-first-match / replace-all-matches / replace-nth-match / insert-before-marker / insert-after-marker.'),
      occurrence: z.number().int().min(1).optional().describe('1-based match occurrence used only by replace-nth-match.'),
    }).strict(),
    execute: async ({ path, content, createIfMissing, expectedSha256, mode, range, target, occurrence }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        return {
          success: true,
          ...await commandExecution.writeText({
            sessionId: requireActiveSessionId(),
            path,
            content,
            createIfMissing,
            expectedSha256,
            mode,
            range,
            target,
            occurrence,
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_apply_text_edit',
    description: 'Apply a previously previewed text edit proposal inside the current Wuwiii workspace. Only use this after workspace_preview_text_edit or workspace_search_and_preview_text_edit returned a proposalId. Do not invent or alter the proposalId.',
    parameters: z.object({
      proposalId: z.string().min(1).describe('Proposal id returned by workspace_preview_text_edit or workspace_search_and_preview_text_edit.'),
    }).strict(),
    execute: async ({ proposalId }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        return {
          success: true,
          ...await commandExecution.applyTextEditProposal({
            sessionId: requireActiveSessionId(),
            proposalId,
          }),
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_preview_text_edit',
    description: 'Preview one guarded text edit inside the current Wuwiii workspace without writing to disk. Returns capped before/after previews, change summary metadata, a unified diff preview, and a proposalId that can later be applied by workspace_apply_text_edit after confirmation.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path to preview.'),
      content: z.string().describe('Text payload for the edit mode.'),
      createIfMissing: z.boolean().optional().describe('Whether a missing file may be treated as an empty file preview.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Optional read cap before previewing. If the file exceeds this cap the tool refuses to preview to avoid using truncated content.'),
      previewChars: z.number().int().min(1).max(20_000).optional().describe('Maximum number of characters to include in before/after previews.'),
      mode: writeTextModeSchema.optional().describe('Edit strategy. Defaults to replace.'),
      range: writeTextRangeSchema.optional().describe('Character offsets used only when mode is replace-range.'),
      target: z.string().min(1).optional().describe('Marker or match text used only by replace-first-match / replace-all-matches / replace-nth-match / insert-before-marker / insert-after-marker.'),
      occurrence: z.number().int().min(1).optional().describe('1-based match occurrence used only by replace-nth-match.'),
    }).strict(),
    execute: async ({ path, content, createIfMissing, maxBytes, previewChars, mode, range, target, occurrence }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        const preview = await commandExecution.previewTextEditProposal({
          sessionId: requireActiveSessionId(),
          path,
          content,
          createIfMissing,
          maxBytes,
          previewChars,
          mode,
          range,
          target,
          occurrence,
        })
        return {
          success: true,
          ...preview,
          usageHint: 'If the preview looks correct and the user confirms, call workspace_apply_text_edit with this proposalId.',
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
  tool({
    name: 'workspace_search_and_preview_text_edit',
    description: 'Search the Wuwiii workspace and then preview one guarded text edit on the selected file without writing to disk. If the preview looks correct, keep the returned proposalId and later apply it with workspace_apply_text_edit after confirmation.',
    parameters: z.object({
      query: z.string().min(1).describe('Search text used to locate the target file.'),
      scope: z.string().optional().describe('Optional workspace-relative directory to narrow the search.'),
      searchLimit: z.number().int().min(1).max(100).optional().describe('Maximum search matches to inspect before choosing a unique file path.'),
      searchMode: z.enum(['auto', 'path', 'text']).optional().describe('Search mode for locating the candidate file.'),
      candidatePath: z.string().min(1).optional().describe('Optional exact workspace-relative path to choose when the search returns multiple candidate files.'),
      candidateIndex: z.number().int().min(1).optional().describe('Optional 1-based candidate position to choose from the returned candidatePaths list when the search is ambiguous.'),
      content: z.string().describe('Text payload for the edit mode.'),
      maxBytes: z.number().int().min(1).max(1024 * 1024).optional().describe('Optional read cap before previewing. If the chosen file exceeds this cap the tool refuses to preview.'),
      previewChars: z.number().int().min(1).max(20_000).optional().describe('Maximum number of characters to include in before/after previews.'),
      mode: writeTextModeSchema.optional().describe('Edit strategy. Defaults to replace.'),
      range: writeTextRangeSchema.optional().describe('Character offsets used only when mode is replace-range.'),
      target: z.string().min(1).optional().describe('Marker or match text used only by replace-first-match / replace-all-matches / replace-nth-match / insert-before-marker / insert-after-marker.'),
      occurrence: z.number().int().min(1).optional().describe('1-based match occurrence used only by replace-nth-match.'),
    }).strict(),
    execute: async ({ query, scope, searchLimit, searchMode, candidatePath, candidateIndex, content, maxBytes, previewChars, mode, range, target, occurrence }) => {
      try {
        const commandExecution = useCommandExecutionStore()
        const sessionId = requireActiveSessionId()
        const { searchResult, selection, matchedPaths } = await searchAndResolveCandidatePath({
          commandExecution,
          sessionId,
          query,
          scope,
          searchLimit,
          searchMode,
          candidatePath,
          candidateIndex,
        })

        if (selection.status !== 'resolved') {
          return createCandidateSelectionResult({
            searchTransactionId: searchResult.transactionId,
            query,
            selection,
          })
        }

        return {
          success: true,
          searchTransactionId: searchResult.transactionId,
          matchedPath: selection.matchedPath,
          matchedPaths,
          selectedCandidateIndex: selection.selectedIndex,
          selectedBy: selection.selectedBy,
          ...await commandExecution.previewTextEditProposal({
            sessionId,
            path: selection.matchedPath,
            content,
            maxBytes,
            previewChars,
            mode,
            range,
            target,
            occurrence,
          }),
          usageHint: 'If the preview looks correct and the user confirms, call workspace_apply_text_edit with the returned proposalId.',
        }
      }
      catch (error) {
        return {
          success: false,
          error: toToolErrorMessage(error),
        }
      }
    },
  }),
]

export const commandExecutionTools = async () => Promise.all(tools)
