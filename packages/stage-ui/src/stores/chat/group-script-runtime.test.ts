import { describe, expect, it } from 'vitest'

import { DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, parseGroupRoomScriptState } from './group-script'
import { parseGroupScriptEvaluation, reduceGroupScriptRuntimeCommand, validateGroupScriptSequelDraft } from './group-script-runtime'

function room() {
  return parseGroupRoomScriptState({
    templateSnapshot: {
      format: 'airi-group-script:v1',
      id: 'story',
      title: 'A watch',
      rules: [],
      slots: [{ slotId: 'guard', name: 'Guard' }],
      relationships: [],
      createdAt: 1,
      updatedAt: 2,
      acts: [
        { actId: 'arrival', number: 1, title: 'Arrival', unlockConditions: [{ conditionId: 'explained', description: 'The guest explains their arrival.', minConfidence: 0.8 }] },
        { actId: 'resolution', number: 2, title: 'Resolution', unlockConditions: [{ conditionId: 'resolved', description: 'The mystery is resolved.' }] },
      ],
    },
    roleBindings: { guard: 'character-1' },
    narrationSettings: { enabled: false, speechEnabled: false },
    chapterSettings: { ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, automaticEvaluationEnabled: true, sequelGenerationEnabled: true, maxGeneratedActs: 1 },
  }, ['character-1'])
}

function claim(state = room(), turnId = 'turn-1') {
  return reduceGroupScriptRuntimeCommand(state, {
    type: 'claim',
    job: { kind: 'evaluation', turnId, requestId: turnId, operationId: turnId, expiresAt: 2000, progressRevision: state.progress!.revision },
  }, ['real-message'], 1000)
}

function evaluation(actId = 'arrival', conditionId = 'explained', turnId = 'turn-1') {
  return { actId, operationId: turnId, evaluationTurnId: turnId, evaluatedAt: 1100, conditions: [{ conditionId, satisfied: true, confidence: 0.9, messageIds: ['real-message'], summary: 'The guest explicitly explained their arrival.' }] }
}

