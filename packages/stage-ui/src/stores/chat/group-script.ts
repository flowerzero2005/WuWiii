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
  picklist,
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

/**
 * A condition describes an outcome to verify from a conversation. It deliberately
 * contains no keyword list: later evaluators must return structured evidence for
 * the semantic outcome, and the local progress reducer validates that evidence.
 */
const GroupScriptActUnlockConditionSchema = strictObject({
  conditionId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
  description: pipe(string(), minLength(1), maxLength(2_000)),
  minConfidence: optional(pipe(number(), finite(), minValue(0), maxValue(1))),
  minEvidenceCount: optional(pipe(number(), integer(), minValue(1), maxValue(8))),
})

const GroupScriptActSchema = strictObject({
  actId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
  number: pipe(number(), integer(), minValue(1), maxValue(1_000)),
  title: pipe(string(), minLength(1), maxLength(200)),
  narration: optional(pipe(string(), maxLength(8_000))),
  goal: optional(pipe(string(), maxLength(4_000))),
  visibility: optional(picklist(['visible', 'hidden'])),
  unlockConditions: pipe(array(GroupScriptActUnlockConditionSchema), maxLength(12)),
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
  // Optional keeps templates saved before chapters were introduced readable.
  acts: optional(pipe(array(GroupScriptActSchema), maxLength(64))),
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

export const GroupScriptActConditionEvidenceSchema = strictObject({
  conditionId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
  satisfied: boolean(),
  confidence: pipe(number(), finite(), minValue(0), maxValue(1)),
  messageIds: pipe(array(pipe(string(), minLength(1), maxLength(200))), maxLength(8)),
  summary: optional(pipe(string(), maxLength(2_000))),
})

const GroupScriptProgressEvidenceSchema = strictObject({
  actId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
  evaluationTurnId: pipe(string(), minLength(1), maxLength(200)),
  evaluatedAt: BoundedTimestampSchema,
  conditions: pipe(array(GroupScriptActConditionEvidenceSchema), minLength(1), maxLength(12)),
})

const GroupScriptProgressSnapshotSchema = strictObject({
  revision: pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER)),
  action: picklist(['initialize', 'advance', 'rollback', 'restart', 'extend']),
  operationId: optional(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))),
  changedAt: BoundedTimestampSchema,
  currentActId: optional(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))),
  unlockedActIds: pipe(array(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))), maxLength(64)),
  completedActIds: pipe(array(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))), maxLength(64)),
  evidence: array(GroupScriptProgressEvidenceSchema),
  isComplete: boolean(),
})

const GroupScriptProgressSchema = strictObject({
  revision: pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER)),
  currentActId: optional(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))),
  unlockedActIds: pipe(array(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))), maxLength(64)),
  completedActIds: pipe(array(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))), maxLength(64)),
  evidence: array(GroupScriptProgressEvidenceSchema),
  isComplete: boolean(),
  history: pipe(array(GroupScriptProgressSnapshotSchema), minLength(1)),
})

const GroupScriptChapterSettingsSchema = strictObject({
  automaticEvaluationEnabled: boolean(),
  sequelGenerationEnabled: boolean(),
  maxGeneratedActs: pipe(number(), integer(), minValue(1), maxValue(8)),
  showActNarration: boolean(),
})

export const GroupScriptSequelActSchema = strictObject({
  act: GroupScriptActSchema,
  roleSlotIds: pipe(array(pipe(string(), minLength(1), maxLength(64))), minLength(1), maxLength(4)),
  afterActId: pipe(string(), minLength(1), maxLength(128)),
  prerequisiteActIds: pipe(array(pipe(string(), minLength(1), maxLength(128))), minLength(1), maxLength(64)),
})

