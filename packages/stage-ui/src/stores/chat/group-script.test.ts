import { describe, expect, it } from 'vitest'

import {
  advanceGroupScriptAct,
  buildGroupScriptRoomMembers,
  buildGroupScriptRoomRelationships,
  buildGroupScriptSpeakerContext,
  createInitialGroupScriptProgress,
  decodeGroupScript,
  encodeGroupScript,
  GROUP_SCRIPT_FORMAT,
  parseGroupRoomScriptState,
  parseGroupScript,
  restartGroupScriptAct,
  rollbackGroupScriptAct,
} from './group-script'

function template(overrides: Record<string, unknown> = {}) {
  return {
    format: GROUP_SCRIPT_FORMAT,
    id: 'night-shift',
    title: 'Night shift',
    summary: 'A quiet watch.',
    rules: ['Keep the lobby quiet.'],
    slots: [
      { slotId: 'guard', name: 'Guard', description: 'Keeps watch.' },
      { slotId: 'guest', name: 'Guest', description: 'Arrived late.' },
    ],
    relationships: [{ fromSlotId: 'guard', toSlotId: 'guest', description: 'Suspicious of them.' }],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function chapterTemplate(overrides: Record<string, unknown> = {}) {
  return template({
    acts: [
      {
        actId: 'arrival',
        number: 1,
        title: 'Arrival',
        narration: 'The night shift begins.',
        goal: 'Learn why the guest arrived late.',
        visibility: 'visible',
        unlockConditions: [{ conditionId: 'guest-explains', description: 'The guest explains why they arrived late.', minConfidence: 0.8 }],
      },
      {
        actId: 'investigation',
        number: 2,
        title: 'Investigation',
        narration: 'A missing record changes the tone.',
        goal: 'Find the missing record.',
        visibility: 'visible',
        unlockConditions: [{ conditionId: 'record-found', description: 'The group has located the missing record.', minEvidenceCount: 2 }],
      },
      {
        actId: 'resolution',
        number: 3,
        title: 'Resolution',
        unlockConditions: [{ conditionId: 'truth-shared', description: 'The group shares the full truth.' }],
      },
    ],
    ...overrides,
  })
}

function advanceInput(actId: string, operationId: string, evaluationTurnId: string, conditionId: string, messageIds: string[], evaluatedAt = 10) {
  return {
    actId,
    operationId,
    evaluationTurnId,
    evaluatedAt,
    conditions: [{
      conditionId,
      satisfied: true,
      confidence: 0.9,
      messageIds,
      summary: 'Conversation evidence supports the condition.',
    }],
  }
}

describe('group script contract', () => {
  it('round-trips a strict template', () => {
    const parsed = parseGroupScript(template())
    expect(decodeGroupScript(encodeGroupScript(parsed))).toEqual(parsed)

    for (const forbiddenField of ['characterId', 'provider', 'model', 'voice', 'memory', 'systemPrompt']) {
      expect(() => parseGroupScript({ ...template(), [forbiddenField]: 'secret' })).toThrow()
      expect(() => parseGroupScript({
        ...template(),
        slots: [{ slotId: 'guard', name: 'Guard', [forbiddenField]: 'secret' }],
      })).toThrow()
    }
  })

  it('rejects invalid timestamps, slot references, duplicates, and unsafe slot keys', () => {
    expect(() => parseGroupScript(template({ createdAt: 3, updatedAt: 2 }))).toThrow('updatedAt')
    expect(() => parseGroupScript(template({ updatedAt: Number.POSITIVE_INFINITY }))).toThrow()
    expect(() => parseGroupScript(template({ updatedAt: 1.5 }))).toThrow()
    expect(() => parseGroupScript(template({ slots: [{ slotId: 'same', name: 'A' }, { slotId: 'same', name: 'B' }] }))).toThrow('Duplicate')
    expect(() => parseGroupScript(template({ slots: [{ slotId: '__proto__', name: 'A' }] }))).toThrow()
    expect(() => parseGroupScript(template({ relationships: [{ fromSlotId: 'guard', toSlotId: 'missing' }] }))).toThrow('unknown slot')
    expect(() => parseGroupScript(template({ relationships: [{ fromSlotId: 'guard', toSlotId: 'guard' }] }))).toThrow('itself')
  })

  it('rejects JSON above 64 KiB before parsing', () => {
    const oversized = `{"${'x'.repeat(70_000)}"` // Deliberately malformed as well.
    expect(() => decodeGroupScript(oversized)).toThrow('64 KiB')
  })

  it('keeps legacy room snapshots readable and migrates chapter rooms to a deterministic initial revision', () => {
    const legacy = parseGroupRoomScriptState({
      templateSnapshot: template(),
      roleBindings: { guard: 'character-a', guest: 'character-b' },
      narrationSettings: { enabled: false, speechEnabled: false },
    }, ['character-a', 'character-b'])
    expect(legacy).not.toHaveProperty('progress')

    const chapters = parseGroupScript(chapterTemplate())
    const migrated = parseGroupRoomScriptState({
      templateSnapshot: chapters,
      roleBindings: { guard: 'character-a', guest: 'character-b' },
      narrationSettings: { enabled: false, speechEnabled: false },
    }, ['character-a', 'character-b'])
    expect(migrated.progress).toEqual({
      revision: 0,
      currentActId: 'arrival',
      unlockedActIds: ['arrival'],
      completedActIds: [],
      evidence: [],
      isComplete: false,
      history: [{
        revision: 0,
        action: 'initialize',
        operationId: undefined,
        changedAt: 2,
        currentActId: 'arrival',
        unlockedActIds: ['arrival'],
        completedActIds: [],
        evidence: [],
        isComplete: false,
      }],
    })

    expect(createInitialGroupScriptProgress(chapters)).toMatchObject({
      currentActId: 'arrival',
      unlockedActIds: ['arrival'],
      completedActIds: [],
      revision: 0,
    })
    expect(() => parseGroupScript(chapterTemplate({
      acts: [{ actId: 'arrival', number: 2, title: 'Arrival', unlockConditions: [{ conditionId: 'one', description: 'A fact.' }] }],
    }))).toThrow('consecutive')
  })

  it('advances only in order with complete, message-backed semantic evidence and ignores repeated evaluations', () => {
    const script = parseGroupScript(chapterTemplate())
    const initial = createInitialGroupScriptProgress(script)
    const advanced = advanceGroupScriptAct(
      script,
      initial,
      advanceInput('arrival', 'advance-arrival', 'turn-1', 'guest-explains', ['message-1']),
      ['message-1'],
    )

    expect(advanced).toMatchObject({
      revision: 1,
      currentActId: 'investigation',
      unlockedActIds: ['arrival', 'investigation'],
      completedActIds: ['arrival'],
      evidence: [{ actId: 'arrival', evaluationTurnId: 'turn-1' }],
    })
    expect(advanced.history).toHaveLength(2)
    expect(advanceGroupScriptAct(
      script,
      advanced,
      advanceInput('arrival', 'advance-arrival', 'turn-1', 'guest-explains', ['message-1']),
      ['message-1'],
    )).toBe(advanced)
    expect(() => advanceGroupScriptAct(
      script,
      advanced,
      advanceInput('investigation', 'missing-source', 'turn-2', 'record-found', ['missing-message', 'other-missing-message']),
      ['message-1'],
    )).toThrow('unavailable message')
    expect(advanceGroupScriptAct(
      script,
      advanced,
      advanceInput('resolution', 'out-of-order', 'turn-3', 'truth-shared', ['message-1']),
      ['message-1'],
    )).toBe(advanced)
  })

  it('creates immutable revisions when restarting or rolling back an unlocked act', () => {
    const script = parseGroupScript(chapterTemplate())
    const secondAct = advanceGroupScriptAct(
      script,
      createInitialGroupScriptProgress(script),
      advanceInput('arrival', 'advance-arrival', 'turn-1', 'guest-explains', ['message-1']),
      ['message-1'],
    )
    const thirdAct = advanceGroupScriptAct(
      script,
      secondAct,
      advanceInput('investigation', 'advance-investigation', 'turn-2', 'record-found', ['message-2', 'message-3'], 20),
      ['message-2', 'message-3'],
    )
    const restarted = restartGroupScriptAct(script, thirdAct, {
      operationId: 'restart-investigation',
      changedAt: 30,
      actId: 'investigation',
    })

    expect(restarted).toMatchObject({
      revision: 3,
      currentActId: 'investigation',
      unlockedActIds: ['arrival', 'investigation'],
      completedActIds: ['arrival'],
      evidence: [{ actId: 'arrival' }],
    })
    expect(thirdAct.currentActId).toBe('resolution')
    expect(thirdAct.evidence).toHaveLength(2)
    expect(restarted.history).toHaveLength(4)

    const rolledBack = rollbackGroupScriptAct(script, thirdAct, {
      operationId: 'rollback-one-act',
      changedAt: 40,
    })
    expect(rolledBack.currentActId).toBe('investigation')
    expect(rolledBack.history.at(-1)).toMatchObject({ action: 'rollback', revision: 3 })
    expect(rollbackGroupScriptAct(script, rolledBack, {
      operationId: 'rollback-one-act',
      changedAt: 40,
    })).toBe(rolledBack)
  })

  it('round-trips persisted chapter progress without sharing mutable revision arrays', () => {
    const script = parseGroupScript(chapterTemplate())
    const progress = advanceGroupScriptAct(
      script,
      createInitialGroupScriptProgress(script),
      advanceInput('arrival', 'advance-arrival', 'turn-1', 'guest-explains', ['message-1']),
      ['message-1'],
    )
    const restored = parseGroupRoomScriptState(JSON.parse(JSON.stringify({
      templateSnapshot: script,
      roleBindings: { guard: 'character-a', guest: 'character-b' },
      narrationSettings: { enabled: false, speechEnabled: false },
      progress,
    })), ['character-a', 'character-b'])

    expect(restored.progress).toBeDefined()
    const restoredProgress = restored.progress!
    expect(restoredProgress).toEqual(progress)
    expect(restoredProgress).not.toBe(progress)
    expect(restoredProgress.history).not.toBe(progress.history)
    expect(restoredProgress.history[0]).not.toBe(progress.history[0])
  })

  it('requires complete one-to-one bindings to current participants', () => {
    const state = {
      templateSnapshot: template(),
      roleBindings: { guard: 'character-a', guest: 'character-b' },
      narrationSettings: { enabled: true, speechEnabled: false, styleDescription: 'Measured.' },
    }
    expect(parseGroupRoomScriptState(state, ['character-a', 'character-b']).roleBindings).toEqual(state.roleBindings)
    expect(() => parseGroupRoomScriptState({ ...state, roleBindings: { guard: 'character-a' } }, ['character-a', 'character-b'])).toThrow('exactly one')
    expect(() => parseGroupRoomScriptState({ ...state, roleBindings: { guard: 'character-a', guest: 'character-a' } }, ['character-a', 'character-b'])).toThrow('one-to-one')
    expect(() => parseGroupRoomScriptState(state, ['character-a', 'character-c'])).toThrow('one-to-one')
  })

  it('rejects prototype-polluting binding keys', () => {
    const bindings = JSON.parse('{"guard":"character-a","guest":"character-b","__proto__":"polluted"}')
    expect(() => parseGroupRoomScriptState({
      templateSnapshot: template(),
      roleBindings: bindings,
      narrationSettings: { enabled: false, speechEnabled: false },
    }, ['character-a', 'character-b'])).toThrow('Unsafe')
  })

  it('exposes only the current role and its public directed relationships', () => {
    const state = parseGroupRoomScriptState({
      templateSnapshot: template({
        background: 'A public station.',
        mentionGuidance: 'Mentions are only conversational focus.',
        narrationStyleDefault: 'Private narrator style.',
        slots: [
          { slotId: 'guard', name: 'Guard', description: 'Current role description.' },
          { slotId: 'guest', name: 'Guest', description: 'Must stay private from the guard.' },
          { slotId: 'observer', name: 'Observer', description: 'Unrelated private description.' },
        ],
        relationships: [
          { fromSlotId: 'guard', toSlotId: 'guest', description: 'Guard distrusts Guest.' },
          { fromSlotId: 'guest', toSlotId: 'guard', description: 'Guest relies on Guard.' },
          { fromSlotId: 'observer', toSlotId: 'guard', description: 'Observer watches Guard.' },
          { fromSlotId: 'guest', toSlotId: 'observer', description: 'Unrelated relationship.' },
        ],
      }),
      roleBindings: { guard: 'character-a', guest: 'character-b', observer: 'character-c' },
      narrationSettings: { enabled: true, speechEnabled: true, styleDescription: 'Private room narrator.', speech: { providerId: 'p', modelId: 'm', voiceId: 'v' } },
    }, ['character-a', 'character-b', 'character-c'])

    const context = buildGroupScriptSpeakerContext(state, 'character-a', [
      { characterId: 'character-a', displayName: 'Alice' },
      { characterId: 'character-b', displayName: 'Bob' },
      // Deliberately omit C: a relation is visible only when the other endpoint
      // is still bound to a current room member.
    ])

    expect(context).toMatchObject({
      title: 'Night shift',
      role: { name: 'Guard', description: 'Current role description.' },
      relationships: [
        {
          direction: 'from-current',
          otherMember: { characterId: 'character-b', displayName: 'Bob' },
          description: 'Guard distrusts Guest.',
        },
        {
          direction: 'to-current',
          otherMember: { characterId: 'character-b', displayName: 'Bob' },
          description: 'Guest relies on Guard.',
        },
      ],
    })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain('Must stay private from the guard.')
    expect(serialized).not.toContain('Unrelated private description.')
    expect(serialized).not.toContain('Unrelated relationship.')
    expect(serialized).not.toContain('Private narrator style.')
    expect(serialized).not.toContain('Private room narrator.')
    expect(serialized).not.toContain('roleBindings')
  })

  it('freezes public script roles for every room member', () => {
    const state = parseGroupRoomScriptState({
      templateSnapshot: template(),
      roleBindings: { guard: 'character-a', guest: 'character-b' },
      narrationSettings: { enabled: false, speechEnabled: false },
    }, ['character-a', 'character-b'])

    expect(buildGroupScriptRoomMembers(state, [
      { characterId: 'character-a', displayName: 'Alice' },
      { characterId: 'character-b', displayName: 'Bob' },
    ])).toEqual([
      { characterId: 'character-a', displayName: 'Alice', roleDescription: 'Keeps watch.', roleName: 'Guard' },
      { characterId: 'character-b', displayName: 'Bob', roleDescription: 'Arrived late.', roleName: 'Guest' },
    ])
  })

  it('freezes every public room relationship for narration', () => {
    const state = parseGroupRoomScriptState({
      templateSnapshot: template({
        slots: [
          { slotId: 'guard', name: 'Guard' },
          { slotId: 'guest', name: 'Guest' },
          { slotId: 'observer', name: 'Observer' },
        ],
        relationships: [
          { fromSlotId: 'guard', toSlotId: 'guest', description: 'Distrusts them.' },
          { fromSlotId: 'guest', toSlotId: 'observer', description: 'Asks for help.' },
        ],
      }),
      roleBindings: { guard: 'character-a', guest: 'character-b', observer: 'character-c' },
      narrationSettings: { enabled: true, speechEnabled: false },
    }, ['character-a', 'character-b', 'character-c'])

    expect(buildGroupScriptRoomRelationships(state, [
      { characterId: 'character-a', displayName: 'Alice' },
      { characterId: 'character-b', displayName: 'Bob' },
      { characterId: 'character-c', displayName: 'Carol' },
    ])).toEqual([
      {
        description: 'Distrusts them.',
        fromCharacterId: 'character-a',
        fromMemberName: 'Alice',
        toCharacterId: 'character-b',
        toMemberName: 'Bob',
      },
      {
        description: 'Asks for help.',
        fromCharacterId: 'character-b',
        fromMemberName: 'Bob',
        toCharacterId: 'character-c',
        toMemberName: 'Carol',
      },
    ])
  })
})
