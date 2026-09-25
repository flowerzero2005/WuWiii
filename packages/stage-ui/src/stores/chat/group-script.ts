import type { InferOutput } from 'valibot'

import {
  array,
  boolean,
  finite,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  pipe,
  record,
  regex,
  safeParse,
  strictObject,
  string,
} from 'valibot'

export const GROUP_SCRIPT_FORMAT = 'airi-group-script:v1' as const
export const GROUP_SCRIPT_MAX_JSON_BYTES = 64 * 1024

const SAFE_ID_PATTERN = /^[a-z0-9][\w-]{0,127}$/i
const SAFE_SLOT_ID_PATTERN = /^[a-z0-9][\w-]{0,63}$/i
const DANGEROUS_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const BoundedTimestampSchema = pipe(
  number(),
  finite(),
  integer(),
  minValue(0),
  maxValue(Number.MAX_SAFE_INTEGER),
)

const SlotSchema = strictObject({
  slotId: pipe(string(), minLength(1), maxLength(64), regex(SAFE_SLOT_ID_PATTERN)),
  name: pipe(string(), minLength(1), maxLength(120)),
  description: optional(pipe(string(), maxLength(4_000))),
})

const RelationshipSchema = strictObject({
  fromSlotId: pipe(string(), minLength(1), maxLength(64), regex(SAFE_SLOT_ID_PATTERN)),
  toSlotId: pipe(string(), minLength(1), maxLength(64), regex(SAFE_SLOT_ID_PATTERN)),
  description: optional(pipe(string(), maxLength(2_000))),
})

export const GroupScriptSchema = strictObject({
  format: literal(GROUP_SCRIPT_FORMAT),
  id: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
  title: pipe(string(), minLength(1), maxLength(200)),
  summary: optional(pipe(string(), maxLength(2_000))),
  background: optional(pipe(string(), maxLength(12_000))),
  premise: optional(pipe(string(), maxLength(8_000))),
  currentScene: optional(pipe(string(), maxLength(8_000))),
  rules: pipe(array(pipe(string(), minLength(1), maxLength(1_000))), maxLength(24)),
  mentionGuidance: optional(pipe(string(), maxLength(2_000))),
  narrationStyleDefault: optional(pipe(string(), maxLength(2_000))),
  slots: pipe(array(SlotSchema), minLength(1), maxLength(4)),
  relationships: pipe(array(RelationshipSchema), maxLength(24)),
  createdAt: BoundedTimestampSchema,
  updatedAt: BoundedTimestampSchema,
})

const NarrationSpeechSchema = strictObject({
  providerId: pipe(string(), minLength(1), maxLength(200)),
  modelId: pipe(string(), minLength(1), maxLength(200)),
  voiceId: pipe(string(), minLength(1), maxLength(200)),
  language: optional(pipe(string(), minLength(1), maxLength(40))),
})

const NarrationSettingsSchema = strictObject({
  enabled: boolean(),
  speechEnabled: boolean(),
  styleDescription: optional(pipe(string(), maxLength(2_000))),
  speech: optional(NarrationSpeechSchema),
})

const GroupRoomScriptStateSchema = strictObject({
  templateSnapshot: GroupScriptSchema,
  roleBindings: record(string(), pipe(string(), minLength(1), maxLength(200))),
  narrationSettings: NarrationSettingsSchema,
})

export type GroupScriptTemplate = InferOutput<typeof GroupScriptSchema>
export type GroupRoomNarrationSettings = InferOutput<typeof NarrationSettingsSchema>
export type GroupRoomScriptState = InferOutput<typeof GroupRoomScriptStateSchema>

export interface GroupScriptRoomMember {
  characterId: string
  displayName: string
}

export interface GroupScriptRoomMemberSnapshot extends GroupScriptRoomMember {
  roleDescription?: string
  roleName?: string
}

export interface GroupScriptRoomRelationshipSnapshot {
  description?: string
  fromCharacterId: string
  fromMemberName: string
  toCharacterId: string
  toMemberName: string
}

export interface GroupScriptSpeakerContext {
  title: string
  summary?: string
  background?: string
  premise?: string
  currentScene?: string
  rules: string[]
  mentionGuidance?: string
  role: {
    name: string
    description?: string
  }
  relationships: Array<{
    direction: 'from-current' | 'to-current'
    otherMember: GroupScriptRoomMember
    description?: string
  }>
}

