import { describe, expect, it } from 'vitest'

import {
  buildGroupScriptRoomMembers,
  buildGroupScriptRoomRelationships,
  buildGroupScriptSpeakerContext,
  decodeGroupScript,
  encodeGroupScript,
  GROUP_SCRIPT_FORMAT,
  parseGroupRoomScriptState,
  parseGroupScript,
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
