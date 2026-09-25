import type { GroupRoomScriptState } from './model'

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createRoomScriptFromTemplate, parseGroupScript } from './model'
import { GROUP_SCRIPT_ROUTE_KEYS, reassignRoomCast, resolveRoomScriptForRequest } from './page-helpers'

function template() {
  return parseGroupScript({
    format: 'airi-group-script:v1',
    id: 'rehearsal',
    title: 'Rehearsal',
    rules: [],
    slots: [
      { slotId: 'lead', name: 'Lead' },
      { slotId: 'witness', name: 'Witness' },
    ],
    relationships: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

describe('group script page helpers', () => {
  it('keeps the room snapshot independent from later template edits', () => {
    const source = template()
    const room = createRoomScriptFromTemplate({ template: source, participantIds: ['a', 'b'] })
    source.slots[0].name = 'Changed'
    expect(room.templateSnapshot.slots[0].name).toBe('Lead')
  })

  it('swaps cast assignments so bindings remain a complete bijection', () => {
    expect(reassignRoomCast({ lead: 'a', witness: 'b' }, 'lead', 'b')).toEqual({ lead: 'b', witness: 'a' })
  })

  it('drops a slow room result after a newer selection revision starts', async () => {
    let revision = 1
    let finish!: (value: GroupRoomScriptState | undefined) => void
    const pending = resolveRoomScriptForRequest({
      requestRevision: revision,
      currentRevision: () => revision,
      resolve: () => new Promise(resolve => finish = resolve),
    })

    revision = 2
    finish(createRoomScriptFromTemplate({ template: template(), participantIds: ['a', 'b'] }))
    await expect(pending).resolves.toBeUndefined()
  })

  it('keeps route metadata and both locales on the group-scripts key tree', () => {
    const page = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
    const zh = readFileSync(new URL('../../../../../i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')
    const en = readFileSync(new URL('../../../../../i18n/src/locales/en/settings.yaml', import.meta.url), 'utf8')

    expect(page).toContain(`titleKey: ${GROUP_SCRIPT_ROUTE_KEYS.title}`)
    expect(page).toContain(`descriptionKey: ${GROUP_SCRIPT_ROUTE_KEYS.description}`)
    expect(zh).toContain('  group-scripts:')
    expect(en).toContain('  group-scripts:')
  })
})
