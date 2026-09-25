export const WORKBENCH_MVP1_ACCEPTANCE_SCENARIO_IDS = [
  'feature-selected-folder',
  'fix-vue-typescript-issue',
  'document-file-diff-review',
  'targeted-check-folded-output',
  'web-search-search-tab',
  'voice-input-task-submission',
  'manual-edit-proposal-conflict',
  'two-workspaces-isolation',
  'audit-log-completed-task',
  'work-style-tone-reporting',
] as const

export const WORKBENCH_MVP1_FINAL_ACCEPTANCE_BAR_IDS = [
  'task-flow-coherent',
  'ui-understandable',
  'ordinary-work-not-over-confirmed',
  'high-risk-work-confirmed',
  'file-edits-reviewable',
  'manual-edits-protected',
  'workspace-isolation-works',
  'careful-companion-at-work',
  'old-keyword-routing-failures-stay-fixed',
] as const

export type WorkbenchMvp1AcceptanceScenarioId = typeof WORKBENCH_MVP1_ACCEPTANCE_SCENARIO_IDS[number]
export type WorkbenchMvp1FinalAcceptanceBarId = typeof WORKBENCH_MVP1_FINAL_ACCEPTANCE_BAR_IDS[number]
export type WorkbenchMvp1AcceptanceBaselineStatus = 'passed' | 'deferred' | 'failed'
export type WorkbenchMvp1AcceptanceWorkflowStatus = 'passed' | 'deferred' | 'failed'
export type WorkbenchMvp1AcceptanceVerdict = 'accepted' | 'manual-live-required' | 'blocked'

export interface WorkbenchMvp1AcceptanceScenario {
  acceptanceBarIds: WorkbenchMvp1FinalAcceptanceBarId[]
  automatedEvidence: string[]
  baselineStatus: WorkbenchMvp1AcceptanceBaselineStatus
  deferredReason?: string
  id: WorkbenchMvp1AcceptanceScenarioId
  title: string
  workflowStatus: WorkbenchMvp1AcceptanceWorkflowStatus
}

export interface WorkbenchMvp1FinalAcceptanceBar {
  automatedEvidence: string[]
  id: WorkbenchMvp1FinalAcceptanceBarId
  scenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  title: string
}

export interface WorkbenchMvp1AcceptanceSummaryInput {
  bars?: readonly WorkbenchMvp1FinalAcceptanceBar[]
  scenarios?: readonly WorkbenchMvp1AcceptanceScenario[]
}

export interface WorkbenchMvp1AcceptanceSummary {
  automatedBaselinePassed: boolean
  barCoverageMissing: WorkbenchMvp1FinalAcceptanceBarId[]
  baselineDeferred: number
  baselineDeferredScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  baselineFailed: number
  baselineFailedScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  baselinePassed: number
  evidenceMissingScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  fullMvp1Accepted: boolean
  scenarioBarMissingScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  totalScenarios: number
  verdict: WorkbenchMvp1AcceptanceVerdict
  workflowDeferred: number
  workflowDeferredScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  workflowFailed: number
  workflowFailedScenarioIds: WorkbenchMvp1AcceptanceScenarioId[]
  workflowPassed: number
}

const liveWorkflowDeferredReason = 'Requires an interactive Electron Workbench run with model/provider state; skipped by the long-running and escalation-prone check constraint.'