function fail(message: string): never {
  throw new Error(message)
}

function assertJsonSize(text: string) {
  if (new TextEncoder().encode(text).byteLength > GROUP_SCRIPT_MAX_JSON_BYTES)
    fail('Group script JSON exceeds the 64 KiB limit.')
}

function validateTemplateRelations(template: GroupScriptTemplate) {
  if (template.updatedAt < template.createdAt)
    fail('Group script updatedAt must not be earlier than createdAt.')

  const slotIds = new Set<string>()
  for (const slot of template.slots) {
    if (DANGEROUS_RECORD_KEYS.has(slot.slotId))
      fail(`Unsafe group script slot ID: ${slot.slotId}`)
    if (slotIds.has(slot.slotId))
      fail(`Duplicate group script slot ID: ${slot.slotId}`)
    slotIds.add(slot.slotId)
  }

  for (const relationship of template.relationships) {
    if (relationship.fromSlotId === relationship.toSlotId)
      fail(`Group script relationship cannot point to itself: ${relationship.fromSlotId}`)
    if (!slotIds.has(relationship.fromSlotId) || !slotIds.has(relationship.toSlotId))
      fail('Group script relationship references an unknown slot.')
  }
}

export function parseGroupScript(value: unknown): GroupScriptTemplate {
  const parsed = safeParse(GroupScriptSchema, value)
  if (!parsed.success)
    fail('Invalid airi-group-script:v1 template.')

  validateTemplateRelations(parsed.output)
  return parsed.output
}

export function encodeGroupScript(value: unknown) {
  const text = JSON.stringify(parseGroupScript(value), null, 2)
  assertJsonSize(text)
  return text
}

