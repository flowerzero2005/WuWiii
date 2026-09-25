import type {
  ElectronWorkbenchAgentRuntimeActionKind,
  ElectronWorkbenchWorkspaceRecipe,
  ElectronWorkbenchWorkspaceRecipeKind,
} from './eventa'

export type WorkbenchPlannerRiskLevel = 'low' | 'normal' | 'high' | 'blocked'
export type WorkbenchPlannerPolicyDisposition = 'allow-autonomous' | 'needs-confirmation' | 'blocked'
export type WorkbenchPlannerScope
  = | 'selected-file'
    | 'named-path'
    | 'current-workspace'
    | 'current-task'
    | 'external-web'
    | 'unknown'
export type WorkbenchPlannerConfirmation
  = | 'none-needed'
    | 'explicit-plan-execution'
    | 'explicit-apply-write-save'
    | 'high-risk-confirmation'
    | 'missing'
export type WorkbenchPlannerWriteDisposition
  = | 'answer-only'
    | 'review-first'
    | 'apply-after-preview'

export const WORKBENCH_PLANNER_SCHEMA_ACTIONS = [
  'record-only',
  'ask-for-workspace',
  'ask-for-specific-next-step',
  'inspect-workspace',
  'prepare-file-proposal',
  'run-command',
  'start-project-preview',
  'web-search',
  'apply-existing-proposal',
] as const

export type WorkbenchPlannerAction = typeof WORKBENCH_PLANNER_SCHEMA_ACTIONS[number]

export const WORKBENCH_RUNTIME_PLANNER_ACTIONS = [
  'record-only',
  'ask-for-workspace',
  'ask-for-specific-next-step',
  'inspect-workspace',
  'prepare-file-proposal',
] as const satisfies readonly ElectronWorkbenchAgentRuntimeActionKind[]

export type WorkbenchRuntimePlannerAction = typeof WORKBENCH_RUNTIME_PLANNER_ACTIONS[number]

export interface WorkbenchPlannerSemanticSlots {
  action?: WorkbenchPlannerAction
  checklist: string[]
  confirmation: WorkbenchPlannerConfirmation
  expectedArtifacts: string[]
  missingInfo: string[]
  risk: WorkbenchPlannerRiskLevel
  scope: WorkbenchPlannerScope
  target?: string
  toolRequests: string[]
  userVisibleSummary?: string
  writeDisposition: WorkbenchPlannerWriteDisposition
  workspaceRequired: boolean
}

export interface WorkbenchPlannerPolicyDecision {
  disposition: WorkbenchPlannerPolicyDisposition
  reason: string
  reasonCode: string
  risk: WorkbenchPlannerRiskLevel
}

type WorkbenchRecipePolicyMode = 'run-recipe' | 'project-preview'

type WorkbenchRecipeLike = Pick<ElectronWorkbenchWorkspaceRecipe, 'args' | 'command' | 'cwd' | 'enabled' | 'kind' | 'label' | 'riskLevel'>

const SCHEMA_ACTION_SET = new Set<string>(WORKBENCH_PLANNER_SCHEMA_ACTIONS)
const RUNTIME_PLANNER_ACTION_SET = new Set<string>(WORKBENCH_RUNTIME_PLANNER_ACTIONS)
const EXECUTION_LIKE_RUNTIME_ACTIONS = new Set<ElectronWorkbenchAgentRuntimeActionKind>([
  'prepare-file-proposal',
  'inspect-workspace',
  'run-check',
  'start-project-preview',
])
const RUNNABLE_RECIPE_KINDS = new Set<ElectronWorkbenchWorkspaceRecipeKind>(['typecheck', 'lint', 'test', 'build'])
const PROJECT_PREVIEW_RECIPE_KINDS = new Set<ElectronWorkbenchWorkspaceRecipeKind>(['dev'])
const ALLOWED_PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])

