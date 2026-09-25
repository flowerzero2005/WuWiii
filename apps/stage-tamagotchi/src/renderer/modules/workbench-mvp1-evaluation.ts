export const WORKBENCH_MVP1_EVALUATION_CATEGORIES = [
  'routing',
  'autonomy',
  'file-flow',
  'ui-state',
  'workspace-isolation',
  'persona',
] as const

export type WorkbenchMvp1EvaluationCategory = typeof WORKBENCH_MVP1_EVALUATION_CATEGORIES[number]
export type WorkbenchMvp1EvaluationAutomation = 'automated' | 'manual'

export interface WorkbenchMvp1EvaluationScenario {
  automation: WorkbenchMvp1EvaluationAutomation
  category: WorkbenchMvp1EvaluationCategory
  coveredBy: string[]
  expected: string
  id: string
  prompt: string
  title: string
}

export interface WorkbenchMvp1EvaluationCoverage {
  automated: number
  category: WorkbenchMvp1EvaluationCategory
  manual: number
  scenarioIds: string[]
}

export const WORKBENCH_MVP1_EVALUATION_SCENARIOS: readonly WorkbenchMvp1EvaluationScenario[] = [
  {
    automation: 'automated',
    category: 'routing',
    coveredBy: ['chat-tool-bundles'],
    expected: 'A workspace capability question is answered by the model; local code does not classify the wording into an execution path.',
    id: 'routing-capability-question-no-tools',
    prompt: 'Can you inspect workspace files?',
    title: 'Capability question is not locally routed',
  },
  {
    automation: 'automated',
    category: 'routing',
    coveredBy: ['chat-tool-bundles'],
    expected: 'Short confirmations such as ok or confirm do not locally trigger apply intent.',
    id: 'routing-short-confirmation-no-apply',
    prompt: 'confirm',
    title: 'Short confirmation is not locally routed',
  },
  {
    automation: 'automated',
    category: 'routing',
    coveredBy: ['chat-tool-bundles'],
    expected: 'Creative writing and save-to-file wording are model-facing instructions; local code exposes safe preview tools but does not classify the text.',
    id: 'routing-story-vs-file-story',
    prompt: 'write a short story / write a short story and save it as story.md',
    title: 'Story request is not locally classified',
  },
  {
    automation: 'automated',
    category: 'autonomy',
    coveredBy: ['workbench-planner-policy', 'workbench-command-policy'],
    expected: 'Low-risk local checks can run autonomously, ordinary previews are normal risk, and high-risk commands require confirmation.',
    id: 'autonomy-command-risk-policy',
    prompt: 'Run the targeted check, then install dependencies',
    title: 'Command risk policy does not over-confirm ordinary checks',
  },
  {
    automation: 'automated',
    category: 'autonomy',
    coveredBy: ['workbench-planner-policy'],
    expected: 'Future direct run-command planner actions stay out of runtime execution until the command executor path is explicit.',
    id: 'autonomy-planner-fallback-stops-safely',
    prompt: 'planner timeout/failure during an execution-like action',
    title: 'Planner failure stops safely',
  },
  {
    automation: 'automated',
    category: 'file-flow',
    coveredBy: ['workbench-file-proposals', 'workbench-planner-policy'],
    expected: 'File edits are preview-first and apply/write/save requires explicit consent or a UI apply action.',
    id: 'file-preview-first-apply-explicit',
    prompt: 'write a short story and save it as story.md',
    title: 'Preview before write and apply is explicit',
  },
  {
    automation: 'automated',
    category: 'file-flow',
    coveredBy: ['workbench-file-proposals'],
    expected: 'Dirty editor paths and SHA-256 mismatches block proposal apply instead of overwriting user edits.',
    id: 'file-manual-edit-conflict',
    prompt: 'Edit a file manually while a proposal exists',
    title: 'Manual edit conflict refreshes preview',
  },
  {
    automation: 'manual',
    category: 'file-flow',
    coveredBy: ['MVP-1 acceptance pass'],
    expected: 'A clean manual edit that does not overlap the proposal should be preserved when the proposal applies.',
    id: 'file-manual-clean-merge',
    prompt: 'Make a non-overlapping manual edit before applying a proposal',
    title: 'Clean manual edit merge remains an acceptance scenario',
  },
  {
    automation: 'automated',
    category: 'ui-state',
    coveredBy: ['workbench-process-events', 'workbench-audit-entries'],
    expected: 'Checklist/process/detail/audit view models keep process events out of resident chat and focus right-side details.',
    id: 'ui-process-not-chat-and-detail-refs',
    prompt: 'Run a normal task with file preview, command, search, and audit detail',
    title: 'Process events stay separate from chat',
  },
  {
    automation: 'automated',
    category: 'ui-state',
    coveredBy: ['workbench-command-policy'],
    expected: 'Raw command output is folded by default while concise summaries stay visible.',
    id: 'ui-command-output-folded',
    prompt: 'Run a targeted test that emits raw output',
    title: 'Command output folds by default',
  },
  {
    automation: 'automated',
    category: 'workspace-isolation',
    coveredBy: ['workbench-workspace-identity', 'workbench-process-events'],
    expected: 'Recorded workspace identity must match the current workspace before apply/run/preview actions proceed.',
    id: 'workspace-cross-workspace-block',
    prompt: 'Apply a proposal created in another workspace',
    title: 'Task cannot apply to another workspace',
  },
  {
    automation: 'automated',
    category: 'persona',
    coveredBy: ['workbench settings prompt'],
    expected: 'Workbench work style keeps useful result first, concise reporting, light companion tone, and no broad confirmation rule.',
    id: 'persona-work-style-rules',
    prompt: 'Use the balanced or warmer companion work style preset',
    title: 'Companion tone is present but not performative',
  },
  {
    automation: 'manual',
    category: 'persona',
    coveredBy: ['MVP-1 acceptance pass'],
    expected: 'Live model replies should avoid rigid status-line bubbles and repeated fixed suffixes.',
    id: 'persona-live-reply-naturalness',
    prompt: 'Ask the current resident to fix a small issue and observe the final visible reply',
    title: 'No rigid status-line chat bubbles',
  },
]

export function getWorkbenchMvp1EvaluationCoverage() {
  return WORKBENCH_MVP1_EVALUATION_CATEGORIES.map<WorkbenchMvp1EvaluationCoverage>((category) => {
    const scenarios = WORKBENCH_MVP1_EVALUATION_SCENARIOS.filter(scenario => scenario.category === category)

    return {
      automated: scenarios.filter(scenario => scenario.automation === 'automated').length,
      category,
      manual: scenarios.filter(scenario => scenario.automation === 'manual').length,
      scenarioIds: scenarios.map(scenario => scenario.id),
    }
  })
}
