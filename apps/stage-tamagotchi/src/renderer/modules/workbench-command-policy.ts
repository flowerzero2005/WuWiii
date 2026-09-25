import type {
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchProjectPreviewSnapshot,
  ElectronWorkbenchWorkspaceRecipe,
} from '../../shared/eventa'
import type {
  WorkbenchPlannerPolicyDecision,
  WorkbenchPlannerRiskLevel,
} from '../../shared/workbench-planner-policy'

import {
  classifyWorkbenchCommandTextRisk,
  classifyWorkbenchRecipeRisk,
} from '../../shared/workbench-planner-policy'
import { limitWorkbenchTextPreview } from './workbench-performance'

export type WorkbenchCommandPolicyMode = 'run-recipe' | 'project-preview' | 'command-text'
export type WorkbenchCommandOutputEmphasis = 'neutral' | 'error'
export type WorkbenchCommandOutputLabelKind = 'output' | 'error'

export interface WorkbenchCommandPolicyView extends WorkbenchPlannerPolicyDecision {
  canStart: boolean
  commandText: string
  mode: WorkbenchCommandPolicyMode
}

export interface WorkbenchCommandOutputDisplayState {
  collapsed: boolean
  emphasis: WorkbenchCommandOutputEmphasis
  hasRawOutput: boolean
  labelKind: WorkbenchCommandOutputLabelKind
  outputPreview: string
  summary: string
  terminalTab: 'terminal'
  truncated: boolean
}

interface CommandOutputLike {
  error?: string
  outputPreview?: string
  outputTruncated?: boolean
  status?: string
  stderrSummary?: string
  stdoutSummary?: string
}

function toCommandText(command: string, args: readonly string[] = []) {
  return [command, ...args].filter(Boolean).join(' ').trim()
}

function normalizePolicyView(
  decision: WorkbenchPlannerPolicyDecision,
  commandText: string,
  mode: WorkbenchCommandPolicyMode,
): WorkbenchCommandPolicyView {
  return {
    ...decision,
    canStart: decision.disposition === 'allow-autonomous',
    commandText,
    mode,
  }
}

export function isWorkbenchCommandRiskLevel(value: unknown): value is WorkbenchPlannerRiskLevel {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'blocked'
}

export function buildWorkbenchRecipeCommandPolicy(input: {
  mode?: Exclude<WorkbenchCommandPolicyMode, 'command-text'>
  recipe: ElectronWorkbenchWorkspaceRecipe
  workspaceRoot?: string
}): WorkbenchCommandPolicyView {
  const mode = input.mode ?? (input.recipe.kind === 'dev' ? 'project-preview' : 'run-recipe')
  const decision = classifyWorkbenchRecipeRisk(input.recipe, {
    mode,
    workspaceRoot: input.workspaceRoot,
  })

  return normalizePolicyView(
    decision,
    toCommandText(input.recipe.command, input.recipe.args),
    mode,
  )
}

export function buildWorkbenchCommandTextPolicy(commandText: string): WorkbenchCommandPolicyView {
  return normalizePolicyView(
    classifyWorkbenchCommandTextRisk(commandText),
    commandText.trim(),
    'command-text',
  )
}

export function buildWorkbenchCommandRunPolicy(input: {
  recipe?: ElectronWorkbenchWorkspaceRecipe
  run: ElectronWorkbenchCommandRunSnapshot
  workspaceRoot?: string
}): WorkbenchCommandPolicyView {
  if (input.recipe) {
    return buildWorkbenchRecipeCommandPolicy({
      mode: 'run-recipe',
      recipe: input.recipe,
      workspaceRoot: input.workspaceRoot,
    })
  }

  return buildWorkbenchCommandTextPolicy(input.run.commandText)
}

export function buildWorkbenchProjectPreviewPolicy(input: {
  preview: ElectronWorkbenchProjectPreviewSnapshot
  recipe?: ElectronWorkbenchWorkspaceRecipe
  workspaceRoot?: string
}): WorkbenchCommandPolicyView {
  if (input.recipe) {
    return buildWorkbenchRecipeCommandPolicy({
      mode: 'project-preview',
      recipe: input.recipe,
      workspaceRoot: input.workspaceRoot,
    })
  }

  return buildWorkbenchCommandTextPolicy(input.preview.commandText)
}

export function buildWorkbenchCommandOutputDisplayState(input: CommandOutputLike): WorkbenchCommandOutputDisplayState {
  const boundedOutputPreview = limitWorkbenchTextPreview(input.outputPreview || input.error || '')
  const summary = input.stderrSummary || input.stdoutSummary || input.error || ''
  const emphasis = input.error || input.stderrSummary || input.status === 'failed'
    ? 'error'
    : 'neutral'

  return {
    collapsed: true,
    emphasis,
    hasRawOutput: Boolean(boundedOutputPreview.text),
    labelKind: !input.outputPreview && input.error ? 'error' : 'output',
    outputPreview: boundedOutputPreview.text,
    summary,
    terminalTab: 'terminal',
    truncated: Boolean(input.outputTruncated || boundedOutputPreview.truncated),
  }
}
