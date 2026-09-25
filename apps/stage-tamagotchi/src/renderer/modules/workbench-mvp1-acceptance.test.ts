import { describe, expect, it } from 'vitest'

import {
  summarizeWorkbenchMvp1Acceptance,
  WORKBENCH_MVP1_ACCEPTANCE_SCENARIO_IDS,
  WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS,
  WORKBENCH_MVP1_FINAL_ACCEPTANCE_BAR_IDS,
  WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS,
} from './workbench-mvp1-acceptance'
import { WORKBENCH_MVP1_EVALUATION_SCENARIOS } from './workbench-mvp1-evaluation'

describe('workbench MVP-1 acceptance pass', () => {
  it('tracks the ten planned live acceptance scenarios in roadmap order', () => {
    expect(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.map(scenario => scenario.id)).toEqual([
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
    ])

    expect(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.map(scenario => scenario.id)).toEqual([
      ...WORKBENCH_MVP1_ACCEPTANCE_SCENARIO_IDS,
    ])
    expect(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.every(scenario => scenario.baselineStatus === 'passed')).toBe(true)
    expect(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.every(scenario => scenario.workflowStatus === 'deferred')).toBe(true)
    expect(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.every(scenario => scenario.deferredReason)).toBe(true)
  })

  it('maps every scenario and final acceptance bar to automated evidence', () => {
    const barIds = new Set(WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS.map(bar => bar.id))
    const scenarioIds = new Set(WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.map(scenario => scenario.id))
    const evaluationScenarioIds = new Set(WORKBENCH_MVP1_EVALUATION_SCENARIOS.map(scenario => scenario.id))
    const evaluationEvidenceIds = [
      ...WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.flatMap(scenario => scenario.automatedEvidence),
      ...WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS.flatMap(bar => bar.automatedEvidence),
    ]
      .filter(evidence => evidence.startsWith('evaluation:'))
      .map(evidence => evidence.slice('evaluation:'.length))

    expect(WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS.map(bar => bar.id)).toEqual([
      ...WORKBENCH_MVP1_FINAL_ACCEPTANCE_BAR_IDS,
    ])

    for (const scenario of WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS) {
      expect(scenario.automatedEvidence.length, scenario.id).toBeGreaterThan(0)
      expect(scenario.acceptanceBarIds.length, scenario.id).toBeGreaterThan(0)
      expect(scenario.acceptanceBarIds.every(barId => barIds.has(barId)), scenario.id).toBe(true)
    }

    for (const bar of WORKBENCH_MVP1_FINAL_ACCEPTANCE_BARS) {
      expect(bar.automatedEvidence.length, bar.id).toBeGreaterThan(0)
      expect(bar.scenarioIds.length, bar.id).toBeGreaterThan(0)
      expect(bar.scenarioIds.every(scenarioId => scenarioIds.has(scenarioId)), bar.id).toBe(true)
    }

    expect(evaluationEvidenceIds.length).toBeGreaterThan(0)
    expect(evaluationEvidenceIds.every(id => evaluationScenarioIds.has(id))).toBe(true)
  })

  it('passes the automated baseline but refuses full MVP-1 acceptance while live workflows are deferred', () => {
    expect(summarizeWorkbenchMvp1Acceptance()).toMatchObject({
      automatedBaselinePassed: true,
      baselineDeferred: 0,
      baselineFailed: 0,
      baselinePassed: 10,
      fullMvp1Accepted: false,
      totalScenarios: 10,
      verdict: 'manual-live-required',
      workflowDeferred: 10,
      workflowFailed: 0,
      workflowPassed: 0,
    })

    expect(summarizeWorkbenchMvp1Acceptance().workflowDeferredScenarioIds).toEqual([
      ...WORKBENCH_MVP1_ACCEPTANCE_SCENARIO_IDS,
    ])
  })

  it('can represent final acceptance after the deferred live workflows pass', () => {
    const livePassedScenarios = WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.map(scenario => ({
      ...scenario,
      deferredReason: undefined,
      workflowStatus: 'passed' as const,
    }))

    expect(summarizeWorkbenchMvp1Acceptance({ scenarios: livePassedScenarios })).toMatchObject({
      automatedBaselinePassed: true,
      fullMvp1Accepted: true,
      verdict: 'accepted',
      workflowDeferred: 0,
      workflowPassed: 10,
    })
  })

  it('blocks acceptance when automated evidence is missing', () => {
    const missingEvidenceScenarios = WORKBENCH_MVP1_ACCEPTANCE_SCENARIOS.map((scenario, index) =>
      index === 0
        ? {
            ...scenario,
            automatedEvidence: [],
          }
        : scenario)

    expect(summarizeWorkbenchMvp1Acceptance({ scenarios: missingEvidenceScenarios })).toMatchObject({
      automatedBaselinePassed: false,
      evidenceMissingScenarioIds: ['feature-selected-folder'],
      fullMvp1Accepted: false,
      verdict: 'blocked',
    })
  })
})