export const GroupScriptSequelDraftSchema = strictObject({
  requestId: pipe(string(), minLength(1), maxLength(200)),
  basisTemplateUpdatedAt: BoundedTimestampSchema,
  basisProgressRevision: pipe(number(), integer(), minValue(0)),
  generatedAt: BoundedTimestampSchema,
  summary: pipe(string(), minLength(1), maxLength(2_000)),
  acts: pipe(array(GroupScriptSequelActSchema), minLength(1), maxLength(8)),
})

const GroupScriptChapterRuntimeSchema = strictObject({
  narrationEpoch: optional(pipe(number(), integer(), minValue(0))),
  narratedRevision: optional(pipe(number(), integer(), minValue(0))),
  evaluations: array(strictObject({
    turnId: pipe(string(), minLength(1), maxLength(200)),
    actId: pipe(string(), minLength(1), maxLength(128)),
    evaluatedAt: BoundedTimestampSchema,
    result: picklist(['advanced', 'unmet', 'failed']),
    conditions: array(GroupScriptActConditionEvidenceSchema),
  })),
  pendingJob: optional(strictObject({
    kind: picklist(['evaluation', 'sequel']),
    turnId: pipe(string(), minLength(1), maxLength(200)),
    requestId: pipe(string(), minLength(1), maxLength(200)),
    operationId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
    expiresAt: BoundedTimestampSchema,
    progressRevision: pipe(number(), integer(), minValue(0)),
  })),
  sequelDraft: optional(GroupScriptSequelDraftSchema),
})

const GroupRoomScriptStateSchema = strictObject({
  templateSnapshot: GroupScriptSchema,
  roleBindings: record(string(), pipe(string(), minLength(1), maxLength(200))),
  narrationSettings: NarrationSettingsSchema,
  progress: optional(GroupScriptProgressSchema),
  chapterSettings: optional(GroupScriptChapterSettingsSchema),
  chapterRuntime: optional(GroupScriptChapterRuntimeSchema),
})

export type GroupScriptTemplate = InferOutput<typeof GroupScriptSchema>
export type GroupRoomNarrationSettings = InferOutput<typeof NarrationSettingsSchema>
export type GroupScriptAct = InferOutput<typeof GroupScriptActSchema>
export type GroupScriptActUnlockCondition = InferOutput<typeof GroupScriptActUnlockConditionSchema>
export type GroupScriptActConditionEvidence = InferOutput<typeof GroupScriptActConditionEvidenceSchema>
export type GroupScriptProgressEvidence = InferOutput<typeof GroupScriptProgressEvidenceSchema>
export type GroupScriptProgressSnapshot = InferOutput<typeof GroupScriptProgressSnapshotSchema>
export type GroupScriptProgress = InferOutput<typeof GroupScriptProgressSchema>
export type GroupRoomScriptState = InferOutput<typeof GroupRoomScriptStateSchema>
export type GroupScriptChapterSettings = InferOutput<typeof GroupScriptChapterSettingsSchema>
export type GroupScriptChapterRuntime = InferOutput<typeof GroupScriptChapterRuntimeSchema>
export type GroupScriptSequelAct = InferOutput<typeof GroupScriptSequelActSchema>
export type GroupScriptSequelDraft = InferOutput<typeof GroupScriptSequelDraftSchema>

