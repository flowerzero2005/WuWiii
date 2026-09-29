import { VISION_MAX_IMAGE_BYTES, VISION_MAX_IMAGES, VISION_MAX_TOTAL_IMAGE_BYTES } from '@proj-airi/server-shared/vision-limits'

export interface ComposerImage {
  id: string
  mimeType: string
  data: string
}
export interface ComposerDraft {
  text: string
  images: ComposerImage[]
}
export interface ComposerScope {
  userScope: string
  sessionId: string
  surface: 'page' | 'widget'
  sourceGeneration: string
  sourceWebContentsId: number
  leaseId: string
  group: boolean
}
export interface ComposerSnapshot {
  scope: ComposerScope
  version: number
  draft: ComposerDraft
  status: 'detached' | 'returned' | 'orphaned'
  busy: boolean
  uncertain?: boolean
  commandId?: string
}
export interface ComposerVersion {
  leaseId: string
  version: number
}
export interface ComposerDetach {
  userScope: string
  sessionId: string
  surface: 'page' | 'widget'
  sourceGeneration: string
  group: boolean
  draft: ComposerDraft
  recover?: boolean
}

export type ComposerDraftScope = Pick<ComposerDetach, 'userScope' | 'sessionId' | 'surface' | 'group'>
export interface ComposerSourceDraft extends ComposerDraftScope {
  sourceGeneration: string
  version: number
  draft: ComposerDraft
}
export interface ComposerStoredDraft extends ComposerDraftScope {
  version: number
  draft: ComposerDraft
  uncertain: boolean
}
export interface ComposerRecoveryData {
  version: 1
  drafts: ComposerStoredDraft[]
}
export const COMPOSER_MAX_SCOPES = 8
export const COMPOSER_MAX_TOTAL_IMAGE_BYTES = VISION_MAX_TOTAL_IMAGE_BYTES
const scopeKey = (scope: Pick<ComposerDraftScope, 'userScope' | 'sessionId' | 'surface'>) => JSON.stringify([scope.userScope, scope.surface, scope.sessionId])

export function validateComposerScope(value: ComposerDraftScope) {
  if (!value || [value.userScope, value.sessionId].some(item => typeof item !== 'string' || !item || item.length > 256)
    || typeof value.group !== 'boolean' || !['page', 'widget'].includes(value.surface)) {
    throw new Error('Invalid composer scope.')
  }
}

/** Whitelisted disk DTO; no renderer identity, old lease or executable command. */
export function parseComposerRecoveryData(input: unknown): ComposerRecoveryData {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1
    || !('drafts' in input) || !Array.isArray(input.drafts) || input.drafts.length > COMPOSER_MAX_SCOPES) {
    throw new Error('Invalid or unsupported composer recovery data.')
  }
  const keys = new Set<string>()
  let imageBytes = 0
  const drafts = input.drafts.map((raw: ComposerStoredDraft) => {
    validateComposerScope(raw)
    if (!Number.isSafeInteger(raw.version) || raw.version < 0 || typeof raw.uncertain !== 'boolean' || keys.has(scopeKey(raw)))
      throw new Error('Invalid composer recovery revision or scope.')
    keys.add(scopeKey(raw))
    const draft = validateComposerDraft(raw.draft, raw.group)
    for (const image of draft.images) {
      const padding = image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0
      imageBytes += image.data.length * 3 / 4 - padding
    }
    if (imageBytes > COMPOSER_MAX_TOTAL_IMAGE_BYTES)
      throw new Error('Composer draft attachment capacity is full. Remove an attachment or explicitly discard a saved draft.')
    return { userScope: raw.userScope, sessionId: raw.sessionId, surface: raw.surface, group: raw.group, version: raw.version, draft, uncertain: raw.uncertain }
  })
  return { version: 1, drafts }
}

