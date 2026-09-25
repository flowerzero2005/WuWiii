import type {
  ElectronWorkbenchAgentRuntimeRunSnapshot,
  ElectronWorkbenchAgentRuntimeTaskSnapshot,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
} from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchTaskChecklistItems,
  buildWorkbenchTaskProcessView,
} from './workbench-process-events'
import { buildWorkbenchTaskCards } from './workbench-task-cards'

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> & Pick<ElectronWorkbenchMemoryItem, 'memoryId' | 'kind' | 'title'>): ElectronWorkbenchMemoryItem {
  const { kind, memoryId, title, ...rest } = overrides

  return {
    artifactRefs: [],
    body: undefined,
    compacted: false,
    contextUnits: 1,
    createdAt: 1,
    kind,
    memoryId,
    metadata: {},
    pinned: false,
    retention: 'summarize',
    sessionId: 'session-1',
    summary: title,
    tags: ['workbench'],
    title,
    updatedAt: 1,
    ...rest,
  }
}

function commandRun(overrides: Partial<ElectronWorkbenchCommandRunSnapshot> & Pick<ElectronWorkbenchCommandRunSnapshot, 'runId'>): ElectronWorkbenchCommandRunSnapshot {
  const { runId, ...rest } = overrides

  return {
    args: ['run', 'test'],
    command: 'pnpm',
    commandText: 'pnpm run test',
    cwd: 'D:\\Ai\\airi',
    outputTruncated: false,
    recipeId: 'test',
    recipeKind: 'test',
    recipeLabel: 'Test',
    runId,
    sessionId: 'session-1',
    startedAt: 3,
    status: 'success',
    taskCardId: 'task-1',
    updatedAt: 4,
    workspaceId: 'workspace-1',
    ...rest,
  }
}

function taskCardFrom(items: ElectronWorkbenchMemoryItem[], commandRuns: ElectronWorkbenchCommandRunSnapshot[] = []) {
  const card = buildWorkbenchTaskCards(items, commandRuns)[0]
  if (!card)
    throw new Error('Expected a task card')

  return card
}

