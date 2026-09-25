import type {
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
} from '../../shared/eventa'
import type { WorkbenchTextEditProposalView } from './workbench-file-proposals'
import type { WorkbenchTaskCard } from './workbench-task-cards'

import { describe, expect, it } from 'vitest'

import {
  getWorkbenchMemoryWorkspaceIdentity,
  getWorkbenchTaskCardWorkspaceIdentity,
  getWorkbenchTextEditProposalWorkspaceIdentity,
  getWorkbenchWorkspaceProfileIdentity,
  guardWorkbenchWorkspaceIdentity,
} from './workbench-workspace-identity'

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> = {}): ElectronWorkbenchMemoryItem {
  return {
    artifactRefs: [],
    compacted: false,
    contextUnits: 1,
    createdAt: 100,
    kind: 'plan',
    memoryId: 'task-1',
    pinned: true,
    retention: 'pin',
    sessionId: 'workbench:workspace-1',
    summary: 'Task',
    tags: ['workbench'],
    title: 'Task',
    updatedAt: 100,
    metadata: {
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    },
    ...overrides,
  }
}

function commandRun(overrides: Partial<ElectronWorkbenchCommandRunSnapshot> = {}): ElectronWorkbenchCommandRunSnapshot {
  return {
    args: ['test'],
    command: 'pnpm',
    commandText: 'pnpm test',
    cwd: 'D:/Ai/airi',
    outputTruncated: false,
    recipeId: 'test',
    recipeKind: 'test',
    recipeLabel: 'test',
    runId: 'run-1',
    sessionId: 'workbench:workspace-1',
    startedAt: 100,
    status: 'success',
    updatedAt: 200,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function taskCard(overrides: Partial<WorkbenchTaskCard> = {}): WorkbenchTaskCard {
  const rootItem = memoryItem()
  return {
    artifactRefs: [],
    commandRuns: [],
    contextUnits: rootItem.contextUnits,
    createdAt: rootItem.createdAt,
    kind: rootItem.kind,
    relatedItems: [rootItem],
    rootItem,
    summary: rootItem.summary,
    taskCardId: rootItem.memoryId,
    title: rootItem.title,
    updatedAt: rootItem.updatedAt,
    ...overrides,
  }
}

function proposalView(overrides: Partial<WorkbenchTextEditProposalView> = {}): WorkbenchTextEditProposalView {
  const item = memoryItem({
    kind: 'diff-state',
    metadata: {
      textEditProposalId: 'proposal-1',
      textEditProposalStatus: 'pending',
      textEditProposalWorkspaceId: 'workspace-1',
      textEditProposalWorkspaceRoot: 'D:/Ai/airi',
    },
  })

  return {
    contentPreview: 'new',
    createdAt: 100,
    diffPreview: '- old\n+ new',
    item,
    operation: 'write-text',
    proposalId: 'proposal-1',
    status: 'pending',
    summary: 'Prepared src/app.ts',
    targetPath: 'src/app.ts',
    workspaceId: 'workspace-1',
    workspaceRoot: 'D:/Ai/airi',
    ...overrides,
  }
}

describe('workbench workspace identity', () => {
  it('extracts workspace identity from memory, proposals, profiles, and task cards', () => {
    expect(getWorkbenchMemoryWorkspaceIdentity(memoryItem())).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    })
    expect(getWorkbenchTextEditProposalWorkspaceIdentity(proposalView())).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    })
    expect(getWorkbenchWorkspaceProfileIdentity({
      createdAt: 1,
      lastOpenedAt: 1,
      name: 'AIRI',
      notes: '',
      protectedPaths: [],
      recipes: [],
      root: 'D:/Ai/airi',
      trustState: 'trusted',
      updatedAt: 1,
      workspaceId: 'workspace-1',
    })).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    })
    expect(getWorkbenchTaskCardWorkspaceIdentity(taskCard())).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    })
  })

  it('falls back to related items and command runs for task card identity', () => {
    const rootItem = memoryItem({ metadata: {} })
    expect(getWorkbenchTaskCardWorkspaceIdentity(taskCard({
      commandRuns: [commandRun({ workspaceId: 'workspace-from-run' })],
      relatedItems: [
        rootItem,
        memoryItem({
          memoryId: 'related',
          metadata: {
            workspaceRoot: 'D:/Ai/airi',
          },
        }),
      ],
      rootItem,
    }))).toEqual({
      workspaceId: 'workspace-from-run',
      workspaceRoot: 'D:/Ai/airi',
    })
  })

  it('allows matching workspace identity and legacy records without recorded identity', () => {
    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceId: 'workspace-1', workspaceRoot: 'd:/ai/airi/' },
      recorded: { workspaceId: 'workspace-1', workspaceRoot: 'D:\\Ai\\airi' },
    })).toMatchObject({
      allowed: true,
    })

    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceId: 'workspace-1', workspaceRoot: 'D:/Ai/airi' },
      recorded: {},
    })).toMatchObject({
      allowed: true,
    })
  })

  it('blocks explicit cross-workspace identity mismatches', () => {
    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceId: 'workspace-2', workspaceRoot: 'D:/Ai/other' },
      recorded: { workspaceId: 'workspace-1', workspaceRoot: 'D:/Ai/airi' },
    })).toMatchObject({
      allowed: false,
      reason: 'workspace-id-mismatch',
    })

    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceRoot: 'D:/Ai/other' },
      recorded: { workspaceRoot: 'D:/Ai/airi' },
    })).toMatchObject({
      allowed: false,
      reason: 'workspace-root-mismatch',
    })
  })

  it('blocks recorded workspace actions when no current workspace is selected', () => {
    expect(guardWorkbenchWorkspaceIdentity({
      current: {},
      recorded: { workspaceId: 'workspace-1' },
    })).toMatchObject({
      allowed: false,
      reason: 'current-workspace-missing',
    })
  })
})