/** Events and invoke responses can arrive in either order; revocation is sticky. */
export function mergeComposerSnapshot(current: ComposerSnapshot | undefined, incoming: ComposerSnapshot): ComposerSnapshot {
  if (!current)
    return incoming
  if (current.scope.leaseId !== incoming.scope.leaseId)
    return current.status === 'returned' ? incoming : current
  if (incoming.version < current.version)
    return current
  if (((current.status === 'orphaned' && current.scope.sourceGeneration === incoming.scope.sourceGeneration) || current.status === 'returned') && incoming.status === 'detached')
    return { ...incoming, status: current.status, busy: false, uncertain: current.uncertain || incoming.uncertain, commandId: current.commandId ?? incoming.commandId }
  if (incoming.version === current.version && current.uncertain && !incoming.uncertain)
    return current
  return incoming
}

const IMAGE_MIME_RE = /^image\/(?:png|jpeg|webp|gif)$/
const BASE64_RE = /^[A-Z0-9+/]*={0,2}$/i

export function validateComposerDraft(value: ComposerDraft, group: boolean): ComposerDraft {
  if (!value || typeof value.text !== 'string' || value.text.length > 128_000 || !Array.isArray(value.images)
    || value.images.length > VISION_MAX_IMAGES || (group && value.images.length)) {
    throw new Error('Invalid composer draft.')
  }
  const ids = new Set<string>()
  let totalImageBytes = 0
  const images = value.images.map((image) => {
    const padding = image?.data?.endsWith('==') ? 2 : image?.data?.endsWith('=') ? 1 : 0
    if (!image || typeof image.id !== 'string' || !image.id || image.id.length > 128 || ids.has(image.id)
      || typeof image.mimeType !== 'string' || !IMAGE_MIME_RE.test(image.mimeType)
      || typeof image.data !== 'string' || !image.data || image.data.length % 4 !== 0 || !BASE64_RE.test(image.data)
      || image.data.length * 3 / 4 - padding > VISION_MAX_IMAGE_BYTES) {
      throw new Error('Invalid composer image.')
    }
    totalImageBytes += image.data.length * 3 / 4 - padding
    if (totalImageBytes > VISION_MAX_TOTAL_IMAGE_BYTES)
      throw new Error('Composer draft images exceed the total attachment size limit.')
    ids.add(image.id)
    return { id: image.id, mimeType: image.mimeType, data: image.data }
  })
  return { text: value.text, images }
}

