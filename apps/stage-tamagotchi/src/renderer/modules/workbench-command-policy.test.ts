import type { ElectronWorkbenchWorkspaceRecipe } from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchCommandOutputDisplayState,
  buildWorkbenchCommandTextPolicy,
  buildWorkbenchRecipeCommandPolicy,
} from './workbench-command-policy'

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

describe('workbench command policy', () => {
  it('allows low-risk local check recipes without repeated confirmation', () => {
    expect(buildWorkbenchRecipeCommandPolicy({
      recipe: recipe(),
      workspaceRoot: 'D:/Ai/airi',
    })).toMatchObject({
      canStart: true,
      commandText: 'pnpm run typecheck',
      disposition: 'allow-autonomous',
      mode: 'run-recipe',
      reasonCode: 'low-risk-local-recipe',
      risk: 'low',
    })
  })

  it('treats dev preview recipes as normal-risk autonomous commands', () => {
    expect(buildWorkbenchRecipeCommandPolicy({
      mode: 'project-preview',
      recipe: recipe({
        args: ['run', 'dev'],
        kind: 'dev',
        label: 'dev',
        recipeId: 'recipe-dev',
        riskLevel: 'medium',
      }),
      workspaceRoot: 'D:/Ai/airi',
    })).toMatchObject({
      canStart: true,
      disposition: 'allow-autonomous',
      mode: 'project-preview',
      reasonCode: 'normal-risk-project-preview',
      risk: 'normal',
    })
  })

  it('keeps high-risk and unsupported commands out of autonomous execution', () => {
    expect(buildWorkbenchCommandTextPolicy('pnpm install')).toMatchObject({
      canStart: false,
      disposition: 'needs-confirmation',
      reasonCode: 'high-risk-command-text',
      risk: 'high',
    })

    expect(buildWorkbenchRecipeCommandPolicy({
      recipe: recipe({
        args: ['scripts/typecheck.js'],
        command: 'node',
      }),
    })).toMatchObject({
      canStart: false,
      disposition: 'blocked',
      reasonCode: 'unsupported-recipe-command',
      risk: 'blocked',
    })
  })

  it('folds raw output by default while preserving summaries', () => {
    expect(buildWorkbenchCommandOutputDisplayState({
      outputPreview: 'full raw output',
      outputTruncated: true,
      status: 'success',
      stdoutSummary: '2 tests passed',
    })).toMatchObject({
      collapsed: true,
      emphasis: 'neutral',
      hasRawOutput: true,
      labelKind: 'output',
      outputPreview: 'full raw output',
      summary: '2 tests passed',
      terminalTab: 'terminal',
      truncated: true,
    })

    expect(buildWorkbenchCommandOutputDisplayState({
      error: 'Command failed',
      status: 'failed',
      stderrSummary: 'Type error',
    })).toMatchObject({
      collapsed: true,
      emphasis: 'error',
      labelKind: 'error',
      outputPreview: 'Command failed',
      summary: 'Type error',
    })
  })

  it('bounds very long raw output previews before rendering', () => {
    const result = buildWorkbenchCommandOutputDisplayState({
      outputPreview: 'x'.repeat(13_000),
      stdoutSummary: 'Command produced long output',
    })

    expect(result.collapsed).toBe(true)
    expect(result.outputPreview).toHaveLength(12_000)
    expect(result.summary).toBe('Command produced long output')
    expect(result.truncated).toBe(true)
  })
})