function normalizeToken(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : ''
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStringList(value: unknown, limit: number) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : []

  return items
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

function normalizeCommandName(command: string) {
  return command.trim().replace(/\.cmd$/i, '').toLowerCase()
}

function toCommandText(command: string, args: readonly string[] = []) {
  return [command, ...args].filter(Boolean).join(' ').trim()
}

function normalizeRisk(value: unknown): WorkbenchPlannerRiskLevel | undefined {
  const risk = normalizeToken(value)
  if (risk === 'low')
    return 'low'
  if (risk === 'normal' || risk === 'medium')
    return 'normal'
  if (risk === 'high')
    return 'high'
  if (risk === 'blocked' || risk === 'block')
    return 'blocked'
}

function normalizeScope(value: unknown): WorkbenchPlannerScope {
  const scope = normalizeToken(value)
  if (
    scope === 'selected-file'
    || scope === 'named-path'
    || scope === 'current-workspace'
    || scope === 'current-task'
    || scope === 'external-web'
  ) {
    return scope
  }
  if (scope === 'workspace')
    return 'current-workspace'
  if (scope === 'web')
    return 'external-web'
  if (scope === 'file')
    return 'selected-file'
  return 'unknown'
}

function normalizeConfirmation(value: unknown): WorkbenchPlannerConfirmation {
  const confirmation = normalizeToken(value)
  if (confirmation === 'none' || confirmation === 'none-needed' || confirmation === 'not-needed')
    return 'none-needed'
  if (confirmation === 'explicit-plan-execution' || confirmation === 'plan-execution')
    return 'explicit-plan-execution'
  if (
    confirmation === 'explicit-apply'
    || confirmation === 'explicit-apply-write-save'
    || confirmation === 'apply-write-save'
  ) {
    return 'explicit-apply-write-save'
  }
  if (confirmation === 'high-risk' || confirmation === 'high-risk-confirmation')
    return 'high-risk-confirmation'
  return 'missing'
}

export function normalizeWorkbenchPlannerWriteDisposition(value: unknown): WorkbenchPlannerWriteDisposition {
  const disposition = normalizeToken(value)
  if (
    disposition === 'apply-after-preview'
    || disposition === 'apply-after-review'
    || disposition === 'apply'
    || disposition === 'direct-apply'
    || disposition === 'write-after-preview'
  ) {
    return 'apply-after-preview'
  }
  if (disposition === 'answer-only' || disposition === 'answer' || disposition === 'none')
    return 'answer-only'
  return 'review-first'
}

function inferRiskFromAction(action: WorkbenchPlannerAction | undefined, missingInfo: string[]) {
  if (missingInfo.length > 0)
    return 'blocked'
  if (!action)
    return 'blocked'
  if (action === 'ask-for-workspace' || action === 'ask-for-specific-next-step')
    return 'blocked'
  if (action === 'run-command' || action === 'start-project-preview' || action === 'web-search')
    return 'normal'
  if (action === 'apply-existing-proposal')
    return 'high'
  return 'low'
}

function actionRequiresWorkspace(action: WorkbenchPlannerAction | undefined) {
  return action === 'inspect-workspace'
    || action === 'prepare-file-proposal'
    || action === 'run-command'
    || action === 'start-project-preview'
    || action === 'apply-existing-proposal'
}

function isRelativeCwdEscapingWorkspace(cwd: string) {
  return cwd
    .replace(/\\/g, '/')
    .split('/')
    .includes('..')
}

function normalizePathLike(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isAbsolutePathLike(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

function isCwdOutsideWorkspace(cwd: string | undefined, workspaceRoot?: string) {
  if (!cwd)
    return false

  if (!isAbsolutePathLike(cwd))
    return isRelativeCwdEscapingWorkspace(cwd)

  if (!workspaceRoot)
    return true

  const normalizedCwd = normalizePathLike(cwd)
  const normalizedWorkspaceRoot = normalizePathLike(workspaceRoot)
  return normalizedCwd !== normalizedWorkspaceRoot && !normalizedCwd.startsWith(`${normalizedWorkspaceRoot}/`)
}

function isSafePackageScriptRecipe(recipe: WorkbenchRecipeLike) {
  const command = normalizeCommandName(recipe.command)
  return ALLOWED_PACKAGE_MANAGERS.has(command)
    && recipe.args.length === 2
    && recipe.args[0] === 'run'
    && recipe.args[1] === recipe.label
    && /^[\w:.-]+$/.test(recipe.label)
}

function policyDecision(params: WorkbenchPlannerPolicyDecision): WorkbenchPlannerPolicyDecision {
  return params
}

export function normalizeWorkbenchPlannerAction(value: unknown): WorkbenchPlannerAction | undefined {
  const action = normalizeToken(value)
  return SCHEMA_ACTION_SET.has(action) ? action as WorkbenchPlannerAction : undefined
}

export function normalizeWorkbenchRuntimePlannerAction(value: unknown): WorkbenchRuntimePlannerAction | undefined {
  const action = normalizeToken(value)
  return RUNTIME_PLANNER_ACTION_SET.has(action) ? action as WorkbenchRuntimePlannerAction : undefined
}

export function normalizeWorkbenchPlannerSemanticSlots(record: Record<string, unknown>): WorkbenchPlannerSemanticSlots {
  const action = normalizeWorkbenchPlannerAction(record.action)
  const missingInfo = normalizeStringList(record.missingInfo, 6)
  const risk = normalizeRisk(record.risk) ?? inferRiskFromAction(action, missingInfo)

  return {
    action,
    checklist: normalizeStringList(record.checklist ?? record.steps, 6),
    confirmation: normalizeConfirmation(record.confirmation),
    expectedArtifacts: normalizeStringList(record.expectedArtifacts, 6),
    missingInfo,
    risk,
    scope: normalizeScope(record.scope),
    target: normalizeString(record.target),
    toolRequests: normalizeStringList(record.toolRequests, 8),
    userVisibleSummary: normalizeString(record.userVisibleSummary ?? record.visibleReply ?? record.summary),
    writeDisposition: normalizeWorkbenchPlannerWriteDisposition(record.writeDisposition),
    workspaceRequired: typeof record.workspaceRequired === 'boolean'
      ? record.workspaceRequired
      : actionRequiresWorkspace(action),
  }
}

export function isWorkbenchRuntimeExecutionLikeAction(action: ElectronWorkbenchAgentRuntimeActionKind) {
  return EXECUTION_LIKE_RUNTIME_ACTIONS.has(action)
}

export function classifyWorkbenchPlannerActionRisk(
  slots: WorkbenchPlannerSemanticSlots,
  options: { hasWorkspace?: boolean } = {},
): WorkbenchPlannerPolicyDecision {
  if (slots.workspaceRequired && !options.hasWorkspace) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'This action needs a selected workspace.',
      reasonCode: 'workspace-required',
      risk: 'blocked',
    })
  }

  if (slots.risk === 'blocked') {
    return policyDecision({
      disposition: 'blocked',
      reason: 'Required planner slots are missing or blocked.',
      reasonCode: 'planner-slots-blocked',
      risk: 'blocked',
    })
  }

  if (slots.risk === 'high') {
    return policyDecision({
      disposition: 'needs-confirmation',
      reason: 'The planner marked this action as high risk.',
      reasonCode: 'planner-high-risk',
      risk: 'high',
    })
  }

  if (slots.action === 'apply-existing-proposal' && slots.confirmation !== 'explicit-apply-write-save') {
    return policyDecision({
      disposition: 'needs-confirmation',
      reason: 'Applying a proposal requires explicit apply, write, or save consent.',
      reasonCode: 'explicit-apply-required',
      risk: 'high',
    })
  }

  return policyDecision({
    disposition: 'allow-autonomous',
    reason: 'The planner action is within low or normal Workbench autonomy.',
    reasonCode: slots.risk === 'normal' ? 'normal-risk-autonomous' : 'low-risk-autonomous',
    risk: slots.risk,
  })
}