describe('chapter runtime commands', () => {
  it('allows an explicit new sequel request to replace an expired sequel lease', () => {
    const state = room()
    const job = { kind: 'sequel' as const, turnId: 'sequel-old', requestId: 'sequel-old', operationId: 'sequel-old', expiresAt: 2000, progressRevision: 0 }
    const leased = reduceGroupScriptRuntimeCommand(state, { type: 'claim', job }, [], 1000)
    expect(() => reduceGroupScriptRuntimeCommand(leased, { type: 'claim', job: { ...job, requestId: 'sequel-new', expiresAt: 4000 } }, [], 1500)).toThrow('already running')
    const recovered = reduceGroupScriptRuntimeCommand(leased, { type: 'claim', job: { ...job, turnId: 'sequel-new', requestId: 'sequel-new', operationId: 'sequel-new', expiresAt: 4000 } }, [], 3000)
    expect(recovered.chapterRuntime!.pendingJob!.requestId).toBe('sequel-new')
    expect(recovered.chapterRuntime!.evaluations).toEqual([])
  })
  it('bounds recent evaluation details without losing old billed-turn markers', () => {
    let state = room()
    for (let index = 0; index < 66; index++) {
      const turnId = `turn-${index}`
      state = reduceGroupScriptRuntimeCommand(claim(state, turnId), {
        type: 'evaluate',
        requestId: turnId,
        evaluation: { ...evaluation('arrival', 'explained', turnId), conditions: [{ ...evaluation().conditions[0], satisfied: false }] },
      }, ['real-message'], 1100)
    }
    expect(state.chapterRuntime!.evaluations).toHaveLength(66)
    expect(state.chapterRuntime!.evaluations.filter(item => item.conditions.length)).toHaveLength(64)
    expect(() => claim(state, 'turn-0')).toThrow('already been evaluated')
  })
  it('requires the full condition set and genuine message references, including unmet conditions', () => {
    const state = room()
    expect(() => parseGroupScriptEvaluation('broken', state, { operationId: 'op', evaluationTurnId: 'turn', evaluatedAt: 10 }, ['real-message'])).toThrow()
    expect(() => parseGroupScriptEvaluation(JSON.stringify({ actId: 'arrival', conditions: [] }), state, { operationId: 'op', evaluationTurnId: 'turn', evaluatedAt: 10 }, ['real-message'])).toThrow()
    expect(() => reduceGroupScriptRuntimeCommand(claim(), {
      type: 'evaluate',
      requestId: 'turn-1',
      evaluation: { ...evaluation(), conditions: [{ ...evaluation().conditions[0], satisfied: false, confidence: 0.1, messageIds: ['invented'] }] },
    }, ['real-message'], 1100)).toThrow('unavailable message')
  })

  it('advances only one act and preserves the original state and historical evidence when rolling back', () => {
    const original = claim()
    const advanced = reduceGroupScriptRuntimeCommand(original, { type: 'evaluate', requestId: 'turn-1', evaluation: evaluation() }, ['real-message'], 1100)
    expect(original.progress!.currentActId).toBe('arrival')
    expect(advanced.progress!.currentActId).toBe('resolution')
    expect(advanced.chapterRuntime!.evaluations[0].result).toBe('advanced')
    const rolledBack = reduceGroupScriptRuntimeCommand(advanced, { type: 'rollback', operationId: 'rollback-1', at: 1200 }, ['real-message'], 1200)
    expect(rolledBack.progress!.currentActId).toBe('arrival')
    expect(rolledBack.progress!.history[1].evidence[0].conditions[0].messageIds).toEqual(['real-message'])
  })

  it('records unmet and failed turns so another window cannot bill the same evaluation again', () => {
    const unmet = reduceGroupScriptRuntimeCommand(claim(), {
      type: 'evaluate',
      requestId: 'turn-1',
      evaluation: { ...evaluation(), conditions: [{ ...evaluation().conditions[0], confidence: 0.7 }] },
    }, ['real-message'], 1100)
    expect(unmet.progress!.revision).toBe(0)
    expect(unmet.chapterRuntime!.evaluations[0].result).toBe('unmet')
    expect(() => claim(unmet)).toThrow('already been evaluated')
    const failed = reduceGroupScriptRuntimeCommand(claim(), { type: 'fail', requestId: 'turn-1', at: 1100 }, [], 1100)
    expect(failed.chapterRuntime!.evaluations[0].result).toBe('failed')
    expect(() => claim(failed)).toThrow('already been evaluated')
  })

  it('rejects a competing lease and late completion after an explicit restart', () => {
    const original = claim()
    expect(() => claim(original, 'turn-2')).toThrow('already running')
    const restarted = reduceGroupScriptRuntimeCommand(original, { type: 'restart', operationId: 'restart-1', at: 1100 }, [], 1100)
    expect(restarted.progress!.revision).toBe(1)
    expect(restarted.progress!.history[1].action).toBe('restart')
    expect(() => reduceGroupScriptRuntimeCommand(restarted, { type: 'evaluate', requestId: 'turn-1', evaluation: evaluation() }, ['real-message'], 1150)).toThrow('no longer owns')
    expect(reduceGroupScriptRuntimeCommand(restarted, { type: 'restart', operationId: 'restart-1', at: 1200 }, [], 1200).progress!.revision).toBe(1)
  })

  it('does not retry an expired billed turn and preserves its failure when a new job takes over', () => {
    const pending = claim()
    const job = { kind: 'evaluation' as const, turnId: 'turn-1', requestId: 'retry', operationId: 'retry', expiresAt: 4000, progressRevision: 0 }
    expect(() => reduceGroupScriptRuntimeCommand(pending, { type: 'claim', job }, [], 3000)).toThrow('already been attempted')
    const next = reduceGroupScriptRuntimeCommand(pending, { type: 'claim', job: { ...job, turnId: 'turn-2' } }, [], 3000)
    expect(next.chapterRuntime!.evaluations).toEqual([expect.objectContaining({ turnId: 'turn-1', result: 'failed' })])
    expect(next.chapterRuntime!.pendingJob!.turnId).toBe('turn-2')
    const sequel = reduceGroupScriptRuntimeCommand(pending, { type: 'claim', job: { ...job, kind: 'sequel', turnId: 'sequel-operation' } }, [], 3000)
    expect(sequel.chapterRuntime!.evaluations[0].turnId).toBe('turn-1')
  })

  it('replaying an old restart does not cancel a newer evaluation lease', () => {
    const restarted = reduceGroupScriptRuntimeCommand(room(), { type: 'restart', operationId: 'restart-1', at: 1000 }, [], 1000)
    const pending = claim(restarted, 'turn-2')
    const replayed = reduceGroupScriptRuntimeCommand(pending, { type: 'restart', operationId: 'restart-1', at: 1200 }, [], 1200)
    expect(replayed).toBe(pending)
    expect(replayed.chapterRuntime!.pendingJob).toEqual(pending.chapterRuntime!.pendingJob)
    expect(replayed.chapterRuntime!.evaluations).toEqual([])
  })

  it('validates roles, chronology, prerequisites and the maximum sequel count', () => {
    const state = room()
    const draft = {
      requestId: 'sequel',
      basisTemplateUpdatedAt: 2,
      basisProgressRevision: 0,
      generatedAt: 1100,
      summary: 'Continue the established watch.',
      acts: [{ act: { actId: 'morning', number: 3, title: 'Morning', unlockConditions: [{ conditionId: 'report', description: 'The guard reports the result.' }] }, roleSlotIds: ['guard'], afterActId: 'resolution', prerequisiteActIds: ['resolution'] }],
    }
    expect(validateGroupScriptSequelDraft(state, draft).acts).toHaveLength(1)
    expect(() => validateGroupScriptSequelDraft(state, { ...draft, acts: [...draft.acts, ...draft.acts] })).toThrow('no longer matches')
    expect(() => validateGroupScriptSequelDraft(state, { ...draft, acts: [{ ...draft.acts[0], roleSlotIds: ['invented-role'] }] })).toThrow('invalid role')
    expect(() => validateGroupScriptSequelDraft(state, { ...draft, acts: [{ ...draft.acts[0], afterActId: 'arrival' }] })).toThrow('invalid role')
    const withDraft = { ...state, chapterRuntime: { evaluations: [], sequelDraft: draft } }
    const accepted = reduceGroupScriptRuntimeCommand(withDraft, { type: 'accept', requestId: 'sequel', operationId: 'accept-1', at: 1200 }, [], 1200)
    expect(accepted.templateSnapshot.acts!.slice(0, 2)).toEqual(state.templateSnapshot.acts)
    expect(accepted.templateSnapshot.acts).toHaveLength(3)
    expect(accepted.chapterRuntime!.sequelDraft).toBeUndefined()
  })

  it('appends an accepted sequel after completion without rewriting completed revision evidence', () => {
    const second = reduceGroupScriptRuntimeCommand(claim(), { type: 'evaluate', requestId: 'turn-1', evaluation: evaluation() }, ['real-message'], 1100)
    const completed = reduceGroupScriptRuntimeCommand(claim(second, 'turn-2'), { type: 'evaluate', requestId: 'turn-2', evaluation: evaluation('resolution', 'resolved', 'turn-2') }, ['real-message'], 1100)
    expect(completed.progress!.isComplete).toBe(true)
    completed.chapterRuntime!.sequelDraft = {
      requestId: 'sequel',
      basisTemplateUpdatedAt: 2,
      basisProgressRevision: 2,
      generatedAt: 1150,
      summary: 'Morning follows the finished night watch.',
      acts: [{ act: { actId: 'morning', number: 3, title: 'Morning', unlockConditions: [{ conditionId: 'report', description: 'The guard reports the result.' }] }, roleSlotIds: ['guard'], afterActId: 'resolution', prerequisiteActIds: ['resolution'] }],
    }
    const accepted = reduceGroupScriptRuntimeCommand(completed, { type: 'accept', requestId: 'sequel', operationId: 'accept-1', at: 1200 }, [], 1200)
    expect(accepted.progress!.currentActId).toBe('morning')
    expect(accepted.progress!.history[2]).toEqual(completed.progress!.history[2])
    expect(accepted.progress!.history[3].action).toBe('extend')
  })
})
