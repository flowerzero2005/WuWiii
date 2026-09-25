import type {
  ElectronWorkbenchAgentRuntimeRunSnapshot,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchWorkspaceRecipe,
} from '../../shared/eventa'

import {
  buildWorkbenchScenePromptSection,
  getWorkbenchWorkStylePreset,
} from '@proj-airi/stage-ui/stores/settings/workbench'
import { detectStageChatToolIntent } from '@proj-airi/stage-ui/tools/chat-tool-bundles'
import { describe, expect, it } from 'vitest'

import {
  classifyWorkbenchPlannerActionRisk,
  isWorkbenchRuntimeExecutionLikeAction,
  normalizeWorkbenchPlannerSemanticSlots,
  normalizeWorkbenchRuntimePlannerAction,
} from '../../shared/workbench-planner-policy'
import { buildWorkbenchAuditEntries, getWorkbenchFocusedAuditEntryId } from './workbench-audit-entries'
import {
  buildWorkbenchCommandOutputDisplayState,
  buildWorkbenchCommandTextPolicy,
  buildWorkbenchRecipeCommandPolicy,
} from './workbench-command-policy'
import {
  buildWorkbenchTextEditProposalView,
  canApplyWorkbenchTextEditProposal,
  findDirtyWorkbenchProposalPath,
  isWorkbenchTextEditProposalConflictError,
} from './workbench-file-proposals'
import {
  getWorkbenchMvp1EvaluationCoverage,
  WORKBENCH_MVP1_EVALUATION_CATEGORIES,
  WORKBENCH_MVP1_EVALUATION_SCENARIOS,
} from './workbench-mvp1-evaluation'
import { buildWorkbenchTaskProcessView } from './workbench-process-events'
import { buildWorkbenchTaskCards } from './workbench-task-cards'
import { guardWorkbenchWorkspaceIdentity } from './workbench-workspace-identity'

function recipe(overrides: Partial<ElectronWorkbenchWorkspaceRecipe> = {}): ElectronWorkbenchWorkspaceRecipe {
  const now = 1_718_000_000_000
  return {
    args: ['run', 'typecheck'],
    command: 'pnpm',
    createdAt: now,
    enabled: true,
    kind: 'typecheck',
    label: 'typecheck',
    recipeId: 'recipe-typecheck',
    riskLevel: 'low',
    updatedAt: now,
    ...overrides,
  }
}

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> & Pick<ElectronWorkbenchMemoryItem, 'kind' | 'memoryId' | 'title'>): ElectronWorkbenchMemoryItem {
  const { kind, memoryId, title, ...rest } = overrides

  return {
    artifactRefs: [],
    compacted: false,
    contextUnits: 1,
    createdAt: 100,
    kind,
    memoryId,
    metadata: {},
    pinned: false,
    retention: 'summarize',
    sessionId: 'session-1',
    summary: title,
    tags: ['workbench'],
    title,
    updatedAt: 100,
    ...rest,
  }
}