/** Main process owns every revision, lease and command marker. */
export function createComposerState() {
  let state: ComposerSnapshot | undefined
  const recoveries = new Map<string, ComposerSnapshot>()
  const commands = new Set<string>()
  // Empty draft revisions remain in memory until restart, when every old
  // renderer generation is gone. This prevents a clear -> zero ABA write.
  const draftVersions = new Map<string, number>()
  const key = scopeKey
  const read = () => state ? structuredClone(state) : undefined
  function requireVersion(input: ComposerVersion) {
    if (!input || typeof input.leaseId !== 'string' || !input.leaseId || input.leaseId.length > 128 || !Number.isSafeInteger(input.version) || input.version < 0
      || !state || state.scope.leaseId !== input.leaseId || state.version !== input.version) {
      throw new Error('The composer ownership or draft version changed.')
    }
    return state
  }
  return {
    read,
    draftVersion: (scope: Pick<ComposerDraftScope, 'userScope' | 'sessionId' | 'surface'>) => draftVersions.get(key(scope)) ?? 0,
    restore(input: unknown) {
      const data = parseComposerRecoveryData(input)
      state = undefined
      commands.clear()
      draftVersions.clear()
      recoveries.clear()
      for (const record of data.drafts) {
        draftVersions.set(key(record), record.version)
        recoveries.set(key(record), { scope: { userScope: record.userScope, sessionId: record.sessionId, surface: record.surface, group: record.group, sourceGeneration: 'restored', sourceWebContentsId: 0, leaseId: crypto.randomUUID() }, draft: record.draft, version: record.version, busy: false, status: 'orphaned', uncertain: record.uncertain })
      }
    },
    async commit<T>(mutation: () => T, persist: (data: ComposerRecoveryData) => Promise<void>): Promise<T> {
      const previous = read()
      const previousRecoveries = structuredClone(recoveries)
      const previousCommands = new Set(commands)
      const previousVersions = new Map(draftVersions)
      try {
        const result = mutation()
        const entries = new Map(recoveries)
        if (state)
          entries.set(key(state.scope), state)
        const data = parseComposerRecoveryData({ version: 1, drafts: [...entries.values()]
          .filter(value => value.uncertain || value.busy || value.draft.text || value.draft.images.length)
          .map(value => ({ userScope: value.scope.userScope, sessionId: value.scope.sessionId, surface: value.scope.surface, group: value.scope.group, version: value.version, draft: value.draft, uncertain: !!value.uncertain || value.busy })) })
        await persist(data)
        return result
      }
      catch (error) {
        state = previous
        recoveries.clear()
        for (const [scope, value] of previousRecoveries)
          recoveries.set(scope, value)
        commands.clear()
        for (const command of previousCommands)
          commands.add(command)
        draftVersions.clear()
        for (const [scope, version] of previousVersions)
          draftVersions.set(scope, version)
        throw error
      }
    },
    sourceDraft(sourceWebContentsId: number, input: ComposerSourceDraft) {
      validateComposerScope(input)
      if (typeof input.sourceGeneration !== 'string' || !input.sourceGeneration || input.sourceGeneration.length > 256)
        throw new Error('Invalid composer source generation.')
      if (state && key(state.scope) === key(input) && state.status !== 'returned')
        throw new Error('The detached editor owns this draft.')
      const existing = recoveries.get(key(input))
      if (existing?.uncertain)
        throw new Error('The original submit outcome is unknown. This draft is read only.')
      if (!Number.isSafeInteger(input.version) || input.version !== (draftVersions.get(key(input)) ?? 0))
        throw new Error('The saved draft version changed. Read its latest revision before editing.')
      const draft = validateComposerDraft(input.draft, input.group)
      const version = input.version + 1
      if (!draft.text && !draft.images.length) {
        draftVersions.set(key(input), version)
        recoveries.delete(key(input))
        if (state && key(state.scope) === key(input))
          state = undefined
        return { version }
      }
      if (!existing && recoveries.size >= COMPOSER_MAX_SCOPES)
        throw new Error('Composer draft capacity is full. Explicitly discard or send a saved draft first.')
      draftVersions.set(key(input), version)
      const value: ComposerSnapshot = { scope: { userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, group: input.group, sourceGeneration: input.sourceGeneration, sourceWebContentsId, leaseId: crypto.randomUUID() }, version, draft, status: 'orphaned', busy: false }
      recoveries.set(key(input), value)
      if (state && key(state.scope) === key(input))
        state = undefined
      return { version }
    },
    sourceSubmit(sourceWebContentsId: number, input: ComposerSourceDraft & { commandId: string }) {
      validateComposerScope(input)
      if (state && key(state.scope) === key(input) && state.status !== 'returned')
        throw new Error('The detached editor owns this draft.')
      const existing = recoveries.get(key(input))
      if (existing?.uncertain || !Number.isSafeInteger(input.version) || input.version !== (draftVersions.get(key(input)) ?? 0))
        throw new Error('The inline send outcome or saved draft version changed.')
      if (typeof input.sourceGeneration !== 'string' || !input.sourceGeneration || input.sourceGeneration.length > 256
        || typeof input.commandId !== 'string' || !input.commandId || input.commandId.length > 128) {
        throw new Error('Invalid inline composer command.')
      }
      const draft = validateComposerDraft(input.draft, input.group)
      if (!draft.text.trim() && !draft.images.length)
        throw new Error('The composer cannot submit an empty draft.')
      if (!existing && recoveries.size >= COMPOSER_MAX_SCOPES)
        throw new Error('Composer draft capacity is full. Explicitly discard or send a saved draft first.')
      const value: ComposerSnapshot = { scope: { userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, group: input.group, sourceGeneration: input.sourceGeneration, sourceWebContentsId, leaseId: crypto.randomUUID() }, version: input.version, draft, status: 'orphaned', busy: true, uncertain: true, commandId: input.commandId }
      recoveries.set(key(input), value)
      if (state && key(state.scope) === key(input))
        state = undefined
      return structuredClone(value)
    },
    hasRecovery: (userScope: string, sessionId: string, surface: ComposerScope['surface']) => recoveries.has(key({ userScope, sessionId, surface })),
    recovery: (userScope: string, sessionId: string, surface: ComposerScope['surface']) => {
      const value = recoveries.get(key({ userScope, sessionId, surface }))
      return value ? structuredClone(value) : undefined
    },
    viewRecovery(userScope: string, sessionId: string, surface: ComposerScope['surface'], sourceWebContentsId: number, sourceGeneration: string) {
      if (!Number.isSafeInteger(sourceWebContentsId) || sourceWebContentsId <= 0 || !sourceGeneration || sourceGeneration.length > 256)
        throw new Error('Invalid recovery source.')
      if (state && state.status !== 'returned')
        throw new Error('Another source already owns the detached composer.')
      const value = recoveries.get(key({ userScope, sessionId, surface }))
      if (!value)
        throw new Error('No recoverable draft exists for this conversation.')
      state = structuredClone(value)
      state.status = 'orphaned'
      // A persisted recovery has no living source after restart. Bind only
      // the current conversation window so it can receive a safe return.
      state.scope.sourceWebContentsId = sourceWebContentsId
      state.scope.sourceGeneration = sourceGeneration
      return read()!
    },
    detach(sourceWebContentsId: number, input: ComposerDetach): ComposerSnapshot {
      if (state && state.status !== 'returned')
        throw new Error('Another source already owns the detached composer.')
      if (!input || [input.userScope, input.sessionId, input.sourceGeneration].some(value => typeof value !== 'string' || !value || value.length > 256)
        || typeof input.group !== 'boolean' || !['page', 'widget'].includes(input.surface)) {
        throw new Error('Invalid composer scope.')
      }
      const recovery = input.recover ? recoveries.get(key(input)) : undefined
      if (input.recover && !recovery)
        throw new Error('No recoverable draft exists for this conversation.')
      if (recoveries.get(key(input))?.uncertain)
        throw new Error('The original submit outcome is unknown. Recovery remains quarantined until the source reports its outcome.')
      if (!recoveries.has(key(input)) && recoveries.size >= COMPOSER_MAX_SCOPES)
        throw new Error('Recover an earlier conversation draft before detaching another composer.')
      commands.clear()
      state = { scope: { userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, sourceGeneration: input.sourceGeneration, sourceWebContentsId, group: input.group, leaseId: crypto.randomUUID() }, version: 0, draft: validateComposerDraft(recovery?.draft ?? input.draft, input.group), status: 'detached', busy: false }
      state.version = (draftVersions.get(key(input)) ?? -1) + 1
      draftVersions.set(key(input), state.version)
      recoveries.delete(key(input))
      return read()!
    },
    rebindSource(sourceWebContentsId: number, input: Omit<ComposerDetach, 'draft' | 'recover'>) {
      validateComposerScope(input)
      if (typeof input.sourceGeneration !== 'string' || !input.sourceGeneration || input.sourceGeneration.length > 256)
        throw new Error('Invalid composer source generation.')
      if (!state || !['detached', 'orphaned'].includes(state.status) || state.busy
        || key(state.scope) !== key(input) || state.scope.group !== input.group) {
        return read()
      }
      state.scope.sourceWebContentsId = sourceWebContentsId
      state.scope.sourceGeneration = input.sourceGeneration
      // A quarantined submit may follow the same conversation into a newly
      // mounted source, but it never becomes an editable detached draft.
      state.status = state.uncertain ? 'orphaned' : 'detached'
      return read()!
    },
    edit(input: ComposerVersion & { draft: ComposerDraft }) {
      const current = requireVersion(input)
      if (current.busy || current.uncertain || current.status === 'returned')
        throw new Error('The composer is busy or returned.')
      current.draft = validateComposerDraft(input.draft, current.scope.group)
      current.version += 1
      draftVersions.set(key(current.scope), current.version)
      return read()!
    },
    submit(input: ComposerVersion & { commandId: string }) {
      const current = requireVersion(input)
      if (typeof input.commandId !== 'string' || !input.commandId || input.commandId.length > 128)
        throw new Error('Invalid composer command ID.')
      if (commands.has(`${input.leaseId}:${input.commandId}`))
        return { snapshot: read()!, execute: false }
      if (current.status !== 'detached' || current.busy || (!current.draft.text.trim() && !current.draft.images.length))
        throw new Error('The composer cannot submit this draft.')
      commands.add(`${input.leaseId}:${input.commandId}`)
      current.busy = true
      current.commandId = input.commandId
      return { snapshot: read()!, execute: true }
    },
    settle(sourceWebContentsId: number, input: ComposerVersion & { commandId: string, consumed: boolean, draft: ComposerDraft }) {
      const cached = [...recoveries.values()].find(value => value.scope.leaseId === input.leaseId && value.version === input.version && value.commandId === input.commandId)
      const current = state?.scope.leaseId === input.leaseId ? requireVersion(input) : cached
      if (!current || typeof input.consumed !== 'boolean')
        throw new Error('The old composer outcome no longer owns a recovery record.')
      if (sourceWebContentsId !== current.scope.sourceWebContentsId || (!current.busy && !current.uncertain) || current.commandId !== input.commandId)
        throw new Error('The submit command no longer owns this source.')
      current.draft = validateComposerDraft(input.consumed ? { text: '', images: [] } : input.draft, current.scope.group)
      current.busy = false
      current.uncertain = false
      delete current.commandId
      current.version += 1
      draftVersions.set(key(current.scope), current.version)
      if (recoveries.get(key(current.scope))?.scope.leaseId === current.scope.leaseId)
        recoveries.set(key(current.scope), structuredClone(current))
      if (!current.draft.text && !current.draft.images.length)
        recoveries.delete(key(current.scope))
      return structuredClone(current)
    },
    invalidate(sourceWebContentsId: number, sourceGeneration?: string) {
      for (const value of recoveries.values()) {
        if (value.scope.sourceWebContentsId === sourceWebContentsId && (!sourceGeneration || value.scope.sourceGeneration === sourceGeneration)) {
          value.uncertain = value.uncertain || value.busy
          value.busy = false
        }
      }
      if (!state || state.status === 'returned' || state.scope.sourceWebContentsId !== sourceWebContentsId
        || (sourceGeneration && state.scope.sourceGeneration !== sourceGeneration)) {
        return read()
      }
      state.status = 'orphaned'
      state.uncertain = state.uncertain || state.busy
      state.busy = false
      if (!state.uncertain)
        delete state.commandId
      recoveries.set(key(state.scope), structuredClone(state))
      return read()
    },
    release(input: ComposerVersion) {
      const current = requireVersion(input)
      if (current.busy)
        throw new Error('Wait for the current submit to settle before returning.')
      if (current.draft.text || current.draft.images.length || current.uncertain)
        recoveries.set(key(current.scope), structuredClone(current))
      else
        recoveries.delete(key(current.scope))
      current.status = 'returned'
      return read()!
    },
    discard(input: ComposerVersion) {
      const current = requireVersion(input)
      if (current.busy)
        throw new Error('Wait for the current submit before discarding its draft.')
      recoveries.delete(key(current.scope))
      current.draft = { text: '', images: [] }
      current.uncertain = false
      delete current.commandId
      current.status = 'returned'
      current.version += 1
      draftVersions.set(key(current.scope), current.version)
      return read()!
    },
  }
}
