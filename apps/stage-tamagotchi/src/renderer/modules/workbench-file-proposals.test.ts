import type { ElectronWorkbenchMemoryItem } from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchTextEditProposalView,
  canApplyWorkbenchTextEditProposal,
  findDirtyWorkbenchProposalPath,
  getWorkbenchTextEditProposalStatus,
  isWorkbenchTextEditProposalConflictError,
  isWorkbenchTextEditProposalTerminal,
} from './workbench-file-proposals'

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> = {}): ElectronWorkbenchMemoryItem {
  return {
    artifactRefs: [],
    compacted: false,
    contextUnits: 1,
    createdAt: 100,
    kind: 'diff-state',
    memoryId: 'memory-1',
    pinned: true,
    retention: 'pin',
    sessionId: 'session-1',
    summary: 'Prepared src/app.ts',
    tags: ['workbench'],
    title: 'Prepare src/app.ts',
    updatedAt: 100,
    metadata: {
      path: 'src/app.ts',
      taskCardId: 'task-1',
      textEditProposalBaseHash: 'base-hash',
      textEditProposalChanged: true,
      textEditProposalCreatedAt: 100,
      textEditProposalDiffPreview: '- old\n+ new',
      textEditProposalExpiresAt: 1_000,
      textEditProposalId: 'proposal-1',
      textEditProposalMode: 'replace',
      textEditProposalPreview: 'new',
      textEditProposalStatus: 'pending',
      textEditProposalTaskId: 'task-1',
      textEditProposalTargetPath: 'src/app.ts',
      textEditProposalWorkspaceId: 'workspace-1',
      textEditProposalWorkspaceRoot: 'D:/workspace',
    },
    ...overrides,
  }
}

describe('workbench file proposals', () => {
  it('normalizes proposal metadata into a view model', () => {
    const view = buildWorkbenchTextEditProposalView({
      item: memoryItem(),
      nowMs: 200,
    })

    expect(view).toMatchObject({
      baseHash: 'base-hash',
      contentPreview: 'new',
      diffPreview: '- old\n+ new',
      mode: 'replace',
      proposalId: 'proposal-1',
      status: 'pending',
      targetPath: 'src/app.ts',
      taskCardId: 'task-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/workspace',
    })
    expect(canApplyWorkbenchTextEditProposal(view)).toBe(true)
  })

  it('resolves applied and discarded terminal states from related records', () => {
    const proposal = memoryItem()

    expect(getWorkbenchTextEditProposalStatus({
      item: proposal,
      relatedItems: [
        memoryItem({
          kind: 'file-summary',
          memoryId: 'applied',
          metadata: {
            textEditProposalApplied: true,
            textEditProposalId: 'proposal-1',
          },
        }),
      ],
    })).toBe('applied')

    expect(isWorkbenchTextEditProposalTerminal('applied')).toBe(true)
    expect(isWorkbenchTextEditProposalTerminal('conflict')).toBe(false)
  })

  it('marks conflicts from related error records', () => {
    const view = buildWorkbenchTextEditProposalView({
      item: memoryItem(),
      relatedItems: [
        memoryItem({
          kind: 'error',
          memoryId: 'conflict',
          summary: 'The file changed after the proposal was created.',
          metadata: {
            textEditProposalConflict: true,
            textEditProposalId: 'proposal-1',
          },
        }),
      ],
    })

    expect(view?.status).toBe('conflict')
    expect(view?.conflictReason).toBe('The file changed after the proposal was created.')
    expect(canApplyWorkbenchTextEditProposal(view)).toBe(false)
  })

  it('marks expired proposals as stale', () => {
    expect(getWorkbenchTextEditProposalStatus({
      item: memoryItem(),
      nowMs: 1_001,
    })).toBe('stale')
  })

  it('detects sha256 mismatch conflict errors', () => {
    expect(isWorkbenchTextEditProposalConflictError('Expected SHA-256 mismatch for src/app.ts')).toBe(true)
    expect(isWorkbenchTextEditProposalConflictError('Network failed')).toBe(false)
  })

  it('finds dirty editor paths that overlap pending proposals', () => {
    expect(findDirtyWorkbenchProposalPath({
      dirtyFilePaths: ['src/app.ts'],
      proposals: [
        buildWorkbenchTextEditProposalView({ item: memoryItem() }),
      ],
    })).toBe('src/app.ts')
  })
})
