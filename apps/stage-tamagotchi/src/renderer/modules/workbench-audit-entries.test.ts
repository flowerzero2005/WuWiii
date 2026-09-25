import type {
  WorkbenchProcessEventView,
  WorkbenchTaskProcessView,
} from './workbench-process-events'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchAuditEntries,
  getWorkbenchFocusedAuditEntryId,
} from './workbench-audit-entries'

function processEvent(overrides: Partial<WorkbenchProcessEventView>): WorkbenchProcessEventView {
  return {
    createdAt: 1,
    detailRef: {
      id: 'event-1',
      kind: 'decision',
      tab: 'summary',
      title: 'Decision',
    },
    eventId: 'runtime:event-1',
    kind: 'plan',
    source: 'runtime',
    status: 'completed',
    summary: 'Planner chose the next step.',
    taskId: 'task-1',
    title: 'Planner decision',
    updatedAt: 1,
    visibleToUser: false,
    workspaceId: 'workspace-1',
    workspaceRoot: 'D:/Ai/airi',
    ...overrides,
  }
}

function processView(events: WorkbenchProcessEventView[]): WorkbenchTaskProcessView {
  return {
    checklist: [],
    processEvents: events,
    taskId: 'task-1',
    visibleProcessEvents: events.filter(event => event.visibleToUser),
    workspace: {
      sessionId: 'workbench:workspace-1',
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    },
  }
}

describe('workbench audit entries', () => {
  it('builds audit entries from hidden and visible process events', () => {
    const entries = buildWorkbenchAuditEntries({
      processView: processView([
        processEvent({ createdAt: 1, eventId: 'runtime:decision', visibleToUser: false }),
        processEvent({
          createdAt: 2,
          detailRef: { id: 'proposal-1', kind: 'diff-state', path: 'src/app.ts', tab: 'changes', title: 'Edit preview' },
          eventId: 'memory:diff-1',
          kind: 'diff-created',
          source: 'memory',
          title: 'Edit preview',
          visibleToUser: true,
        }),
        processEvent({
          createdAt: 3,
          detailRef: { id: 'run-1', kind: 'command-output', tab: 'terminal', title: 'Test output' },
          eventId: 'memory:command-1',
          kind: 'command-output',
          risk: 'low',
          riskReasonCode: 'low-risk-local-recipe',
          source: 'memory',
          summary: 'Tests passed.',
          title: 'Test output',
          visibleToUser: true,
        }),
        processEvent({
          createdAt: 4,
          detailRef: { id: 'search-1', kind: 'tool-result', tab: 'search', title: 'Search result' },
          eventId: 'memory:search-1',
          kind: 'web-result',
          searchProviderStatus: 'not-run',
          searchQuery: 'Vue docs',
          searchSourceCount: 0,
          source: 'memory',
          title: 'Search result',
          visibleToUser: true,
        }),
        processEvent({
          createdAt: 5,
          detailRef: { id: 'error-1', kind: 'error', tab: 'audit', title: 'Guard blocked' },
          eventId: 'memory:error-1',
          kind: 'error',
          source: 'memory',
          title: 'Guard blocked',
          visibleToUser: true,
        }),
        processEvent({
          createdAt: 6,
          eventId: 'memory:note-1',
          kind: 'audit-note',
          source: 'memory',
          title: 'Internal note',
          visibleToUser: true,
        }),
      ]),
    })

    expect(entries.map(entry => [entry.auditId, entry.kind])).toEqual([
      ['audit:runtime:decision', 'planner-decision'],
      ['audit:memory:diff-1', 'file-proposal'],
      ['audit:memory:command-1', 'command'],
      ['audit:memory:search-1', 'web-search'],
      ['audit:memory:error-1', 'error'],
    ])
    expect(entries.find(entry => entry.kind === 'file-proposal')).toMatchObject({
      relatedFilePath: 'src/app.ts',
      relatedProposalId: 'proposal-1',
    })
    expect(entries.find(entry => entry.kind === 'command')?.details).toEqual(expect.arrayContaining([
      { key: 'command-run-id', value: 'run-1' },
      { key: 'risk', value: 'low' },
      { key: 'risk-reason-code', value: 'low-risk-local-recipe' },
    ]))
    expect(entries.find(entry => entry.kind === 'web-search')?.details).toEqual(expect.arrayContaining([
      { key: 'search-query', value: 'Vue docs' },
      { key: 'search-source-count', value: '0' },
      { key: 'search-provider-status', value: 'not-run' },
    ]))
  })

  it('can limit entries to user-visible events', () => {
    const entries = buildWorkbenchAuditEntries({
      includeHidden: false,
      processView: processView([
        processEvent({ eventId: 'runtime:hidden', visibleToUser: false }),
        processEvent({
          detailRef: { id: 'run-1', kind: 'command-run', tab: 'terminal' },
          eventId: 'command:run-1',
          kind: 'command-summary',
          source: 'command',
          visibleToUser: true,
        }),
      ]),
    })

    expect(entries.map(entry => entry.auditId)).toEqual(['audit:command:run-1'])
  })

  it('resolves focused audit entries from audit and source detail refs', () => {
    const entries = buildWorkbenchAuditEntries({
      processView: processView([
        processEvent({
          detailRef: { id: 'run-1', kind: 'command-output', tab: 'terminal' },
          eventId: 'memory:command-1',
          kind: 'command-output',
          source: 'memory',
          visibleToUser: true,
        }),
        processEvent({
          detailRef: { id: 'error-1', kind: 'error', tab: 'audit' },
          eventId: 'memory:error-1',
          kind: 'error',
          source: 'memory',
          visibleToUser: true,
        }),
      ]),
    })

    expect(getWorkbenchFocusedAuditEntryId({
      detailRef: { id: 'run-1', kind: 'command-output', tab: 'terminal' },
      entries,
    })).toBe('audit:memory:command-1')
    expect(getWorkbenchFocusedAuditEntryId({
      detailRef: { id: 'error-1', kind: 'error', tab: 'audit' },
      entries,
    })).toBe('audit:memory:error-1')
  })
})