describe('workbench process event adapter', () => {
  it('maps runtime plan steps into checklist items with workspace identity', () => {
    const root = memoryItem({
      createdAt: 1,
      kind: 'user-goal',
      memoryId: 'task-1',
      summary: 'Build the feature',
      title: 'Build feature',
      updatedAt: 1,
    })
    const taskCard = taskCardFrom([root])
    const runtimeTask: ElectronWorkbenchAgentRuntimeTaskSnapshot = {
      createdAt: 1,
      nextAllowedActions: [],
      pendingApprovalIds: [],
      pendingProposalIds: [],
      plan: {
        createdAt: 2,
        readyToExecute: true,
        source: 'ai-planner',
        steps: [
          { status: 'completed', stepId: 'step-1', title: 'Inspect files' },
          { status: 'in-progress', stepId: 'step-2', title: 'Prepare proposal' },
          { status: 'waiting-decision', stepId: 'step-3', title: 'Review changes' },
        ],
        summary: 'Minimal plan',
      },
      status: 'generating',
      taskId: 'task-1',
      title: 'Build feature',
      updatedAt: 5,
      userGoal: 'Build the feature',
      userInputs: [],
      workspaceRoot: 'D:\\Ai\\airi',
    }

    const view = buildWorkbenchTaskProcessView({
      commandRuns: [commandRun({ runId: 'run-1' })],
      runtimeTask,
      taskCard,
    })

    expect(view.taskId).toBe('task-1')
    expect(view.workspace).toEqual({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:\\Ai\\airi',
    })
    expect(view.checklist.map(item => [item.stepId, item.status, item.detailRef.tab])).toEqual([
      ['step-1', 'completed', 'summary'],
      ['step-2', 'running', 'summary'],
      ['step-3', 'blocked-confirmation', 'summary'],
    ])
  })

  it('builds a compact fallback checklist from task status when no plan steps exist', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      summary: 'Run focused checks',
      title: 'Run checks',
      updatedAt: 2,
    })
    const taskCard = taskCardFrom([root])
    const baseTask: ElectronWorkbenchAgentRuntimeTaskSnapshot = {
      createdAt: 1,
      nextAllowedActions: [],
      pendingApprovalIds: [],
      pendingProposalIds: [],
      status: 'planning',
      taskId: 'task-1',
      title: 'Run checks',
      updatedAt: 5,
      userGoal: 'Run focused checks',
      userInputs: [],
    }

    expect(buildWorkbenchTaskChecklistItems({
      runtimeTask: baseTask,
      taskCard,
    })).toMatchObject([{
      detailRef: {
        id: 'task-1',
        kind: 'task',
        tab: 'summary',
      },
      kind: 'task',
      status: 'running',
      stepId: 'task:task-1',
      summary: 'Run focused checks',
      title: 'Run checks',
    }])

    expect(buildWorkbenchTaskChecklistItems({
      runtimeTask: {
        ...baseTask,
        status: 'waiting-approval',
      },
      taskCard,
    })[0]?.status).toBe('blocked-confirmation')

    expect(buildWorkbenchTaskChecklistItems({
      runtimeTask: {
        ...baseTask,
        status: 'failed',
      },
      taskCard,
    })[0]?.status).toBe('failed')
  })

  it('maps memory items into visible process events with right inspector refs', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      summary: 'Fix bug',
      title: 'Fix bug',
    })
    const internalUserTurn = memoryItem({
      kind: 'note',
      memoryId: 'input-1',
      metadata: { taskCardId: 'task-1' },
      tags: ['workbench', 'task-input', 'task:task-1'],
      title: 'User input',
    })
    const diff = memoryItem({
      artifactRefs: [{ kind: 'diff', path: 'src/main.ts' }],
      createdAt: 2,
      kind: 'diff-state',
      memoryId: 'diff-1',
      metadata: { taskCardId: 'task-1', textEditProposalId: 'proposal-1' },
      tags: ['workbench', 'task:task-1'],
      title: 'Edit preview',
      updatedAt: 2,
    })
    const output = memoryItem({
      artifactRefs: [{ id: 'run-1', kind: 'command' }],
      createdAt: 3,
      kind: 'command-output',
      memoryId: 'command-1',
      metadata: {
        commandRisk: 'low',
        commandRiskReasonCode: 'low-risk-local-recipe',
        taskCardId: 'task-1',
      },
      sourceRunId: 'run-1',
      tags: ['workbench', 'task:task-1'],
      title: 'Test output',
      updatedAt: 3,
    })
    const inspection = memoryItem({
      createdAt: 4,
      kind: 'tool-result',
      memoryId: 'inspection-1',
      metadata: { agentLoopStep: 'inspection', taskCardId: 'task-1' },
      tags: ['workbench', 'task:task-1'],
      title: 'Read src/main.ts',
      updatedAt: 4,
    })
    const error = memoryItem({
      createdAt: 5,
      kind: 'error',
      memoryId: 'error-1',
      metadata: { taskCardId: 'task-1' },
      tags: ['workbench', 'task:task-1'],
      title: 'Command failed',
      updatedAt: 5,
    })
    const taskCard = taskCardFrom([root, internalUserTurn, diff, output, inspection, error], [commandRun({ runId: 'run-1' })])

    const view = buildWorkbenchTaskProcessView({
      commandRuns: [commandRun({ runId: 'run-1' })],
      taskCard,
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:\\Ai\\airi',
    })

    expect(view.visibleProcessEvents.map(event => event.eventId)).toEqual([
      'memory:diff-1',
      'memory:command-1',
      'memory:inspection-1',
      'memory:error-1',
    ])
    expect(view.visibleProcessEvents.map(event => [event.kind, event.detailRef.tab])).toEqual([
      ['diff-created', 'changes'],
      ['command-output', 'terminal'],
      ['file-read', 'context'],
      ['error', 'audit'],
    ])
    expect(view.visibleProcessEvents.find(event => event.eventId === 'memory:command-1')).toMatchObject({
      risk: 'low',
      riskReasonCode: 'low-risk-local-recipe',
    })
    expect(view.visibleProcessEvents.every(event => event.workspaceId === 'workspace-1')).toBe(true)
  })

  it('keeps task conversation memory out of the process stream', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      summary: 'Fix bug',
      title: 'Fix bug',
    })
    const userTurn = memoryItem({
      body: 'Please fix the bug',
      kind: 'note',
      memoryId: 'input-1',
      metadata: {
        taskCardId: 'task-1',
        workbenchConversationRole: 'user',
        workbenchTurnId: 'turn-1',
      },
      tags: ['workbench', 'task-input', 'task:task-1'],
      title: 'User input',
    })
    const airiReply = memoryItem({
      body: 'I found the likely issue.',
      kind: 'note',
      memoryId: 'reply-1',
      metadata: {
        taskCardId: 'task-1',
        workbenchConversationRole: 'airi',
        workbenchTurnId: 'turn-1',
      },
      tags: ['workbench', 'task-reply', 'task:task-1'],
      title: 'AIRI reply',
    })
    const diff = memoryItem({
      artifactRefs: [{ kind: 'diff', path: 'src/main.ts' }],
      createdAt: 4,
      kind: 'diff-state',
      memoryId: 'diff-1',
      metadata: {
        taskCardId: 'task-1',
        textEditProposalId: 'proposal-1',
      },
      tags: ['workbench', 'task:task-1'],
      title: 'Edit preview',
      updatedAt: 4,
    })
    const taskCard = taskCardFrom([root, userTurn, airiReply, diff])

    const view = buildWorkbenchTaskProcessView({
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.visibleProcessEvents.map(event => event.eventId)).toEqual([
      'memory:diff-1',
    ])
    expect(view.processEvents.map(event => event.eventId)).not.toContain('memory:input-1')
    expect(view.processEvents.map(event => event.eventId)).not.toContain('memory:reply-1')
    expect(view.visibleProcessEvents.find(event => event.eventId === 'memory:diff-1')).toMatchObject({
      detailRef: {
        tab: 'changes',
      },
      kind: 'diff-created',
    })
  })

  it('keeps a root user goal out of visible process events', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      summary: '请创建一个文档',
      title: '请创建一个文档',
    })
    const taskCard = taskCardFrom([root])

    const view = buildWorkbenchTaskProcessView({
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.processEvents.map(event => event.eventId)).not.toContain('memory:task-1')
    expect(view.visibleProcessEvents).toEqual([])
  })

  it('keeps AIRI visible replies out of visible process events while preserving audit detail', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Ask capability',
    })
    const taskCard = taskCardFrom([root])
    const runtimeRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      decision: {
        action: 'record-only',
        confidence: 'high',
        effectiveInput: '你能不能查看工作区文件？',
        intent: 'inspect-only',
        reason: 'Capability boundary answer.',
        reasonCode: 'ai-planner-record-only',
        source: 'ai-planner',
        taskId: 'task-1',
        visibleReply: '能，我可以读取当前工作区里的文件。你要我现在看哪个目录，直接告诉我范围。',
      },
      events: [
        {
          createdAt: 2,
          eventId: 'event-1',
          kind: 'decision',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'AIRI',
        },
      ],
      input: '你能不能查看工作区文件？',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-1',
      sessionId: 'session-1',
      startedAt: 2,
      status: 'success',
      updatedAt: 3,
      workspaceRoot: 'D:\\Ai\\airi',
    }

    const view = buildWorkbenchTaskProcessView({
      runtimeRuns: [runtimeRun],
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.processEvents.find(event => event.eventId === 'runtime:event-1')).toMatchObject({
      detailRef: { tab: 'summary' },
      kind: 'plan',
      visibleToUser: false,
    })
    expect(view.visibleProcessEvents.map(event => event.eventId)).not.toContain('runtime:event-1')
  })

  it('keeps internal runtime finished handoff out of visible process events', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Create a document',
    })
    const taskCard = taskCardFrom([root])
    const runtimeRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      decision: {
        action: 'prepare-file-proposal',
        confidence: 'high',
        effectiveInput: 'Create a txt story document',
        intent: 'edit-preview',
        reason: 'The planner selected a previewable file proposal.',
        reasonCode: 'ai-planner-prepare-file-proposal',
        source: 'ai-planner',
        taskId: 'task-1',
      },
      events: [
        {
          createdAt: 2,
          eventId: 'decision-1',
          kind: 'decision',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: '准备文件修改',
        },
        {
          createdAt: 3,
          eventId: 'finished-1',
          kind: 'finished',
          runId: 'runtime-1',
          sessionId: 'session-1',
          summary: '已完成规划并交接给工作台执行链路。',
          title: '摘要',
        },
      ],
      input: 'Create a txt story document',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-1',
      sessionId: 'session-1',
      startedAt: 2,
      status: 'success',
      updatedAt: 3,
      workspaceRoot: 'D:\\Ai\\airi',
    }

    const view = buildWorkbenchTaskProcessView({
      runtimeRuns: [runtimeRun],
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.processEvents.find(event => event.eventId === 'runtime:finished-1')).toMatchObject({
      detailRef: { tab: 'summary' },
      kind: 'audit-note',
      status: 'completed',
      visibleToUser: false,
    })
    expect(view.visibleProcessEvents.map(event => event.eventId)).toContain('runtime:decision-1')
    expect(view.visibleProcessEvents.map(event => event.eventId)).not.toContain('runtime:finished-1')
  })

  it('hides runtime failure details after a later clear-error marker for the same task', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Create a document',
    })
    const taskCard = taskCardFrom([root])
    const failedRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      events: [
        {
          createdAt: 2,
          eventId: 'failed-1',
          kind: 'failed',
          runId: 'runtime-failed',
          sessionId: 'session-1',
          summary: 'Provider request failed.',
          title: '模型生成失败',
        },
        {
          createdAt: 3,
          eventId: 'recovery-1',
          kind: 'recovery',
          runId: 'runtime-failed',
          sessionId: 'session-1',
          summary: 'Retry after checking provider settings.',
          title: '恢复建议',
        },
      ],
      input: '请创建一个文档',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-failed',
      sessionId: 'session-1',
      startedAt: 1,
      status: 'failed',
      updatedAt: 3,
      workspaceRoot: 'D:\\Ai\\airi',
    }
    const clearRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      events: [
        {
          createdAt: 4,
          eventId: 'clear-1',
          kind: 'next-step',
          metadata: {
            clearedErrorState: true,
            taskCardId: 'task-1',
          },
          runId: 'runtime-clear',
          sessionId: 'session-1',
          summary: 'AIRI is idle.',
          title: 'Clear errors and refresh status',
        },
      ],
      input: 'Clear errors and refresh status',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-clear',
      sessionId: 'session-1',
      startedAt: 4,
      status: 'success',
      updatedAt: 4,
      workspaceRoot: 'D:\\Ai\\airi',
    }

    const view = buildWorkbenchTaskProcessView({
      runtimeRuns: [failedRun, clearRun],
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.visibleProcessEvents.map(event => event.eventId)).toEqual(['runtime:clear-1'])
    expect(view.processEvents.map(event => event.title)).not.toContain('模型生成失败')
    expect(view.processEvents.map(event => event.title)).not.toContain('恢复建议')
  })

  it('adds command run summaries when no command-output memory item represents the run', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Run tests',
    })
    const run = commandRun({
      runId: 'run-1',
      stdoutSummary: 'All tests passed',
      updatedAt: 7,
    })
    const taskCard = taskCardFrom([root], [run])

    const view = buildWorkbenchTaskProcessView({
      commandRuns: [run],
      taskCard,
      workspaceRoot: 'D:\\Ai\\airi',
    })

    expect(view.visibleProcessEvents.map(event => [event.eventId, event.kind, event.detailRef.tab, event.summary])).toContainEqual([
      'command:run-1',
      'command-summary',
      'terminal',
      'All tests passed',
    ])
    expect(view.visibleProcessEvents.find(event => event.eventId === 'command:run-1')).toMatchObject({
      risk: 'normal',
      riskReasonCode: 'normal-risk-local-command',
    })
  })

  it('maps web search memory and runtime events to the Search detail ref', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Look up package docs',
    })
    const query = memoryItem({
      artifactRefs: [{
        id: 'search-1',
        kind: 'web-source',
        label: 'Vue 3 latest docs',
        metadata: {
          searchProviderStatus: 'not-run',
          searchQuery: 'Vue 3 latest docs',
          searchSourceCount: 0,
        },
      }],
      createdAt: 2,
      kind: 'note',
      memoryId: 'search-query-1',
      metadata: {
        agentLoopStep: 'web-search-query',
        searchProviderStatus: 'not-run',
        searchQuery: 'Vue 3 latest docs',
        searchSourceCount: 0,
        taskCardId: 'task-1',
      },
      tags: ['workbench', 'task:task-1'],
      title: 'Search requested',
      updatedAt: 2,
    })
    const result = memoryItem({
      artifactRefs: [{
        id: 'search-1',
        kind: 'web-source',
        label: 'Vue 3 latest docs',
      }],
      createdAt: 3,
      kind: 'tool-result',
      memoryId: 'search-result-1',
      metadata: {
        agentLoopStep: 'web-search-result',
        searchProviderStatus: 'not-run',
        searchQuery: 'Vue 3 latest docs',
        searchSourceCount: 0,
        taskCardId: 'task-1',
      },
      tags: ['workbench', 'task:task-1'],
      title: 'Search result summary',
      updatedAt: 3,
    })
    const runtimeRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      events: [
        {
          createdAt: 4,
          eventId: 'event-1',
          kind: 'next-step',
          metadata: {
            agentLoopStep: 'web-search-start',
            searchProviderStatus: 'not-run',
            searchQuery: 'Vue 3 latest docs',
            searchSourceCount: 0,
          },
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Search requested',
        },
      ],
      input: 'Look up package docs',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-1',
      sessionId: 'session-1',
      startedAt: 4,
      status: 'success',
      updatedAt: 5,
    }
    const taskCard = taskCardFrom([root, query, result])

    const view = buildWorkbenchTaskProcessView({
      runtimeRuns: [runtimeRun],
      taskCard,
      workspaceId: 'workspace-1',
    })

    expect(view.visibleProcessEvents.map(event => [event.eventId, event.kind, event.detailRef.tab])).toEqual([
      ['memory:search-query-1', 'web-search', 'search'],
      ['memory:search-result-1', 'web-result', 'search'],
      ['runtime:event-1', 'web-search', 'search'],
    ])
    expect(view.visibleProcessEvents.find(event => event.eventId === 'memory:search-query-1')).toMatchObject({
      searchProviderStatus: 'not-run',
      searchQuery: 'Vue 3 latest docs',
      searchSourceCount: 0,
    })
  })

  it('routes runtime process events to stable inspector detail refs', () => {
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      title: 'Implement workbench flow',
    })
    const taskCard = taskCardFrom([root])
    const runtimeRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      events: [
        {
          createdAt: 2,
          eventId: 'decision-1',
          kind: 'decision',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Plan selected',
        },
        {
          createdAt: 3,
          eventId: 'inspection-1',
          kind: 'workspace-inspection',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Read workspace context',
        },
        {
          createdAt: 4,
          eventId: 'proposal-1',
          kind: 'file-proposal-created',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Prepared file proposal',
        },
        {
          createdAt: 5,
          eventId: 'diff-1',
          kind: 'file-proposal-preview-created',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Previewed file proposal',
        },
        {
          createdAt: 6,
          eventId: 'approval-1',
          kind: 'approval-required',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Approval required',
        },
        {
          createdAt: 7,
          eventId: 'applied-1',
          kind: 'approval-applied',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Applied proposal',
        },
        {
          createdAt: 8,
          eventId: 'command-started-1',
          kind: 'command-started',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Started command',
        },
        {
          createdAt: 9,
          eventId: 'command-finished-1',
          kind: 'command-finished',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Finished command',
        },
        {
          createdAt: 10,
          eventId: 'search-result-1',
          kind: 'next-step',
          metadata: {
            agentLoopStep: 'web-search-result',
            searchProviderStatus: 'not-run',
            searchQuery: 'Vue 3 docs',
            searchSourceCount: 0,
          },
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Search result summary',
        },
        {
          createdAt: 11,
          eventId: 'recovery-1',
          kind: 'recovery',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Recovered from issue',
        },
        {
          createdAt: 12,
          eventId: 'command-failed-1',
          kind: 'command-failed',
          runId: 'runtime-1',
          sessionId: 'session-1',
          title: 'Command failed',
        },
      ],
      input: 'Implement workbench flow',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-1',
      sessionId: 'session-1',
      startedAt: 2,
      status: 'success',
      updatedAt: 13,
      workspaceRoot: 'D:\\Ai\\airi',
    }

    const view = buildWorkbenchTaskProcessView({
      runtimeRuns: [runtimeRun],
      taskCard,
      workspaceId: 'workspace-1',
    })
    const runtimeEvents = view.processEvents.filter(event => event.source === 'runtime')

    expect(runtimeEvents.map(event => [event.eventId, event.kind, event.detailRef.tab, event.status])).toEqual([
      ['runtime:decision-1', 'plan', 'summary', 'completed'],
      ['runtime:inspection-1', 'file-read', 'context', 'completed'],
      ['runtime:proposal-1', 'file-preview', 'changes', 'completed'],
      ['runtime:diff-1', 'diff-created', 'changes', 'completed'],
      ['runtime:approval-1', 'confirmation-request', 'changes', 'blocked-confirmation'],
      ['runtime:applied-1', 'proposal-applied', 'changes', 'completed'],
      ['runtime:command-started-1', 'command-started', 'terminal', 'completed'],
      ['runtime:command-finished-1', 'command-summary', 'terminal', 'completed'],
      ['runtime:search-result-1', 'web-result', 'search', 'completed'],
      ['runtime:recovery-1', 'recovery', 'audit', 'completed'],
      ['runtime:command-failed-1', 'error', 'audit', 'failed'],
    ])
    expect(runtimeEvents.find(event => event.eventId === 'runtime:search-result-1')).toMatchObject({
      searchProviderStatus: 'not-run',
      searchQuery: 'Vue 3 docs',
      searchSourceCount: 0,
    })
    expect(view.visibleProcessEvents.filter(event => event.source === 'runtime')).toHaveLength(runtimeEvents.length)
  })
})