export const WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS: readonly WorkbenchMvp1AcceptanceScenario[] = [
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'file-edits-reviewable',
      'workspace-isolation-works',
    ],
    automatedEvidence: [
      'evaluation:file-preview-first-apply-explicit',
      'evaluation:workspace-cross-workspace-block',
      'test:workbench-file-proposals',
      'test:workbench-task-cards',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'feature-selected-folder',
    title: 'Create a small feature in a selected folder',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ordinary-work-not-over-confirmed',
      'high-risk-work-confirmed',
    ],
    automatedEvidence: [
      'evaluation:autonomy-command-risk-policy',
      'evaluation:autonomy-planner-fallback-stops-safely',
      'test:workbench-command-policy',
      'test:workbench-planner-policy',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'fix-vue-typescript-issue',
    title: 'Fix a failing TypeScript or Vue issue',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ui-understandable',
      'file-edits-reviewable',
      'old-keyword-routing-failures-stay-fixed',
    ],
    automatedEvidence: [
      'evaluation:routing-story-vs-file-story',
      'evaluation:file-preview-first-apply-explicit',
      'test:workbench-file-editor',
      'test:workbench-file-proposals',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'document-file-diff-review',
    title: 'Generate a document file and review the diff',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ui-understandable',
      'ordinary-work-not-over-confirmed',
      'high-risk-work-confirmed',
    ],
    automatedEvidence: [
      'evaluation:autonomy-command-risk-policy',
      'evaluation:ui-command-output-folded',
      'test:workbench-command-policy',
      'test:workbench-performance',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'targeted-check-folded-output',
    title: 'Run a targeted test or check and inspect folded output',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ui-understandable',
    ],
    automatedEvidence: [
      'evaluation:ui-process-not-chat-and-detail-refs',
      'test:workbench-web-search',
    ],
    baselineStatus: 'passed',
    deferredReason: 'Requires live provider or browser-backed search behavior; Phase 15 only verifies the visible request and Search-tab artifact baseline.',
    id: 'web-search-search-tab',
    title: 'Use web search and inspect the Search tab',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ui-understandable',
    ],
    automatedEvidence: [
      'test:workbench-voice-input',
    ],
    baselineStatus: 'passed',
    deferredReason: 'Requires live microphone and permission flow; Phase 15 only verifies transcript insertion behavior.',
    id: 'voice-input-task-submission',
    title: 'Submit a task through voice input',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'file-edits-reviewable',
      'manual-edits-protected',
      'old-keyword-routing-failures-stay-fixed',
    ],
    automatedEvidence: [
      'evaluation:file-manual-edit-conflict',
      'evaluation:routing-short-confirmation-no-apply',
      'test:workbench-file-proposals',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'manual-edit-proposal-conflict',
    title: 'Edit a file manually while a proposal exists',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'workspace-isolation-works',
    ],
    automatedEvidence: [
      'evaluation:workspace-cross-workspace-block',
      'test:workbench-workspace-identity',
    ],
    baselineStatus: 'passed',
    deferredReason: 'Requires two live Workbench windows or workspace sessions; Phase 15 verifies identity guards only.',
    id: 'two-workspaces-isolation',
    title: 'Run two tasks in two workspaces',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'task-flow-coherent',
      'ui-understandable',
    ],
    automatedEvidence: [
      'evaluation:ui-process-not-chat-and-detail-refs',
      'test:workbench-audit-entries',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'audit-log-completed-task',
    title: 'Inspect audit log for a completed task',
    workflowStatus: 'deferred',
  },
  {
    acceptanceBarIds: [
      'careful-companion-at-work',
      'old-keyword-routing-failures-stay-fixed',
    ],
    automatedEvidence: [
      'evaluation:persona-work-style-rules',
      'evaluation:routing-capability-question-no-tools',
      'test:workbench-settings',
    ],
    baselineStatus: 'passed',
    deferredReason: liveWorkflowDeferredReason,
    id: 'work-style-tone-reporting',
    title: 'Change Workbench work style preset and verify tone/reporting',
    workflowStatus: 'deferred',
  },
]

export const WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS: readonly WorkbenchMvp1FinalAcceptanceBar[] = [
  {
    automatedEvidence: [
      'evaluation:ui-process-not-chat-and-detail-refs',
      'test:workbench-task-cards',
    ],
    id: 'task-flow-coherent',
    scenarioIds: [
      'feature-selected-folder',
      'fix-vue-typescript-issue',
      'document-file-diff-review',
      'targeted-check-folded-output',
      'web-search-search-tab',
      'voice-input-task-submission',
      'two-workspaces-isolation',
      'audit-log-completed-task',
    ],
    title: 'Task flow is coherent',
  },
  {
    automatedEvidence: [
      'evaluation:ui-process-not-chat-and-detail-refs',
      'test:workbench-performance',
    ],
    id: 'ui-understandable',
    scenarioIds: [
      'document-file-diff-review',
      'targeted-check-folded-output',
      'web-search-search-tab',
      'voice-input-task-submission',
      'audit-log-completed-task',
    ],
    title: 'UI is understandable without explanation',
  },
  {
    automatedEvidence: [
      'evaluation:autonomy-command-risk-policy',
      'test:workbench-command-policy',
    ],
    id: 'ordinary-work-not-over-confirmed',
    scenarioIds: [
      'fix-vue-typescript-issue',
      'targeted-check-folded-output',
    ],
    title: 'Ordinary work is not over-confirmed',
  },
  {
    automatedEvidence: [
      'evaluation:autonomy-command-risk-policy',
      'test:workbench-command-policy',
    ],
    id: 'high-risk-work-confirmed',
    scenarioIds: [
      'fix-vue-typescript-issue',
      'targeted-check-folded-output',
    ],
    title: 'High-risk work is confirmed',
  },
  {
    automatedEvidence: [
      'evaluation:file-preview-first-apply-explicit',
      'test:workbench-file-proposals',
    ],
    id: 'file-edits-reviewable',
    scenarioIds: [
      'feature-selected-folder',
      'document-file-diff-review',
      'manual-edit-proposal-conflict',
    ],
    title: 'File edits are reviewable',
  },
  {
    automatedEvidence: [
      'evaluation:file-manual-edit-conflict',
      'test:workbench-file-proposals',
    ],
    id: 'manual-edits-protected',
    scenarioIds: [
      'manual-edit-proposal-conflict',
    ],
    title: 'Manual edits are protected',
  },
  {
    automatedEvidence: [
      'evaluation:workspace-cross-workspace-block',
      'test:workbench-workspace-identity',
    ],
    id: 'workspace-isolation-works',
    scenarioIds: [
      'feature-selected-folder',
      'two-workspaces-isolation',
    ],
    title: 'Workspace isolation works',
  },
  {
    automatedEvidence: [
      'evaluation:persona-work-style-rules',
      'test:workbench-settings',
    ],
    id: 'careful-companion-at-work',
    scenarioIds: [
      'work-style-tone-reporting',
    ],
    title: 'The current resident feels like a careful companion at work',
  },
  {
    automatedEvidence: [
      'evaluation:routing-capability-question-no-tools',
      'evaluation:routing-short-confirmation-no-apply',
      'evaluation:routing-story-vs-file-story',
    ],
    id: 'old-keyword-routing-failures-stay-fixed',
    scenarioIds: [
      'document-file-diff-review',
      'manual-edit-proposal-conflict',
      'work-style-tone-reporting',
    ],
    title: 'Old keyword routing failures do not return',
  },
]

