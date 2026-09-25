import type { ElectronWorkbenchWorkspaceRecipe } from './eventa'

import { describe, expect, it } from 'vitest'

import {
  classifyWorkbenchCommandTextRisk,
  classifyWorkbenchPlannerActionRisk,
  classifyWorkbenchRecipeRisk,
  isWorkbenchRuntimeExecutionLikeAction,
  normalizeWorkbenchPlannerSemanticSlots,
  normalizeWorkbenchPlannerWriteDisposition,
  normalizeWorkbenchRuntimePlannerAction,
  WORKBENCH_RUNTIME_PLANNER_ACTIONS,
} from './workbench-planner-policy'

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

describe('workbench planner policy', () => {
  it('normalizes semantic planner slots without accepting unsupported runtime actions', () => {
    const slots = normalizeWorkbenchPlannerSemanticSlots({
      action: 'run_command',
      checklist: ['Inspect files', 'Run targeted test'],
      confirmation: 'none',
      expectedArtifacts: ['test result'],
      missingInfo: [],
      risk: 'medium',
      scope: 'current workspace',
      target: 'pnpm exec vitest run widget.test.ts',
      toolRequests: ['command'],
      userVisibleSummary: 'Run the targeted check.',
      writeDisposition: 'apply_after_preview',
      workspaceRequired: true,
    })

    expect(slots).toMatchObject({
      action: 'run-command',
      confirmation: 'none-needed',
      risk: 'normal',
      scope: 'current-workspace',
      target: 'pnpm exec vitest run widget.test.ts',
      writeDisposition: 'apply-after-preview',
      workspaceRequired: true,
    })
    expect(slots.checklist).toEqual(['Inspect files', 'Run targeted test'])
    expect(normalizeWorkbenchRuntimePlannerAction(slots.action)).toBeUndefined()
    expect(WORKBENCH_RUNTIME_PLANNER_ACTIONS).toEqual([
      'record-only',
      'ask-for-workspace',
      'ask-for-specific-next-step',
      'inspect-workspace',
      'prepare-file-proposal',
    ])
  })

  it('normalizes file write disposition as planner metadata instead of keyword routing', () => {
    expect(normalizeWorkbenchPlannerWriteDisposition('apply after preview')).toBe('apply-after-preview')
    expect(normalizeWorkbenchPlannerWriteDisposition('direct_apply')).toBe('apply-after-preview')
    expect(normalizeWorkbenchPlannerWriteDisposition('answer only')).toBe('answer-only')
    expect(normalizeWorkbenchPlannerWriteDisposition('anything else')).toBe('review-first')
  })

  it('marks workspace actions blocked when no workspace is selected', () => {
    const slots = normalizeWorkbenchPlannerSemanticSlots({
      action: 'inspect-workspace',
      risk: 'low',
    })

    expect(classifyWorkbenchPlannerActionRisk(slots, { hasWorkspace: false })).toMatchObject({
      disposition: 'blocked',
      reasonCode: 'workspace-required',
      risk: 'blocked',
    })
  })

  it('keeps preview proposals low risk but apply actions gated by explicit apply consent', () => {
    const proposalSlots = normalizeWorkbenchPlannerSemanticSlots({
      action: 'prepare-file-proposal',
      risk: 'low',
    })
    const applySlots = normalizeWorkbenchPlannerSemanticSlots({
      action: 'apply-existing-proposal',
      risk: 'normal',
    })

    expect(classifyWorkbenchPlannerActionRisk(proposalSlots, { hasWorkspace: true })).toMatchObject({
      disposition: 'allow-autonomous',
      risk: 'low',
    })
    expect(classifyWorkbenchPlannerActionRisk(applySlots, { hasWorkspace: true })).toMatchObject({
      disposition: 'needs-confirmation',
      reasonCode: 'explicit-apply-required',
      risk: 'high',
    })
  })

  it('classifies ordinary local check recipes as low-risk autonomous', () => {
    expect(classifyWorkbenchRecipeRisk(recipe(), { workspaceRoot: 'D:/work/project' })).toMatchObject({
      disposition: 'allow-autonomous',
      reasonCode: 'low-risk-local-recipe',
      risk: 'low',
    })
  })

  it('classifies dev preview recipes as normal-risk autonomous when not high risk', () => {
    expect(classifyWorkbenchRecipeRisk(recipe({
      args: ['run', 'dev'],
      kind: 'dev',
      label: 'dev',
      recipeId: 'recipe-dev',
      riskLevel: 'medium',
    }), { mode: 'project-preview', workspaceRoot: 'D:/work/project' })).toMatchObject({
      disposition: 'allow-autonomous',
      reasonCode: 'normal-risk-project-preview',
      risk: 'normal',
    })
  })

  it('requires confirmation for high-risk command categories', () => {
    expect(classifyWorkbenchCommandTextRisk('pnpm install')).toMatchObject({
      disposition: 'needs-confirmation',
      reasonCode: 'high-risk-command-text',
      risk: 'high',
    })
    expect(classifyWorkbenchRecipeRisk(recipe({
      args: ['install'],
      label: 'install',
    }))).toMatchObject({
      disposition: 'needs-confirmation',
      reasonCode: 'recipe-high-risk-command-text',
      risk: 'high',
    })
  })

  it('blocks disabled, unsupported, or outside-workspace recipes instead of treating them as consentable', () => {
    expect(classifyWorkbenchRecipeRisk(recipe({ enabled: false }))).toMatchObject({
      disposition: 'blocked',
      reasonCode: 'recipe-disabled',
      risk: 'blocked',
    })
    expect(classifyWorkbenchRecipeRisk(recipe({
      args: ['scripts/typecheck.js'],
      command: 'node',
    }))).toMatchObject({
      disposition: 'blocked',
      reasonCode: 'unsupported-recipe-command',
      risk: 'blocked',
    })
    expect(classifyWorkbenchRecipeRisk(recipe({
      cwd: '../other-project',
    }), { workspaceRoot: 'D:/work/project' })).toMatchObject({
      disposition: 'blocked',
      reasonCode: 'recipe-cwd-outside-workspace',
      risk: 'blocked',
    })
  })

  it('keeps planner failure fallback conservative for execution-like runtime actions', () => {
    expect(isWorkbenchRuntimeExecutionLikeAction('prepare-file-proposal')).toBe(true)
    expect(isWorkbenchRuntimeExecutionLikeAction('inspect-workspace')).toBe(true)
    expect(isWorkbenchRuntimeExecutionLikeAction('run-check')).toBe(true)
    expect(isWorkbenchRuntimeExecutionLikeAction('start-project-preview')).toBe(true)
    expect(isWorkbenchRuntimeExecutionLikeAction('record-only')).toBe(false)
    expect(isWorkbenchRuntimeExecutionLikeAction('ask-for-specific-next-step')).toBe(false)
  })
})