export const DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS: GroupScriptChapterSettings = {
  automaticEvaluationEnabled: false,
  sequelGenerationEnabled: false,
  maxGeneratedActs: 2,
  showActNarration: true,
}

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

  const acts = template.acts ?? []
  const actIds = new Set<string>()
  for (const [index, act] of acts.entries()) {
    if (DANGEROUS_RECORD_KEYS.has(act.actId))
      fail(`Unsafe group script act ID: ${act.actId}`)
    if (actIds.has(act.actId))
      fail(`Duplicate group script act ID: ${act.actId}`)
    if (act.number !== index + 1)
      fail('Group script acts must use consecutive numbers starting at 1.')
    actIds.add(act.actId)

    const conditionIds = new Set<string>()
    for (const condition of act.unlockConditions) {
      if (DANGEROUS_RECORD_KEYS.has(condition.conditionId))
        fail(`Unsafe group script act condition ID: ${condition.conditionId}`)
      if (conditionIds.has(condition.conditionId))
        fail(`Duplicate group script act condition ID: ${condition.conditionId}`)
      conditionIds.add(condition.conditionId)
    }
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

function getTemplateActs(template: GroupScriptTemplate) {
  return template.acts ?? []
}

function cloneConditionEvidence(value: GroupScriptActConditionEvidence): GroupScriptActConditionEvidence {
  return {
    ...value,
    messageIds: [...value.messageIds],
  }
}

function cloneProgressEvidence(value: GroupScriptProgressEvidence): GroupScriptProgressEvidence {
  return {
    ...value,
    conditions: value.conditions.map(cloneConditionEvidence),
  }
}

function cloneProgressSnapshot(value: GroupScriptProgressSnapshot): GroupScriptProgressSnapshot {
  return {
    ...value,
    unlockedActIds: [...value.unlockedActIds],
    completedActIds: [...value.completedActIds],
    evidence: value.evidence.map(cloneProgressEvidence),
  }
}

function cloneGroupScriptProgress(value: GroupScriptProgress): GroupScriptProgress {
  return {
    ...value,
    unlockedActIds: [...value.unlockedActIds],
    completedActIds: [...value.completedActIds],
    evidence: value.evidence.map(cloneProgressEvidence),
    history: value.history.map(cloneProgressSnapshot),
  }
}

type GroupScriptProgressState = Omit<GroupScriptProgress, 'history'>

function toProgressSnapshot(
  progress: GroupScriptProgressState,
  action: GroupScriptProgressSnapshot['action'],
  changedAt: number,
  operationId?: string,
): GroupScriptProgressSnapshot {
  return {
    revision: progress.revision,
    action,
    operationId,
    changedAt,
    currentActId: progress.currentActId,
    unlockedActIds: [...progress.unlockedActIds],
    completedActIds: [...progress.completedActIds],
    evidence: progress.evidence.map(cloneProgressEvidence),
    isComplete: progress.isComplete,
  }
}

function assertActProgressShape(template: GroupScriptTemplate, progress: GroupScriptProgressState | GroupScriptProgressSnapshot, historical = false) {
  const acts = getTemplateActs(template)
  const actIds = acts.map(act => act.actId)
  const sameIds = (actual: string[], expected: string[]) => actual.length === expected.length
    && actual.every((actId, index) => actId === expected[index])

  if (acts.length === 0) {
    if (progress.currentActId !== undefined
      || progress.unlockedActIds.length !== 0
      || progress.completedActIds.length !== 0
      || progress.evidence.length !== 0
      || progress.isComplete) {
      fail('A group script without acts cannot have chapter progress.')
    }
    return
  }

  const currentIndex = progress.currentActId === undefined
    ? -1
    : actIds.indexOf(progress.currentActId)
  if (currentIndex < 0)
    fail('Group script progress references an unknown current act.')

  const expectedUnlocked = actIds.slice(0, currentIndex + 1)
  if (!sameIds(progress.unlockedActIds, expectedUnlocked))
    fail('Group script progress must unlock acts in order.')

  const expectedCompleted = progress.isComplete
    ? historical ? actIds.slice(0, currentIndex + 1) : actIds
    : actIds.slice(0, currentIndex)
  if (!sameIds(progress.completedActIds, expectedCompleted))
    fail('Group script progress must complete acts in order.')

  if (progress.isComplete && !historical && currentIndex !== acts.length - 1)
    fail('Only the final group script act can complete the story.')

  const evidenceActIds: string[] = []
  for (const evidence of progress.evidence) {
    const act = acts.find(candidate => candidate.actId === evidence.actId)
    if (!act)
      fail('Group script progress evidence references an unknown act.')
    evidenceActIds.push(act.actId)

    const conditionIds = new Set(act.unlockConditions.map(condition => condition.conditionId))
    const evidenceConditionIds = new Set<string>()
    for (const condition of evidence.conditions) {
      if (!conditionIds.has(condition.conditionId) || evidenceConditionIds.has(condition.conditionId))
        fail('Group script progress evidence references an invalid condition.')
      if (new Set(condition.messageIds).size !== condition.messageIds.length)
        fail('Group script progress evidence cannot repeat a message ID.')
      evidenceConditionIds.add(condition.conditionId)
    }
    if (evidenceConditionIds.size !== conditionIds.size)
      fail('Group script progress evidence must cover every unlock condition.')
  }
  if (!sameIds(evidenceActIds, expectedCompleted))
    fail('Group script progress evidence must match completed acts in order.')
}

function assertProgressHistory(template: GroupScriptTemplate, progress: GroupScriptProgress) {
  assertActProgressShape(template, progress)

  if (progress.history.length !== progress.revision + 1)
    fail('Group script progress revision history is incomplete.')

  const operationIds = new Set<string>()
  for (const [index, snapshot] of progress.history.entries()) {
    if (snapshot.revision !== index)
      fail('Group script progress revision history is out of order.')
    if (snapshot.operationId) {
      if (operationIds.has(snapshot.operationId))
        fail('Group script progress history repeats an operation ID.')
      operationIds.add(snapshot.operationId)
    }
    assertActProgressShape(template, snapshot, true)
  }

  const current = progress.history.at(-1)
  if (!current
    || current.revision !== progress.revision
    || current.currentActId !== progress.currentActId
    || current.isComplete !== progress.isComplete
    || JSON.stringify(current.unlockedActIds) !== JSON.stringify(progress.unlockedActIds)
    || JSON.stringify(current.completedActIds) !== JSON.stringify(progress.completedActIds)
    || JSON.stringify(current.evidence) !== JSON.stringify(progress.evidence)) {
    fail('Group script progress does not match its current revision.')
  }
}

/** Creates the first persisted revision for a template, including legacy templates with no acts. */
export function createInitialGroupScriptProgress(template: GroupScriptTemplate, initializedAt = template.updatedAt): GroupScriptProgress {
  const acts = getTemplateActs(template)
  const base: GroupScriptProgressState = {
    revision: 0,
    currentActId: acts[0]?.actId,
    unlockedActIds: acts[0] ? [acts[0].actId] : [],
    completedActIds: [],
    evidence: [],
    isComplete: false,
  }
  return {
    ...base,
    history: [toProgressSnapshot(base, 'initialize', initializedAt)],
  }
}

function normalizeGroupScriptProgress(value: unknown, template: GroupScriptTemplate): GroupScriptProgress {
  if (value === undefined)
    return createInitialGroupScriptProgress(template)

  const parsed = safeParse(GroupScriptProgressSchema, value)
  if (!parsed.success)
    fail('Invalid group script progress.')
  assertProgressHistory(template, parsed.output)
  return cloneGroupScriptProgress(parsed.output)
}

export interface AdvanceGroupScriptActInput {
  actId: string
  operationId: string
  evaluationTurnId: string
  evaluatedAt: number
  conditions: GroupScriptActConditionEvidence[]
}

export interface GroupScriptProgressCommand {
  operationId: string
  changedAt: number
}

export interface RestartGroupScriptActInput extends GroupScriptProgressCommand {
  /** Defaults to the active act. An earlier unlocked act can also be reopened. */
  actId?: string
}

export interface RollbackGroupScriptActInput extends GroupScriptProgressCommand {
  /** Defaults to the act immediately before the active act. */
  actId?: string
}

function parseAdvanceInput(value: AdvanceGroupScriptActInput): AdvanceGroupScriptActInput {
  const schema = strictObject({
    actId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
    operationId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
    evaluationTurnId: pipe(string(), minLength(1), maxLength(200)),
    evaluatedAt: BoundedTimestampSchema,
    conditions: pipe(array(GroupScriptActConditionEvidenceSchema), minLength(1), maxLength(12)),
  })
  const parsed = safeParse(schema, value)
  if (!parsed.success)
    fail('Invalid group script advance evaluation.')
  return parsed.output
}

function parseProgressCommand<T extends GroupScriptProgressCommand>(value: T, allowActId: boolean): T {
  const fields = {
    operationId: pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN)),
    changedAt: BoundedTimestampSchema,
  }
  const schema = allowActId
    ? strictObject({ ...fields, actId: optional(pipe(string(), minLength(1), maxLength(128), regex(SAFE_ID_PATTERN))) })
    : strictObject(fields)
  const parsed = safeParse(schema, value)
  if (!parsed.success)
    fail('Invalid group script progress command.')
  return parsed.output as T
}