function commandRun(overrides: Partial<ElectronWorkbenchCommandRunSnapshot> = {}): ElectronWorkbenchCommandRunSnapshot {
  return {
    args: ['run', 'test'],
    command: 'pnpm',
    commandText: 'pnpm run test',
    cwd: 'D:/Ai/airi',
    outputTruncated: false,
    recipeId: 'test',
    recipeKind: 'test',
    recipeLabel: 'Test',
    runId: 'run-1',
    sessionId: 'session-1',
    startedAt: 120,
    status: 'success',
    taskCardId: 'task-1',
    updatedAt: 140,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function taskCardFrom(items: ElectronWorkbenchMemoryItem[], commandRuns: ElectronWorkbenchCommandRunSnapshot[] = []) {
  const card = buildWorkbenchTaskCards(items, commandRuns)[0]
  if (!card)
    throw new Error('Expected a task card')

  return card
}

function proposalMemory(overrides: Partial<ElectronWorkbenchMemoryItem> = {}) {
  return memoryItem({
    kind: 'diff-state',
    memoryId: 'proposal-memory',
    metadata: {
      taskCardId: 'task-1',
      textEditProposalBaseHash: 'base-hash',
      textEditProposalCreatedAt: 100,
      textEditProposalDiffPreview: '- old\n+ new',
      textEditProposalExpiresAt: 1_000,
      textEditProposalId: 'proposal-1',
      textEditProposalPreview: 'new',
      textEditProposalStatus: 'pending',
      textEditProposalTargetPath: 'src/app.ts',
      textEditProposalWorkspaceId: 'workspace-1',
      textEditProposalWorkspaceRoot: 'D:/Ai/airi',
    },
    summary: 'Prepared src/app.ts',
    title: 'Prepare src/app.ts',
    ...overrides,
  })
}

describe('workbench MVP-1 evaluation matrix', () => {
  it('tracks every MVP-1 evaluation category with automated coverage', () => {
    const scenarioIds = WORKBENCH_MVP1_EVALUATION_SCENARIOS.map(scenario => scenario.id)
    const coverage = getWorkbenchMvp1EvaluationCoverage()

    expect(new Set(scenarioIds).size).toBe(scenarioIds.length)
    expect(coverage.map(item => item.category)).toEqual(WORKBENCH_MVP1_EVALUATION_CATEGORIES)
    expect(WORKBENCH_MVP1_EVALUATION_SCENARIOS.every(scenario => scenario.coveredBy.length > 0)).toBe(true)

    for (const item of coverage)
      expect(item.automated, item.category).toBeGreaterThan(0)

    expect(coverage.find(item => item.category === 'file-flow')).toMatchObject({
      automated: 2,
      manual: 1,
    })
    expect(coverage.find(item => item.category === 'persona')).toMatchObject({
      automated: 1,
      manual: 1,
    })
  })
})

describe('workbench MVP-1 routing regressions', () => {
  it('uses local intent only to gate model tool routing', () => {
    const neutralIntent = {
      isWorkspaceCapabilityQuestion: false,
      requiresWebSearch: false,
      wantsMcpDiscovery: false,
      wantsMcpExplicitAction: false,
      wantsMemory: false,
      wantsProactiveTopicOpening: false,
      wantsWebSearch: false,
      wantsWidgets: false,
      wantsWorkspaceApply: false,
      wantsWorkspaceEdit: false,
      wantsWorkspaceRead: false,
    }
    expect(detectStageChatToolIntent('write a short story')).toEqual(neutralIntent)
    expect(detectStageChatToolIntent('\u4F60\u80FD\u4E0D\u80FD\u67E5\u770B\u5DE5\u4F5C\u533A\u6587\u4EF6\uFF1F')).toMatchObject({
      isWorkspaceCapabilityQuestion: true,
      wantsWorkspaceRead: false,
    })
    expect(detectStageChatToolIntent('\u786E\u8BA4', {
      hasPendingWorkspaceEditProposal: true,
    })).toMatchObject({
      wantsWorkspaceApply: true,
      wantsWorkspaceEdit: true,
      wantsWorkspaceRead: true,
    })
    expect(detectStageChatToolIntent('write a short story and save it as story.md')).toMatchObject({
      wantsWorkspaceEdit: true,
      wantsWorkspaceRead: true,
    })
  })
})

describe('workbench MVP-1 autonomy regressions', () => {
  it('allows ordinary local checks while keeping high-risk and unsupported execution guarded', () => {
    expect(buildWorkbenchRecipeCommandPolicy({
      recipe: recipe(),
      workspaceRoot: 'D:/Ai/airi',
    })).toMatchObject({
      canStart: true,
      disposition: 'allow-autonomous',
      reasonCode: 'low-risk-local-recipe',
      risk: 'low',
    })

    expect(buildWorkbenchRecipeCommandPolicy({
      mode: 'project-preview',
      recipe: recipe({
        args: ['run', 'dev'],
        kind: 'dev',
        label: 'dev',
        riskLevel: 'medium',
      }),
      workspaceRoot: 'D:/Ai/airi',
    })).toMatchObject({
      canStart: true,
      reasonCode: 'normal-risk-project-preview',
      risk: 'normal',
    })

    expect(buildWorkbenchCommandTextPolicy('pnpm install')).toMatchObject({
      canStart: false,
      disposition: 'needs-confirmation',
      reasonCode: 'high-risk-command-text',
      risk: 'high',
    })

    expect(buildWorkbenchCommandOutputDisplayState({
      outputPreview: 'raw output',
      stdoutSummary: '2 tests passed',
    })).toMatchObject({
      collapsed: true,
      hasRawOutput: true,
      summary: '2 tests passed',
      terminalTab: 'terminal',
    })
  })

  it('keeps planner fallback conservative for future direct execution actions', () => {
    const applySlots = normalizeWorkbenchPlannerSemanticSlots({
      action: 'apply-existing-proposal',
      confirmation: 'none',
      risk: 'normal',
    })

    expect(classifyWorkbenchPlannerActionRisk(applySlots, { hasWorkspace: true })).toMatchObject({
      disposition: 'needs-confirmation',
      reasonCode: 'explicit-apply-required',
      risk: 'high',
    })
    expect(normalizeWorkbenchRuntimePlannerAction('run-command')).toBeUndefined()
    expect(normalizeWorkbenchRuntimePlannerAction('web-search')).toBeUndefined()
    expect(isWorkbenchRuntimeExecutionLikeAction('prepare-file-proposal')).toBe(true)
    expect(isWorkbenchRuntimeExecutionLikeAction('ask-for-specific-next-step')).toBe(false)
  })
})

describe('workbench MVP-1 file-flow regressions', () => {
  it('keeps proposals preview-first and protects dirty or changed files', () => {
    const proposal = buildWorkbenchTextEditProposalView({
      item: proposalMemory(),
      nowMs: 200,
    })

    expect(proposal).toMatchObject({
      proposalId: 'proposal-1',
      status: 'pending',
      targetPath: 'src/app.ts',
      workspaceId: 'workspace-1',
    })
    expect(canApplyWorkbenchTextEditProposal(proposal)).toBe(true)
    expect(findDirtyWorkbenchProposalPath({
      dirtyFilePaths: ['src/app.ts'],
      proposals: [proposal],
    })).toBe('src/app.ts')

    const conflicted = buildWorkbenchTextEditProposalView({
      item: proposalMemory(),
      relatedItems: [
        proposalMemory({
          kind: 'error',
          memoryId: 'proposal-conflict',
          metadata: {
            textEditProposalConflict: true,
            textEditProposalId: 'proposal-1',
          },
          summary: 'The file changed after the proposal was created.',
          title: 'Proposal conflict',
        }),
      ],
    })

    expect(conflicted).toMatchObject({
      conflictReason: 'The file changed after the proposal was created.',
      status: 'conflict',
    })
    expect(canApplyWorkbenchTextEditProposal(conflicted)).toBe(false)
    expect(isWorkbenchTextEditProposalConflictError('Expected SHA-256 mismatch for src/app.ts')).toBe(true)
  })
})

describe('workbench MVP-1 UI and audit regressions', () => {
  it('keeps process events out of AIRI chat while preserving right detail and audit links', () => {
    const run = commandRun()
    const root = memoryItem({
      kind: 'user-goal',
      memoryId: 'task-1',
      metadata: {
        workspaceId: 'workspace-1',
        workspaceRoot: 'D:/Ai/airi',
      },
      title: 'Fix bug',
    })
    const diff = memoryItem({
      artifactRefs: [{ kind: 'diff', path: 'src/app.ts' }],
      createdAt: 110,
      kind: 'diff-state',
      memoryId: 'diff-1',
      metadata: {
        taskCardId: 'task-1',
        textEditProposalId: 'proposal-1',
      },
      tags: ['workbench', 'task:task-1'],
      title: 'Edit preview',
      updatedAt: 110,
    })
    const commandOutput = memoryItem({
      artifactRefs: [{ id: run.runId, kind: 'command' }],
      createdAt: 120,
      kind: 'command-output',
      memoryId: 'command-1',
      metadata: {
        commandRisk: 'low',
        commandRiskReasonCode: 'low-risk-local-recipe',
        taskCardId: 'task-1',
      },
      sourceRunId: run.runId,
      tags: ['workbench', 'task:task-1'],
      title: 'Test output',
      updatedAt: 120,
    })
    const search = memoryItem({
      artifactRefs: [{
        id: 'search-1',
        kind: 'web-source',
        label: 'Vue docs',
      }],
      createdAt: 130,
      kind: 'note',
      memoryId: 'search-1',
      metadata: {
        agentLoopStep: 'web-search-query',
        searchProviderStatus: 'not-run',
        searchQuery: 'Vue docs',
        searchSourceCount: 0,
        taskCardId: 'task-1',
      },
      tags: ['workbench', 'task:task-1'],
      title: 'Search requested',
      updatedAt: 130,
    })
    const runtimeRun: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      decision: {
        action: 'record-only',
        confidence: 'high',
        effectiveInput: 'Can you inspect workspace files?',
        intent: 'inspect-only',
        reason: 'Boundary answer only.',
        reasonCode: 'ai-planner-record-only',
        source: 'ai-planner',
        taskId: 'task-1',
        visibleReply: 'Yes. Tell me the folder or file when you want me to inspect it.',
      },
      events: [{
        createdAt: 105,
        eventId: 'decision-1',
        kind: 'decision',
        runId: 'runtime-1',
        sessionId: 'session-1',
        title: 'Planner decision',
      }],
      input: 'Can you inspect workspace files?',
      metadata: { taskCardId: 'task-1' },
      runId: 'runtime-1',
      sessionId: 'session-1',
      startedAt: 105,
      status: 'success',
      updatedAt: 106,
      workspaceRoot: 'D:/Ai/airi',
    }
    const taskCard = taskCardFrom([root, diff, commandOutput, search], [run])
    const view = buildWorkbenchTaskProcessView({
      commandRuns: [run],
      runtimeRuns: [runtimeRun],
      taskCard,
      workspaceId: 'workspace-1',
      workspaceRoot: 'D:/Ai/airi',
    })

    expect(view.visibleProcessEvents.map(event => [event.kind, event.detailRef.tab])).toEqual(expect.arrayContaining([
      ['diff-created', 'changes'],
      ['command-output', 'terminal'],
      ['web-search', 'search'],
    ]))
    expect(view.processEvents.find(event => event.eventId === 'runtime:decision-1')).toMatchObject({
      kind: 'plan',
      visibleToUser: false,
    })
    expect(view.visibleProcessEvents.map(event => event.eventId)).not.toContain('runtime:decision-1')

    const auditEntries = buildWorkbenchAuditEntries({ includeHidden: true, processView: view })
    expect(auditEntries.map(entry => entry.kind)).toEqual(expect.arrayContaining([
      'planner-decision',
      'file-proposal',
      'command',
      'web-search',
    ]))

    const visibleAuditEntries = buildWorkbenchAuditEntries({ includeHidden: false, processView: view })
    expect(visibleAuditEntries.map(entry => entry.relatedEventId)).not.toContain('runtime:decision-1')

    const commandEvent = view.processEvents.find(event => event.eventId === 'memory:command-1')
    expect(getWorkbenchFocusedAuditEntryId({
      detailRef: commandEvent?.detailRef,
      entries: auditEntries,
    })).toBe('audit:memory:command-1')
  })
})

describe('workbench MVP-1 workspace and persona regressions', () => {
  it('blocks cross-workspace or missing-workspace operational actions', () => {
    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceId: 'workspace-1', workspaceRoot: 'D:/Ai/airi' },
      recorded: { workspaceId: 'workspace-1', workspaceRoot: 'D:/Ai/airi' },
    })).toMatchObject({ allowed: true })

    expect(guardWorkbenchWorkspaceIdentity({
      current: { workspaceId: 'workspace-2', workspaceRoot: 'D:/Ai/other' },
      recorded: { workspaceId: 'workspace-1', workspaceRoot: 'D:/Ai/airi' },
    })).toMatchObject({
      allowed: false,
      reason: 'workspace-id-mismatch',
    })

    expect(guardWorkbenchWorkspaceIdentity({
      current: {},
      recorded: { workspaceId: 'workspace-1' },
    })).toMatchObject({
      allowed: false,
      reason: 'current-workspace-missing',
    })
  })

  it('keeps Workbench work style concise, companion-aware, and risk-policy aligned', () => {
    const prompt = buildWorkbenchScenePromptSection({
      companionWarmth: 0.55,
      conciseReports: true,
      foldInternalDetails: true,
      sceneDescription: '',
    })

    expect(prompt).toContain('# Workbench Work Style')
    expect(prompt).toContain('Give the useful result first')
    expect(prompt).toContain('Let the active persona show through lightly')
    expect(prompt).toContain('Use preview-first file editing')
    expect(prompt).toContain('Short confirmations like ok')
    expect(prompt).not.toContain('Confirm before file writes')
    expect(prompt).not.toContain('free shell commands')
    expect(getWorkbenchWorkStylePreset('concise').companionWarmth)
      .toBeLessThan(getWorkbenchWorkStylePreset('balanced').companionWarmth)
    expect(getWorkbenchWorkStylePreset('warmer-companion').companionWarmth)
      .toBeGreaterThan(getWorkbenchWorkStylePreset('balanced').companionWarmth)
  })
})
