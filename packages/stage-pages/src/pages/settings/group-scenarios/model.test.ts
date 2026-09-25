import { describe, expect, it } from 'vitest'

import {
  createEmptyGroupScript,
  createRoomScriptFromTemplate,
  decodeGroupScript,
  encodeGroupScript,
  GROUP_SCRIPT_STORAGE_KEY,
  loadGroupScripts,
  parseGroupScript,
  saveGroupScripts,
} from './model'

function template() {
  return parseGroupScript({
    format: 'airi-group-script:v1',
    id: 'night-shift',
    title: 'Night shift',
    rules: [],
    slots: [
      { slotId: 'guard', name: 'Guard' },
      { slotId: 'guest', name: 'Guest' },
    ],
    relationships: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

function createMemoryStorage(values = new Map<string, string>()): Storage {
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('group script template library', () => {
  it('creates a translated v1 template with one safe slot and no card binding', () => {
    const created = createEmptyGroupScript({ title: 'Untitled', slotName: 'Role 1', now: 123 })
    expect(created).toMatchObject({
      format: 'airi-group-script:v1',
      id: 'script-123',
      title: 'Untitled',
      slots: [{ slotId: 'role-1', name: 'Role 1' }],
    })
    expect(JSON.stringify(created)).not.toMatch(/characterId|roleBindings|providerId|voiceId/)
  })

  it('round-trips only the portable template and rejects the legacy format', () => {
    const portable = template()
    expect(decodeGroupScript(encodeGroupScript(portable))).toEqual(portable)
    expect(() => decodeGroupScript(JSON.stringify({ ...portable, format: 'airi-group-scenario:v1' }))).toThrow()
  })

  it('uses only the new storage key and strictly revalidates each entry', () => {
    const values = new Map<string, string>()
    const storage = createMemoryStorage(values)
    values.set('airi.group-scenarios.v1', JSON.stringify([template()]))
    expect(loadGroupScripts(storage)).toEqual([])

    saveGroupScripts([template()], storage)
    expect(values.has(GROUP_SCRIPT_STORAGE_KEY)).toBe(true)
    values.set(GROUP_SCRIPT_STORAGE_KEY, JSON.stringify([template(), { ...template(), systemPrompt: 'forbidden' }]))
    expect(loadGroupScripts(storage)).toEqual([template()])
  })

  it('enforces the UTF-8 64 KiB limit for every stored template on load and save', () => {
    const oversized = parseGroupScript({
      ...template(),
      background: '剧'.repeat(12_000),
      premise: '情'.repeat(8_000),
      currentScene: '景'.repeat(8_000),
    })
    const values = new Map<string, string>()
    const storage = createMemoryStorage(values)

    expect(() => saveGroupScripts([oversized], storage)).toThrow('64 KiB')
    values.set(GROUP_SCRIPT_STORAGE_KEY, JSON.stringify([oversized]))
    expect(loadGroupScripts(storage)).toEqual([])
  })

  it('copies a template into an independent room snapshot with complete bindings', () => {
    const portable = template()
    const roomState = createRoomScriptFromTemplate({
      template: portable,
      participantIds: ['character-a', 'character-b'],
    })
    portable.title = 'Edited later'

    expect(roomState.templateSnapshot.title).toBe('Night shift')
    expect(roomState.roleBindings).toEqual({ guard: 'character-a', guest: 'character-b' })
    expect(() => createRoomScriptFromTemplate({
      template: template(),
      participantIds: ['character-a'],
    })).toThrow('slot count')
  })
})