export function decodeGroupScript(text: string) {
  assertJsonSize(text)
  try {
    return parseGroupScript(JSON.parse(text))
  }
  catch (error) {
    if (error instanceof SyntaxError)
      fail('Group script import is not valid JSON.')
    throw error
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function rebuildBindings(value: unknown) {
  if (!isPlainRecord(value))
    fail('Group script role bindings must be a plain object.')

  const bindings: Record<string, string> = Object.create(null)
  for (const key of Object.keys(value)) {
    if (DANGEROUS_RECORD_KEYS.has(key) || !SAFE_SLOT_ID_PATTERN.test(key))
      fail(`Unsafe group script binding key: ${key}`)
    const characterId = value[key]
    if (typeof characterId !== 'string' || !characterId.trim() || characterId.length > 200)
      fail(`Invalid character binding for slot: ${key}`)
    bindings[key] = characterId.trim()
  }
  return bindings
}

/** Validates a persisted room snapshot against the room's current participants. */
export function parseGroupRoomScriptState(value: unknown, participantIds: string[]): GroupRoomScriptState {
  if (!isPlainRecord(value))
    fail('Invalid group room script state.')

  // Normalize snapshots created before narration settings were introduced.
  // Parsing used to reject the whole room when this optional feature was
  // absent, which surfaced in the UI as a misleading narration save error.
  const rawNarration = isPlainRecord(value.narrationSettings)
    ? value.narrationSettings
    : {}
  const candidate = {
    ...value,
    roleBindings: rebuildBindings(value.roleBindings),
    narrationSettings: {
      enabled: rawNarration.enabled === true,
      speechEnabled: rawNarration.speechEnabled === true,
      styleDescription: typeof rawNarration.styleDescription === 'string'
        ? rawNarration.styleDescription
        : undefined,
      speech: rawNarration.speech,
    },
  }
  const parsed = safeParse(GroupRoomScriptStateSchema, candidate)
  if (!parsed.success)
    fail('Invalid group room script state.')

  validateTemplateRelations(parsed.output.templateSnapshot)

  const expectedSlotIds = parsed.output.templateSnapshot.slots.map(slot => slot.slotId)
  const bindingSlotIds = Object.keys(parsed.output.roleBindings)
  if (bindingSlotIds.length !== expectedSlotIds.length
    || expectedSlotIds.some(slotId => !Object.hasOwn(parsed.output.roleBindings, slotId))) {
    fail('Every group script slot must have exactly one role binding.')
  }

  const normalizedParticipantIds = participantIds.map(id => id.trim()).filter(Boolean)
  const uniqueParticipantIds = new Set(normalizedParticipantIds)
  const boundCharacterIds = Object.values(parsed.output.roleBindings)
  if (uniqueParticipantIds.size !== normalizedParticipantIds.length
    || new Set(boundCharacterIds).size !== boundCharacterIds.length
    || boundCharacterIds.length !== normalizedParticipantIds.length
    || boundCharacterIds.some(characterId => !uniqueParticipantIds.has(characterId))) {
    fail('Group script role bindings must match the current room participants one-to-one.')
  }

  return {
    templateSnapshot: parsed.output.templateSnapshot,
    roleBindings: rebuildBindings(parsed.output.roleBindings),
    narrationSettings: parsed.output.narrationSettings,
  }
}

export function createDefaultGroupRoomNarrationSettings(template?: GroupScriptTemplate): GroupRoomNarrationSettings {
  return {
    enabled: false,
    speechEnabled: false,
    styleDescription: template?.narrationStyleDefault,
  }
}

/** Reduces a validated room snapshot to the public context one speaker may see. */
export function buildGroupScriptSpeakerContext(
  state: GroupRoomScriptState,
  characterId: string,
  roomMembers: GroupScriptRoomMember[],
): GroupScriptSpeakerContext | undefined {
  const currentSlotId = Object.entries(state.roleBindings)
    .find(([, boundCharacterId]) => boundCharacterId === characterId)?.[0]
  const currentSlot = state.templateSnapshot.slots.find(slot => slot.slotId === currentSlotId)
  if (!currentSlot)
    return undefined

  const currentMembers = new Map(roomMembers.map(member => [member.characterId, member]))
  const relationships: GroupScriptSpeakerContext['relationships'] = []
  for (const relationship of state.templateSnapshot.relationships) {
    const direction = relationship.fromSlotId === currentSlot.slotId
      ? 'from-current'
      : relationship.toSlotId === currentSlot.slotId
        ? 'to-current'
        : undefined
    if (!direction)
      continue

    const otherSlotId = direction === 'from-current' ? relationship.toSlotId : relationship.fromSlotId
    const otherCharacterId = state.roleBindings[otherSlotId]
    const otherMember = otherCharacterId ? currentMembers.get(otherCharacterId) : undefined
    if (!otherMember)
      continue

    relationships.push({
      direction,
      otherMember: { characterId: otherMember.characterId, displayName: otherMember.displayName },
      description: relationship.description,
    })
  }

  const template = state.templateSnapshot
  return {
    title: template.title,
    summary: template.summary,
    background: template.background,
    premise: template.premise,
    currentScene: template.currentScene,
    rules: [...template.rules],
    mentionGuidance: template.mentionGuidance,
    role: { name: currentSlot.name, description: currentSlot.description },
    relationships,
  }
}

/** Freezes every room member's public script identity for one group turn. */
export function buildGroupScriptRoomMembers(
  state: GroupRoomScriptState,
  roomMembers: GroupScriptRoomMember[],
): GroupScriptRoomMemberSnapshot[] {
  const slots = new Map(state.templateSnapshot.slots.map(slot => [slot.slotId, slot]))
  const rolesByCharacter = new Map(Object.entries(state.roleBindings).flatMap(([slotId, characterId]) => {
    const slot = slots.get(slotId)
    return slot ? [[characterId, slot] as const] : []
  }))

  return roomMembers.map((member) => {
    const role = rolesByCharacter.get(member.characterId)
    return {
      ...member,
      roleDescription: role?.description,
      roleName: role?.name,
    }
  })
}

/** Freezes all public directed relationships for the room narrator. */
export function buildGroupScriptRoomRelationships(
  state: GroupRoomScriptState,
  roomMembers: GroupScriptRoomMember[],
): GroupScriptRoomRelationshipSnapshot[] {
  const members = new Map(roomMembers.map(member => [member.characterId, member]))

  return state.templateSnapshot.relationships.flatMap((relationship) => {
    const fromCharacterId = state.roleBindings[relationship.fromSlotId]
    const toCharacterId = state.roleBindings[relationship.toSlotId]
    if (!fromCharacterId || !toCharacterId)
      return []

    const fromMember = members.get(fromCharacterId)
    const toMember = members.get(toCharacterId)
    if (!fromMember || !toMember)
      return []

    return [{
      description: relationship.description,
      fromCharacterId,
      fromMemberName: fromMember.displayName,
      toCharacterId,
      toMemberName: toMember.displayName,
    }]
  })
}