function isRepeatedProgressOperation(progress: GroupScriptProgress, operationId: string) {
  return progress.history.some(snapshot => snapshot.operationId === operationId)
}

function appendProgressRevision(
  progress: GroupScriptProgress,
  next: GroupScriptProgressState,
  action: GroupScriptProgressSnapshot['action'],
  changedAt: number,
  operationId: string,
): GroupScriptProgress {
  const revision = progress.revision + 1
  const revisionState: GroupScriptProgressState = { ...next, revision }
  return {
    ...revisionState,
    history: [...progress.history.map(cloneProgressSnapshot), toProgressSnapshot(revisionState, action, changedAt, operationId)],
  }
}

/**
 * Advances exactly one act after a model (or a human reviewer) has supplied a
 * structured semantic evaluation. This reducer never interprets keywords.
 */
export function advanceGroupScriptAct(
  template: GroupScriptTemplate,
  progress: GroupScriptProgress,
  input: AdvanceGroupScriptActInput,
  availableMessageIds: Iterable<string>,
): GroupScriptProgress {
  assertProgressHistory(template, progress)
  const evaluation = parseAdvanceInput(input)
  if (isRepeatedProgressOperation(progress, evaluation.operationId) || progress.isComplete)
    return progress

  const acts = getTemplateActs(template)
  const currentAct = acts.find(act => act.actId === progress.currentActId)
  if (!currentAct || currentAct.actId !== evaluation.actId)
    return progress

  const expectedConditionIds = new Set(currentAct.unlockConditions.map(condition => condition.conditionId))
  const evidenceByCondition = new Map(evaluation.conditions.map(condition => [condition.conditionId, condition]))
  if (evidenceByCondition.size !== evaluation.conditions.length
    || evidenceByCondition.size !== expectedConditionIds.size
    || [...evidenceByCondition.keys()].some(conditionId => !expectedConditionIds.has(conditionId))) {
    fail('Group script advance evaluation must cover every current act condition exactly once.')
  }

  const knownMessageIds = new Set(availableMessageIds)
  for (const condition of currentAct.unlockConditions) {
    const evidence = evidenceByCondition.get(condition.conditionId)!
    const requiredConfidence = condition.minConfidence ?? 0.75
    const requiredEvidenceCount = condition.minEvidenceCount ?? 1
    if (!evidence.satisfied || evidence.confidence < requiredConfidence || evidence.messageIds.length < requiredEvidenceCount)
      return progress
    if (new Set(evidence.messageIds).size !== evidence.messageIds.length
      || evidence.messageIds.some(messageId => !knownMessageIds.has(messageId))) {
      fail('Group script advance evaluation references an unavailable message.')
    }
  }

  const evidence: GroupScriptProgressEvidence = {
    actId: currentAct.actId,
    evaluationTurnId: evaluation.evaluationTurnId,
    evaluatedAt: evaluation.evaluatedAt,
    conditions: evaluation.conditions.map(cloneConditionEvidence),
  }
  const currentIndex = acts.indexOf(currentAct)
  const nextAct = acts[currentIndex + 1]
  const next: GroupScriptProgressState = nextAct
    ? {
        revision: progress.revision,
        currentActId: nextAct.actId,
        unlockedActIds: [...progress.unlockedActIds, nextAct.actId],
        completedActIds: [...progress.completedActIds, currentAct.actId],
        evidence: [...progress.evidence.map(cloneProgressEvidence), evidence],
        isComplete: false,
      }
    : {
        revision: progress.revision,
        currentActId: currentAct.actId,
        unlockedActIds: [...progress.unlockedActIds],
        completedActIds: [...progress.completedActIds, currentAct.actId],
        evidence: [...progress.evidence.map(cloneProgressEvidence), evidence],
        isComplete: true,
      }
  return appendProgressRevision(progress, next, 'advance', evaluation.evaluatedAt, evaluation.operationId)
}