export function classifyWorkbenchCommandTextRisk(commandText: string): WorkbenchPlannerPolicyDecision {
  const normalized = commandText.trim().toLowerCase()
  if (!normalized) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'No command was provided.',
      reasonCode: 'empty-command',
      risk: 'blocked',
    })
  }

  if (
    /\b(?:sudo|runas)\b/.test(normalized)
    || /\b(?:rm|rmdir|del|erase|remove-item)\b/.test(normalized)
    || /\bgit\s+reset\s+--hard\b/.test(normalized)
    || /\bgit\s+clean(?:\s|$)/.test(normalized)
    || /\bgit\s+push\s+--force\b/.test(normalized)
    || /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|update|upgrade)\b/.test(normalized)
    || /\b(?:curl|wget|irm|iwr)\b.*\|\s*(?:sh|bash|zsh|fish|pwsh|powershell|cmd)\b/.test(normalized)
    || /\b(?:deploy|publish|migration|migrate)\b/.test(normalized)
  ) {
    return policyDecision({
      disposition: 'needs-confirmation',
      reason: 'The command matches a narrow high-risk command category.',
      reasonCode: 'high-risk-command-text',
      risk: 'high',
    })
  }

  if (/^git\s+(?:status|diff)(?:\s|$)/.test(normalized)) {
    return policyDecision({
      disposition: 'allow-autonomous',
      reason: 'Local git status and diff commands are low-risk diagnostics.',
      reasonCode: 'low-risk-local-diagnostic',
      risk: 'low',
    })
  }

  if (
    /\b(?:vitest|eslint|tsc|vue-tsc)\b/.test(normalized)
    || /\b(?:npm|pnpm|yarn|bun)\s+(?:run|exec)\s+(?:test:run|test|vitest|typecheck|lint|check|build|dev|start)(?:\s|$)/.test(normalized)
  ) {
    return policyDecision({
      disposition: 'allow-autonomous',
      reason: 'The command looks like a local check, build, test, or preview command.',
      reasonCode: 'normal-risk-local-command',
      risk: 'normal',
    })
  }

  return policyDecision({
    disposition: 'needs-confirmation',
    reason: 'The command is not recognized as an ordinary local diagnostic or project recipe.',
    reasonCode: 'unknown-command-requires-confirmation',
    risk: 'high',
  })
}