export function summarizeWorkbenchMvp1Acceptance({
  bars = WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS,
  scenarios = WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS,
}: WorkbenchMvp1AcceptanceSummaryInput = {}): WorkbenchMvp1AcceptanceSummary {
  const scenarioIds = new Set(scenarios.map(scenario => scenario.id))
  const barIds = new Set(bars.map(bar => bar.id))

  const baselineDeferredScenarioIds = scenarios
    .filter(scenario => scenario.baselineStatus === 'deferred')
    .map(scenario => scenario.id)
  const baselineFailedScenarioIds = scenarios
    .filter(scenario => scenario.baselineStatus === 'failed')
    .map(scenario => scenario.id)
  const workflowDeferredScenarioIds = scenarios
    .filter(scenario => scenario.workflowStatus === 'deferred')
    .map(scenario => scenario.id)
  const workflowFailedScenarioIds = scenarios
    .filter(scenario => scenario.workflowStatus === 'failed')
    .map(scenario => scenario.id)
  const evidenceMissingScenarioIds = scenarios
    .filter(scenario => scenario.automatedEvidence.length === 0)
    .map(scenario => scenario.id)
  const scenarioBarMissingScenarioIds = scenarios
    .filter(scenario => scenario.acceptanceBarIds.some(barId => !barIds.has(barId)))
    .map(scenario => scenario.id)
  const barCoverageMissing = bars
    .filter(bar => bar.automatedEvidence.length === 0 || bar.scenarioIds.every(scenarioId => !scenarioIds.has(scenarioId)))
    .map(bar => bar.id)

  const blocked = baselineFailedScenarioIds.length > 0
    || workflowFailedScenarioIds.length > 0
    || evidenceMissingScenarioIds.length > 0
    || scenarioBarMissingScenarioIds.length > 0
    || barCoverageMissing.length > 0

  const automatedBaselinePassed = !blocked && baselineDeferredScenarioIds.length === 0
  const fullMvp1Accepted = automatedBaselinePassed && workflowDeferredScenarioIds.length === 0

  return {
    automatedBaselinePassed,
    barCoverageMissing,
    baselineDeferred: baselineDeferredScenarioIds.length,
    baselineDeferredScenarioIds,
    baselineFailed: baselineFailedScenarioIds.length,
    baselineFailedScenarioIds,
    baselinePassed: scenarios.filter(scenario => scenario.baselineStatus === 'passed').length,
    evidenceMissingScenarioIds,
    fullMvp1Accepted,
    scenarioBarMissingScenarioIds,
    totalScenarios: scenarios.length,
    verdict: blocked ? 'blocked' : fullMvp1Accepted ? 'accepted' : 'manual-live-required',
    workflowDeferred: workflowDeferredScenarioIds.length,
    workflowDeferredScenarioIds,
    workflowFailed: workflowFailedScenarioIds.length,
    workflowFailedScenarioIds,
    workflowPassed: scenarios.filter(scenario => scenario.workflowStatus === 'passed').length,
  }
}
