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

/** Events and invoke responses can arrive in either order; revocation is sticky. */
export function mergeComposerSnapshot(current: ComposerSnapshot | undefined, incoming: ComposerSnapshot): ComposerSnapshot {
  if (!current)
    return incoming
  if (current.scope.leaseId !== incoming.scope.leaseId)
    return current.status === 'returned' ? incoming : current
  if (incoming.version < current.version)
    return current
  if ((current.status === 'orphaned' || current.status === 'returned') && incoming.status === 'detached')
    return { ...incoming, status: current.status, busy: false, uncertain: current.uncertain || incoming.uncertain, commandId: current.commandId ?? incoming.commandId }
  if (incoming.version === current.version && current.uncertain && !incoming.uncertain)
    return current
  return incoming
}

const IMAGE_MIME_RE = /^image\/(?:png|jpeg|webp|gif)$/
const BASE64_RE = /^[A-Z0-9+/]*={0,2}$/i

export function validateComposerDraft(value: ComposerDraft, group: boolean): ComposerDraft {
  if (!value || typeof value.text !== 'string' || value.text.length > 128_000 || !Array.isArray(value.images)
    || value.images.length > 4 || (group && value.images.length)) {
    throw new Error('Invalid composer draft.')
  }
  const ids = new Set<string>()
  const images = value.images.map((image) => {
    const padding = image?.data?.endsWith('==') ? 2 : image?.data?.endsWith('=') ? 1 : 0
    if (!image || typeof image.id !== 'string' || !image.id || image.id.length > 128 || ids.has(image.id)
      || typeof image.mimeType !== 'string' || !IMAGE_MIME_RE.test(image.mimeType)
      || typeof image.data !== 'string' || !image.data || image.data.length % 4 !== 0 || !BASE64_RE.test(image.data)
      || image.data.length * 3 / 4 - padding > 10 * 1024 * 1024) {
      throw new Error('Invalid composer image.')
    }
    ids.add(image.id)
    return { id: image.id, mimeType: image.mimeType, data: image.data }
  })
  return { text: value.text, images }
}

/** Main process owns every revision, lease and command marker. Images stay in memory. */
export function createComposerState() {
  let state: ComposerSnapshot | undefined
  const recoveries = new Map<string, ComposerSnapshot>()
  const commands = new Set<string>()
  const key = (scope: Pick<ComposerScope, 'userScope' | 'sessionId' | 'surface'>) => JSON.stringify([scope.userScope, scope.surface, scope.sessionId])
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
    hasRecovery: (userScope: string, sessionId: string, surface: ComposerScope['surface']) => recoveries.has(key({ userScope, sessionId, surface })),
    recovery: (userScope: string, sessionId: string, surface: ComposerScope['surface']) => {
      const value = recoveries.get(key({ userScope, sessionId, surface }))
      return value ? structuredClone(value) : undefined
    },
    viewRecovery(userScope: string, sessionId: string, surface: ComposerScope['surface']) {
      if (state && state.status !== 'returned')
        throw new Error('Another source already owns the detached composer.')
      const value = recoveries.get(key({ userScope, sessionId, surface }))
      if (!value)
        throw new Error('No recoverable draft exists for this conversation.')
      state = structuredClone(value)
      state.status = 'orphaned'
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
      if (recovery?.uncertain)
        throw new Error('The original submit outcome is unknown. Recovery remains quarantined until the source reports its outcome.')
      if (!recovery && recoveries.size >= 8)
        throw new Error('Recover an earlier conversation draft before detaching another composer.')
      commands.clear()
      state = { scope: { userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, sourceGeneration: input.sourceGeneration, sourceWebContentsId, group: input.group, leaseId: crypto.randomUUID() }, version: 0, draft: validateComposerDraft(recovery?.draft ?? input.draft, input.group), status: 'detached', busy: false }
      recoveries.delete(key(input))
      return read()!
    },
    edit(input: ComposerVersion & { draft: ComposerDraft }) {
      const current = requireVersion(input)
      if (current.busy || current.uncertain || current.status === 'returned')
        throw new Error('The composer is busy or returned.')
      current.draft = validateComposerDraft(input.draft, current.scope.group)
      current.version += 1
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
      if (recoveries.get(key(current.scope))?.scope.leaseId === current.scope.leaseId)
        recoveries.set(key(current.scope), structuredClone(current))
      return structuredClone(current)
    },
    invalidate(sourceWebContentsId: number, sourceGeneration?: string) {
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
      if (current.status === 'orphaned')
        recoveries.set(key(current.scope), structuredClone(current))
      current.status = 'returned'
      return read()!
    },
  }
}