function reopenGroupScriptAct(
  template: GroupScriptTemplate,
  progress: GroupScriptProgress,
  targetActId: string,
  action: 'rollback' | 'restart',
  command: GroupScriptProgressCommand,
): GroupScriptProgress {
  const acts = getTemplateActs(template)
  const targetIndex = acts.findIndex(act => act.actId === targetActId)
  const currentIndex = acts.findIndex(act => act.actId === progress.currentActId)
  if (targetIndex < 0 || currentIndex < 0 || targetIndex > currentIndex)
    return progress

  const next: GroupScriptProgressState = {
    revision: progress.revision,
    currentActId: targetActId,
    unlockedActIds: acts.slice(0, targetIndex + 1).map(act => act.actId),
    completedActIds: acts.slice(0, targetIndex).map(act => act.actId),
    // Evidence for facts established before the reopened act remains visible.
    evidence: progress.evidence
      .filter(entry => acts.findIndex(act => act.actId === entry.actId) < targetIndex)
      .map(cloneProgressEvidence),
    isComplete: false,
  }
  const sameState = next.currentActId === progress.currentActId
    && !progress.isComplete
    && JSON.stringify(next.unlockedActIds) === JSON.stringify(progress.unlockedActIds)
    && JSON.stringify(next.completedActIds) === JSON.stringify(progress.completedActIds)
    && JSON.stringify(next.evidence) === JSON.stringify(progress.evidence)
  if (sameState && action !== 'restart')
    return progress
  return appendProgressRevision(progress, next, action, command.changedAt, command.operationId)
}