export function classifyWorkbenchRecipeRisk(
  recipe: WorkbenchRecipeLike,
  options: {
    mode?: WorkbenchRecipePolicyMode
    workspaceRoot?: string
  } = {},
): WorkbenchPlannerPolicyDecision {
  if (!recipe.enabled) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'The workspace recipe is disabled.',
      reasonCode: 'recipe-disabled',
      risk: 'blocked',
    })
  }

  if (isCwdOutsideWorkspace(recipe.cwd, options.workspaceRoot)) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'The recipe working directory is outside the selected workspace.',
      reasonCode: 'recipe-cwd-outside-workspace',
      risk: 'blocked',
    })
  }

  const commandRisk = classifyWorkbenchCommandTextRisk(toCommandText(recipe.command, recipe.args))
  if (commandRisk.reasonCode === 'high-risk-command-text') {
    return {
      ...commandRisk,
      reasonCode: `recipe-${commandRisk.reasonCode}`,
    }
  }

  if (recipe.riskLevel === 'high') {
    return policyDecision({
      disposition: 'needs-confirmation',
      reason: 'The recipe is configured as high risk.',
      reasonCode: 'recipe-high-risk',
      risk: 'high',
    })
  }

  const mode = options.mode ?? (recipe.kind === 'dev' ? 'project-preview' : 'run-recipe')

  if (mode === 'project-preview') {
    if (!PROJECT_PREVIEW_RECIPE_KINDS.has(recipe.kind)) {
      return policyDecision({
        disposition: 'blocked',
        reason: 'Only dev recipes can start a project preview.',
        reasonCode: 'unsupported-project-preview-kind',
        risk: 'blocked',
      })
    }
    if (!isSafePackageScriptRecipe(recipe)) {
      return policyDecision({
        disposition: 'blocked',
        reason: 'The preview recipe is not an allowlisted package-manager script.',
        reasonCode: 'unsupported-recipe-command',
        risk: 'blocked',
      })
    }

    return policyDecision({
      disposition: 'allow-autonomous',
      reason: 'A dev recipe with low or medium configured risk is a normal-risk local preview.',
      reasonCode: 'normal-risk-project-preview',
      risk: 'normal',
    })
  }

  if (!RUNNABLE_RECIPE_KINDS.has(recipe.kind)) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'The recipe kind is not runnable as a local check in MVP-1.',
      reasonCode: 'unsupported-recipe-kind',
      risk: 'blocked',
    })
  }

  if (recipe.riskLevel !== 'low') {
    return policyDecision({
      disposition: 'needs-confirmation',
      reason: 'Local check recipes must be configured as low risk for autonomous execution.',
      reasonCode: 'recipe-run-risk-not-low',
      risk: 'high',
    })
  }

  if (!isSafePackageScriptRecipe(recipe)) {
    return policyDecision({
      disposition: 'blocked',
      reason: 'The recipe command is not an allowlisted package-manager script.',
      reasonCode: 'unsupported-recipe-command',
      risk: 'blocked',
    })
  }

  return policyDecision({
    disposition: 'allow-autonomous',
    reason: 'The recipe is an allowlisted low-risk local check.',
    reasonCode: 'low-risk-local-recipe',
    risk: 'low',
  })
}
