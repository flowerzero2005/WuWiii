import type {
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchProjectPreviewSnapshot,
} from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import { buildWorkbenchTerminalOutputEntries } from './workbench-terminal-output'

function commandRun(overrides: Partial<ElectronWorkbenchCommandRunSnapshot> = {}): ElectronWorkbenchCommandRunSnapshot {
  return {
    args: ['run', 'test'],
    command: 'pnpm',
    commandText: 'pnpm run test',
    cwd: 'D:/Ai/airi',
    outputTruncated: false,
    recipeId: 'recipe-test',
    recipeKind: 'test',
    recipeLabel: 'test',
    runId: 'run-1',
    sessionId: 'session-1',
    startedAt: 1,
    status: 'success',
    updatedAt: 2,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function projectPreview(overrides: Partial<ElectronWorkbenchProjectPreviewSnapshot> = {}): ElectronWorkbenchProjectPreviewSnapshot {
  return {
    args: ['run', 'dev'],
    command: 'pnpm',
    commandText: 'pnpm run dev',
    cwd: 'D:/Ai/airi',
    outputTruncated: false,
    previewId: 'preview-1',
    recipeId: 'recipe-dev',
    recipeKind: 'dev',
    recipeLabel: 'dev',
    sessionId: 'session-1',
    startedAt: 3,
    status: 'running',
    updatedAt: 4,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> = {}): ElectronWorkbenchMemoryItem {
  return {
    artifactRefs: [],
    compacted: false,
    contextUnits: 1,
    createdAt: 1,
    kind: 'command-output',
    memoryId: 'memory-1',
    pinned: false,
    retention: 'summarize',
    sessionId: 'session-1',
    summary: '2 tests passed',
    tags: ['workbench'],
    title: 'test output',
    updatedAt: 2,
    ...overrides,
  }
}

describe('workbench terminal output entries', () => {
  it('keeps command raw output folded in terminal entries', () => {
    expect(buildWorkbenchTerminalOutputEntries({
      commandRuns: [commandRun({
        outputPreview: 'full test log',
        outputTruncated: true,
        stdoutSummary: '2 tests passed',
      })],
    })).toMatchObject([{
      commandText: 'pnpm run test',
      id: 'command:run-1',
      kind: 'command-run',
      output: {
        collapsed: true,
        hasRawOutput: true,
        outputPreview: 'full test log',
        summary: '2 tests passed',
        terminalTab: 'terminal',
        truncated: true,
      },
      status: 'success',
      targetId: 'run-1',
    }])
  })

  it('builds terminal entries from command-output memory when the run snapshot is absent', () => {
    expect(buildWorkbenchTerminalOutputEntries({
      memoryItems: [memoryItem({
        artifactRefs: [{ id: 'run-1', kind: 'command' }],
        body: 'captured raw output',
        metadata: {
          commandText: 'pnpm run test',
          commandStatus: 'failed',
          stderrSummary: 'Type error',
        },
      })],
    })).toMatchObject([{
      commandText: 'pnpm run test',
      id: 'command:run-1',
      kind: 'command-memory',
      output: {
        collapsed: true,
        emphasis: 'error',
        hasRawOutput: true,
        outputPreview: 'captured raw output',
        summary: 'Type error',
      },
      status: 'failed',
      targetId: 'run-1',
    }])
  })

  it('deduplicates memory output when a command run with the same target exists', () => {
    const entries = buildWorkbenchTerminalOutputEntries({
      commandRuns: [commandRun({
        outputPreview: 'run output',
        updatedAt: 5,
      })],
      memoryItems: [memoryItem({
        artifactRefs: [{ id: 'run-1', kind: 'command' }],
        body: 'memory output',
        updatedAt: 4,
      })],
      projectPreviews: [projectPreview({
        outputPreview: 'dev server output',
        updatedAt: 6,
      })],
    })

    expect(entries.map(entry => [entry.id, entry.kind, entry.output.outputPreview])).toEqual([
      ['project-preview:preview-1', 'project-preview', 'dev server output'],
      ['command:run-1', 'command-run', 'run output'],
    ])
  })

  it('keeps summaries separate from raw output previews', () => {
    const entries = buildWorkbenchTerminalOutputEntries({
      commandRuns: [commandRun({
        outputPreview: 'raw run log line 1\nraw run log line 2',
        stdoutSummary: 'Run summary wins',
        updatedAt: 5,
      })],
      memoryItems: [memoryItem({
        artifactRefs: [{ id: 'run-2', kind: 'command' }],
        body: 'raw memory log line 1\nraw memory log line 2',
        memoryId: 'memory-2',
        metadata: {
          commandText: 'pnpm exec vitest run focused.test.ts',
          stdoutSummary: 'metadata summary fallback',
        },
        summary: 'Memory summary wins',
        updatedAt: 6,
      })],
    })

    expect(entries.find(entry => entry.id === 'command:run-1')?.output).toMatchObject({
      outputPreview: 'raw run log line 1\nraw run log line 2',
      summary: 'Run summary wins',
    })
    expect(entries.find(entry => entry.id === 'command:run-2')?.output).toMatchObject({
      outputPreview: 'raw memory log line 1\nraw memory log line 2',
      summary: 'Memory summary wins',
    })
  })
})