/** Restarts an unlocked act without deleting chat history or prior revisions. */
export function restartGroupScriptAct(
  template: GroupScriptTemplate,
  progress: GroupScriptProgress,
  input: RestartGroupScriptActInput,
): GroupScriptProgress {
  assertProgressHistory(template, progress)
  const command = parseProgressCommand(input, true) as RestartGroupScriptActInput
  if (isRepeatedProgressOperation(progress, command.operationId))
    return progress
  return reopenGroupScriptAct(template, progress, command.actId ?? progress.currentActId ?? '', 'restart', command)
}

/** Rolls the active story back one act by default; the caller may select an earlier unlocked act. */
export function rollbackGroupScriptAct(
  template: GroupScriptTemplate,
  progress: GroupScriptProgress,
  input: RollbackGroupScriptActInput,
): GroupScriptProgress {
  assertProgressHistory(template, progress)
  const command = parseProgressCommand(input, true) as RollbackGroupScriptActInput
  if (isRepeatedProgressOperation(progress, command.operationId))
    return progress

  const acts = getTemplateActs(template)
  const currentIndex = acts.findIndex(act => act.actId === progress.currentActId)
  const fallbackActId = currentIndex > 0 ? acts[currentIndex - 1]?.actId : undefined
  return reopenGroupScriptAct(template, progress, command.actId ?? fallbackActId ?? '', 'rollback', command)
}

