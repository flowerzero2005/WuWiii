import type { GroupRoomNarrationSettings, GroupRoomScriptState, GroupScriptTemplate } from '@proj-airi/stage-ui/stores/chat/group-script'

import {
  decodeGroupScript,
  encodeGroupScript,
  GROUP_SCRIPT_FORMAT,
  parseGroupRoomScriptState,
  parseGroupScript,
} from '@proj-airi/stage-ui/stores/chat/group-script'

export const GROUP_SCRIPT_STORAGE_KEY = 'airi.group-scripts.v1'

export type { GroupRoomNarrationSettings, GroupRoomScriptState, GroupScriptTemplate }
export { decodeGroupScript, encodeGroupScript, GROUP_SCRIPT_FORMAT, parseGroupRoomScriptState, parseGroupScript }

export function createEmptyGroupScript(input: {
  title: string
  slotName: string
  now?: number
}): GroupScriptTemplate {
  const now = input.now ?? Date.now()
  return parseGroupScript({
    format: GROUP_SCRIPT_FORMAT,
    id: `script-${now}`,
    title: input.title,
    summary: '',
    background: '',
    premise: '',
    currentScene: '',
    rules: [],
    mentionGuidance: '',
    narrationStyleDefault: '',
    slots: [{ slotId: 'role-1', name: input.slotName, description: '' }],
    relationships: [],
    createdAt: now,
    updatedAt: now,
  })
}

/** Creates an independent room snapshot; later template edits cannot mutate it. */
export function createRoomScriptFromTemplate(input: {
  template: GroupScriptTemplate
  participantIds: string[]
  narrationSettings?: GroupRoomNarrationSettings
}): GroupRoomScriptState {
  const templateSnapshot = decodeGroupScript(encodeGroupScript(input.template))
  if (templateSnapshot.slots.length !== input.participantIds.length)
    throw new Error('Group script slot count must match the room participant count.')

  return parseGroupRoomScriptState({
    templateSnapshot,
    roleBindings: Object.fromEntries(templateSnapshot.slots.map((slot, index) => [slot.slotId, input.participantIds[index]])),
    narrationSettings: input.narrationSettings ?? {
      enabled: false,
      speechEnabled: false,
      styleDescription: templateSnapshot.narrationStyleDefault,
    },
  }, input.participantIds)
}

export function loadGroupScripts(storage: Storage | undefined = globalThis.localStorage) {
  if (!storage)
    return []
  try {
    const raw = storage.getItem(GROUP_SCRIPT_STORAGE_KEY)
    if (!raw)
      return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value))
      return []
    return value.flatMap((item) => {
      try {
        return [decodeGroupScript(JSON.stringify(item))]
      }
      catch {
        return []
      }
    })
  }
  catch {
    return []
  }
}

export function saveGroupScripts(templates: GroupScriptTemplate[], storage: Storage | undefined = globalThis.localStorage) {
  if (!storage)
    return
  const validatedTemplates = templates.map(template => decodeGroupScript(encodeGroupScript(template)))
  storage.setItem(GROUP_SCRIPT_STORAGE_KEY, JSON.stringify(validatedTemplates))
}
