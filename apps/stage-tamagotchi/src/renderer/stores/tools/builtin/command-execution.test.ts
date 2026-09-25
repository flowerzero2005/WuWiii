import { describe, expect, it } from 'vitest'

import {
  buildDiagnosticCommandToolSummary,
  buildGitDiffToolSummary,
  buildGitStatusToolSummary,
  commandExecutionTools,
} from './command-execution'

describe('command execution tools', () => {
  it('keeps the proposal-based edit tool surface without the legacy apply alias', async () => {
    const tools = await commandExecutionTools()
    const toolNames = tools.map(tool => tool.function.name)

    expect(toolNames).toContain('workspace_list_directory')
    expect(toolNames).toContain('workspace_search')
    expect(toolNames).toContain('workspace_read_file')
    expect(toolNames).toContain('workspace_git_status')
    expect(toolNames).toContain('workspace_git_diff')
    expect(toolNames).toContain('workspace_typecheck')
    expect(toolNames).toContain('workspace_lint')
    expect(toolNames).toContain('workspace_preview_text_edit')
    expect(toolNames).toContain('workspace_search_and_preview_text_edit')
    expect(toolNames).toContain('workspace_apply_text_edit')
    expect(toolNames).not.toContain('workspace_search_and_apply_text_edit')
  })

  it('builds a compact git status summary for tool consumers', () => {
    const summary = buildGitStatusToolSummary({
      transactionId: 'tx-git-status',
      workspaceRoot: 'D:/Ai/airi',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      detached: false,
      clean: false,
      output: 'mock output',
      byteLength: 11,
      truncated: false,
      entries: [
        {
          path: 'apps/stage-tamagotchi/src/main.ts',
          indexStatus: 'M',
          workTreeStatus: ' ',
          staged: true,
          unstaged: false,
          untracked: false,
          renamed: false,
          originalPath: undefined,
        },
        {
          path: 'docs/new-note.md',
          indexStatus: '?',
          workTreeStatus: '?',
          staged: false,
          unstaged: false,
          untracked: true,
          renamed: false,
          originalPath: undefined,
        },
      ],
    })

    expect(summary.message).toBe('Git status on main: 2 changed entries (1 staged, 1 untracked).')
    expect(summary.changedEntryCount).toBe(2)
    expect(summary.entryCounts).toEqual({
      total: 2,
      staged: 1,
      unstaged: 0,
      untracked: 1,
      renamed: 0,
    })
    expect(summary.entriesPreview[0]?.label).toBe('apps/stage-tamagotchi/src/main.ts')
    expect(summary.usageHint).toBeUndefined()
  })

  it('builds a git diff summary with preview files and truncation guidance', () => {
    const summary = buildGitDiffToolSummary({
      transactionId: 'tx-git-diff',
      workspaceRoot: 'D:/Ai/airi',
      path: undefined,
      staged: false,
      contextLines: 3,
      output: 'mock diff',
      byteLength: 9,
      truncated: true,
      hasChanges: true,
      files: [
        {
          path: 'apps/stage-tamagotchi/src/new.ts',
          originalPath: 'apps/stage-tamagotchi/src/old.ts',
          added: false,
          deleted: false,
          renamed: true,
        },
      ],
    })

    expect(summary.message).toBe('Git diff for entire workspace (unstaged) changed 1 file.')
    expect(summary.changedFileCount).toBe(1)
    expect(summary.filesPreview[0]?.label).toBe('apps/stage-tamagotchi/src/old.ts -> apps/stage-tamagotchi/src/new.ts')
    expect(summary.usageHint).toContain('Git diff output was truncated')
  })

  it('builds a diagnostic command summary with preview entries and fallback guidance', () => {
    const summary = buildDiagnosticCommandToolSummary({
      commandLabel: 'Typecheck',
      result: {
        transactionId: 'tx-typecheck',
        workspaceRoot: 'D:/Ai/airi',
        target: 'stage-tamagotchi',
        packageName: '@proj-airi/stage-tamagotchi',
        command: 'pnpm.cmd -F @proj-airi/stage-tamagotchi run typecheck',
        exitCode: 1,
        passed: false,
        output: 'mock typecheck output',
        byteLength: 20,
        truncated: false,
        diagnostics: {
          totalIssues: 2,
          errorCount: 2,
          warningCount: 0,
          fileCount: 1,
          files: [
            {
              path: 'apps/stage-tamagotchi/src/main.ts',
              issueCount: 2,
              errorCount: 2,
              warningCount: 0,
            },
          ],
          entries: [
            {
              path: 'apps/stage-tamagotchi/src/main.ts',
              line: 12,
              column: 5,
              severity: 'error',
              code: 'TS2322',
              message: 'Type "number" is not assignable to type "string".',
            },
          ],
        },
      },
    })

    expect(summary.message).toBe('Typecheck for stage-tamagotchi failed with 2 issues in 1 file.')
    expect(summary.issueCount).toBe(2)
    expect(summary.fileCount).toBe(1)
    expect(summary.diagnosticEntriesPreview[0]?.location).toBe('apps/stage-tamagotchi/src/main.ts:12:5')
    expect(summary.usageHint).toBeUndefined()
  })
})