/** Appends approved acts while keeping all earlier completed revisions intact. */
export function extendGroupScriptActs(template: GroupScriptTemplate, progress: GroupScriptProgress, acts: GroupScriptAct[], command: GroupScriptProgressCommand) {
  assertProgressHistory(template, progress)
  const nextTemplate = parseGroupScript({ ...template, acts: [...getTemplateActs(template), ...acts], updatedAt: command.changedAt })
  const nextProgress = progress.isComplete && acts[0]
    ? appendProgressRevision(progress, {
        ...progress,
        currentActId: acts[0].actId,
        unlockedActIds: [...progress.unlockedActIds, acts[0].actId],
        isComplete: false,
      }, 'extend', command.changedAt, command.operationId)
    : progress
  assertProgressHistory(nextTemplate, nextProgress)
  return { template: nextTemplate, progress: nextProgress }
}

export function restoreGroupScriptProgressRevision(template: GroupScriptTemplate, progress: GroupScriptProgress, revision: number, command: GroupScriptProgressCommand) {
  assertProgressHistory(template, progress)
  if (isRepeatedProgressOperation(progress, command.operationId))
    return progress
  const snapshot = progress.history.find(item => item.revision === revision)
  if (!snapshot)
    fail('Unknown group script progress revision.')
  // A completed revision from before approved sequel acts were appended is
  // reopened at the first following act; the original snapshot stays intact.
  const followingAct = snapshot.isComplete
    ? getTemplateActs(template)[snapshot.completedActIds.length]
    : undefined
  return appendProgressRevision(progress, {
    ...snapshot,
    ...(followingAct ? { currentActId: followingAct.actId, unlockedActIds: [...snapshot.unlockedActIds, followingAct.actId], isComplete: false } : {}),
  }, 'rollback', command.changedAt, command.operationId)
}

/** Validates a persisted room snapshot against the room's current participants. */
export function parseGroupRoomScriptState(value: unknown, participantIds: string[]): GroupRoomScriptState {
  if (!isPlainRecord(value))
    fail('Invalid group room script state.')

  const templateSnapshot = parseGroupScript(value.templateSnapshot)

  // Normalize snapshots created before narration settings were introduced.
  // Parsing used to reject the whole room when this optional feature was
  // absent, which surfaced in the UI as a misleading narration save error.
  const rawNarration = isPlainRecord(value.narrationSettings)
    ? value.narrationSettings
    : {}
  const progress = value.progress === undefined && !templateSnapshot.acts?.length
    ? undefined
    : normalizeGroupScriptProgress(value.progress, templateSnapshot)
  const candidate = {
    ...value,
    templateSnapshot,
    roleBindings: rebuildBindings(value.roleBindings),
    narrationSettings: {
      enabled: rawNarration.enabled === true,
      speechEnabled: rawNarration.speechEnabled === true,
      styleDescription: typeof rawNarration.styleDescription === 'string'
        ? rawNarration.styleDescription
        : undefined,
      speech: rawNarration.speech,
    },
    // A room that has chapters receives its first revision during migration.
    // Legacy templates without chapters retain their original compact shape.
    ...(progress ? { progress } : {}),
  }
  const parsed = safeParse(GroupRoomScriptStateSchema, candidate)
  if (!parsed.success)
    fail('Invalid group room script state.')

  validateTemplateRelations(parsed.output.templateSnapshot)
  if (parsed.output.progress)
    assertProgressHistory(parsed.output.templateSnapshot, parsed.output.progress)

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
    ...(parsed.output.progress ? { progress: cloneGroupScriptProgress(parsed.output.progress) } : {}),
    ...(parsed.output.chapterSettings ? { chapterSettings: { ...parsed.output.chapterSettings } } : {}),
    ...(parsed.output.chapterRuntime ? { chapterRuntime: JSON.parse(JSON.stringify(parsed.output.chapterRuntime)) as GroupScriptChapterRuntime } : {}),
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
    currentScene: [template.currentScene, template.acts?.find(act => act.actId === state.progress?.currentActId)]
      .map(value => typeof value === 'string' ? value : value ? `Act ${value.number}: ${value.title}\n${value.goal ?? ''}\n${value.narration ?? ''}` : '')
      .filter(Boolean)
      .join('\n\n') || undefined,
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
