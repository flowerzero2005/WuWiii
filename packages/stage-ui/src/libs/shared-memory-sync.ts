import type { NotebookEntry } from '../stores/character/notebook'

import localforage from 'localforage'

import { notebookRepo } from '../database/repos/notebook.repo'
import { useAuthStore } from '../stores/auth'
import { useCharacterNotebookStore } from '../stores/character/notebook'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useUserIdentityStore } from '../stores/user-identity'
import { getOfficialApiFetch, SERVER_URL } from './auth'
import { mappedServerMemoryCardIds, resolveLocalMemoryCardId } from './shared-memory-card-map'

interface SyncRecord { revision: number, hash: string, scope: string }
interface SyncState { records: Record<string, SyncRecord>, conflicts: MemorySyncConflict[], serverRevision?: number }
interface RemoteEntry {
  id: string
  scope: string
  kind: NotebookEntry['kind']
  text: string
  tags: string[]
  metadata: Record<string, unknown>
  sourceTime: string | null
  recordedAt: string
  revision: number
  deletedAt: string | null
}

export interface MemorySyncConflict { id: string, remote: RemoteEntry }

const stateStore = localforage.createInstance({ name: 'airi-shared-memory-sync', storeName: 'states' })
const pending = new Map<string, Promise<number>>()
const localReferenceMetadataKeys = new Set(['lastReferencedAt', 'lastReferenceQuery', 'lastReferenceSessionId', 'lastReferenceSource', 'lastReferenceUserMessageId', 'referenceCount'])
const localOnlyMetadata = new Set([...localReferenceMetadataKeys, 'userId', 'characterId', 'personaCardId', 'replyFeedbackPersonaCardId', 'personaGrowthPersonaCardId'])
const MAX_BATCH_BYTES = 256 * 1024
const MAX_BATCH_OPERATIONS = 100
export const ACCOUNT_MEMORY_SETTING_ID = '__account__'

function sharedMetadata(metadata: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => !localOnlyMetadata.has(key)))
}

function localReferenceMetadata(metadata: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => localReferenceMetadataKeys.has(key)))
}

function entryScope(entry: NotebookEntry, known?: SyncRecord) {
  if (known?.scope.startsWith('qq-'))
    return known.scope
  if (entry.metadata?.qqShare === true)
    return 'persona'
  return 'owner'
}

function comparable(entry: NotebookEntry, scope: string) {
  return {
    scope,
    kind: entry.kind,
    text: entry.text,
    tags: entry.tags ?? [],
    metadata: sharedMetadata(entry.metadata),
    sourceTime: typeof entry.metadata?.sourceCreatedAt === 'number' ? entry.metadata.sourceCreatedAt : undefined,
    recordedAt: entry.createdAt,
  }
}

function hash(entry: NotebookEntry, scope: string) {
  return JSON.stringify(comparable(entry, scope))
}

async function request(path: string, init?: RequestInit) {
  const response = await getOfficialApiFetch()(`${SERVER_URL}/api/shared-memory${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok)
    throw new Error(`记忆同步失败（HTTP ${response.status}）`)
  return response.json()
}

export async function setSharedMemoryEnabled(personaCardId: string, enabled: boolean) {
  return request(`/settings/${encodeURIComponent(personaCardId)}`, { method: 'PUT', body: JSON.stringify({ enabled }) })
}

export async function setSharedMemoryAccountEnabled(enabled: boolean) {
  return setSharedMemoryEnabled(ACCOUNT_MEMORY_SETTING_ID, enabled)
}

export async function listSharedMemorySettings(): Promise<Array<{ personaCardId: string, enabled: number }>> {
  return request('/settings')
}

export function syncCharacterMemory(personaCardId: string): Promise<number> {
  const ownerId = useAuthStore().user?.id
  if (!ownerId)
    return Promise.resolve(0)
  const key = `${ownerId}:${personaCardId}`
  const existing = pending.get(key)
  if (existing)
    return existing
  const run = () => syncCharacterMemoryNow(personaCardId, ownerId)
  const task = (async () => {
    if (globalThis.navigator?.locks)
      return await globalThis.navigator.locks.request(`airi-shared-memory:${key}`, async () => await run())
    return await run()
  })().finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

function operationBatches<T>(operations: T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = []
  let bytes = 64
  for (const operation of operations) {
    const operationBytes = new TextEncoder().encode(JSON.stringify(operation)).length + 1
    if (operationBytes > MAX_BATCH_BYTES)
      throw new Error('有一条记忆内容过长，无法同步。请在长期记忆中缩短这条内容后重试。')
    if (batch.length && (batch.length >= MAX_BATCH_OPERATIONS || bytes + operationBytes > MAX_BATCH_BYTES)) {
      batches.push(batch)
      batch = []
      bytes = 64
    }
    batch.push(operation)
    bytes += operationBytes
  }
  if (batch.length || batches.length === 0)
    batches.push(batch)
  return batches
}

async function syncCharacterMemoryNow(personaCardId: string, ownerId: string): Promise<number> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated || auth.user?.id !== ownerId)
    return 0
  const localCardId = resolveLocalMemoryCardId(ownerId, personaCardId, useAiriCardStore().cards.keys())
  if (!localCardId)
    throw new Error('请先为 QQ 人格选择这台设备上的对应角色卡。')
  const notebook = useCharacterNotebookStore()
  const identity = useUserIdentityStore()
  await identity.identifyUser()
  await notebook.loadFromStorage({ force: true })
  if (auth.user?.id !== ownerId)
    return 0
  const scope = notebook.resolveMemoryScope({ personaCardId: localCardId })
  const local = await notebookRepo.load(scope.characterId) ?? { entries: [], tasks: [], version: 1 }
  const stateKey = syncStateKey(personaCardId)
  const previous = await stateStore.getItem<SyncState>(stateKey) ?? { records: {}, conflicts: [] }
  if (auth.user?.id !== ownerId)
    return 0
  const unresolved = new Set(previous.conflicts.map(item => item.id))
  const currentIds = new Set(local.entries.map(entry => entry.id))
  const operations: Array<{ id: string, baseRevision: number, deleted?: boolean, entry?: ReturnType<typeof comparable> }> = []

  for (const entry of local.entries) {
    if (unresolved.has(entry.id))
      continue
    const known = previous.records[entry.id]
    const targetScope = entryScope(entry, known)
    if (!known || known.hash !== hash(entry, targetScope))
      operations.push({ id: entry.id, baseRevision: known?.revision ?? 0, entry: comparable(entry, targetScope) })
  }
  for (const [id, known] of Object.entries(previous.records)) {
    if (!unresolved.has(id) && !currentIds.has(id) && known.hash)
      operations.push({ id, baseRevision: known.revision, deleted: true })
  }

  interface SyncResponse { enabled: boolean, unchanged?: boolean, entries: RemoteEntry[], conflicts: string[], serverRevision: number }
  let response: SyncResponse | undefined
  const serverConflicts = new Set<string>()
  for (const batch of operationBatches(operations)) {
    if (auth.user?.id !== ownerId)
      return 0
    response = await request(`/sync/${encodeURIComponent(personaCardId)}`, { method: 'POST', body: JSON.stringify({ operations: batch, knownRevision: previous.serverRevision }) }) as SyncResponse
    if (auth.user?.id !== ownerId)
      return 0
    if (!response.enabled)
      return 0
    for (const id of response.conflicts)
      serverConflicts.add(id)
  }
  if (!response || response.unchanged)
    return previous.conflicts.length

  // Persist edits made while the request was in flight before reconciling the response.
  if (notebook.characterId === scope.characterId)
    await notebook.loadFromStorage({ force: true })
  if (auth.user?.id !== ownerId)
    return 0

  const conflictIds = new Set([...previous.conflicts.map(item => item.id), ...serverConflicts])
  const snapshot = new Map(local.entries.map(entry => [entry.id, entry]))
  const snapshotTombstones = new Set(local.deletedMemoryEntryIds ?? [])
  const sentIds = new Set(operations.map(operation => operation.id))
  const records: SyncState['records'] = { ...previous.records }
  await notebookRepo.update(scope.characterId, (current) => {
    const merged = new Map(current.entries.map(entry => [entry.id, entry]))
    const tombstones = new Set(current.deletedMemoryEntryIds ?? [])
    for (const remote of response.entries) {
      const old = merged.get(remote.id)
      const before = snapshot.get(remote.id)
      const beforeHash = before ? hash(before, entryScope(before, previous.records[remote.id])) : ''
      const currentHash = old ? hash(old, entryScope(old, previous.records[remote.id])) : ''
      const changedDuringRequest = currentHash !== beforeHash || tombstones.has(remote.id) !== snapshotTombstones.has(remote.id)
      if (changedDuringRequest && !sentIds.has(remote.id) && remote.revision !== previous.records[remote.id]?.revision)
        conflictIds.add(remote.id)
      if (conflictIds.has(remote.id))
        continue
      if (remote.deletedAt) {
        records[remote.id] = { revision: remote.revision, hash: '', scope: remote.scope }
        if (!changedDuringRequest) {
          merged.delete(remote.id)
          tombstones.add(remote.id)
        }
        continue
      }
      const entry: NotebookEntry = {
        id: remote.id,
        kind: remote.kind,
        text: remote.text,
        tags: remote.tags,
        createdAt: new Date(remote.recordedAt).getTime(),
        metadata: { ...sharedMetadata(remote.metadata), userId: scope.userId, characterId: scope.characterId, personaCardId: localCardId, ...localReferenceMetadata(old?.metadata) },
      }
      records[remote.id] = { revision: remote.revision, hash: hash(entry, remote.scope), scope: remote.scope }
      if (!changedDuringRequest) {
        tombstones.delete(remote.id)
        merged.set(remote.id, entry)
      }
    }
    return { ...current, entries: [...merged.values()], deletedMemoryEntryIds: [...tombstones] }
  })
  const conflicts = response.entries.filter(entry => conflictIds.has(entry.id))
    .map(entry => ({ id: entry.id, remote: entry }))
  await stateStore.setItem(stateKey, { records, conflicts, serverRevision: response.serverRevision })
  if (notebook.characterId === scope.characterId)
    await notebook.loadFromStorage({ force: true })
  return conflicts.length
}

function syncStateKey(personaCardId: string) {
  const auth = useAuthStore()
  const notebook = useCharacterNotebookStore()
  const localCardId = resolveLocalMemoryCardId(auth.user?.id ?? 'local', personaCardId, useAiriCardStore().cards.keys())
  const scopeId = notebook.resolveMemoryScope({ personaCardId: localCardId ?? personaCardId }).characterId
  const ownerId = auth.user?.id ?? 'local'
  return localCardId === personaCardId ? `${ownerId}:${scopeId}` : `${ownerId}:${personaCardId}:${scopeId}`
}

export async function getMemorySyncConflicts(personaCardId: string): Promise<MemorySyncConflict[]> {
  return (await stateStore.getItem<SyncState>(syncStateKey(personaCardId)))?.conflicts ?? []
}

export async function resolveMemorySyncConflict(personaCardId: string, id: string, choice: 'local' | 'remote') {
  const ownerId = useAuthStore().user?.id
  if (!ownerId)
    return false
  const key = `${ownerId}:${personaCardId}`
  if (!globalThis.navigator?.locks && pending.has(key))
    await pending.get(key)
  const run = () => resolveMemorySyncConflictNow(personaCardId, id, choice)
  if (globalThis.navigator?.locks)
    return await globalThis.navigator.locks.request(`airi-shared-memory:${key}`, async () => await run())
  return await run()
}

async function resolveMemorySyncConflictNow(personaCardId: string, id: string, choice: 'local' | 'remote') {
  const notebook = useCharacterNotebookStore()
  const localCardId = resolveLocalMemoryCardId(useAuthStore().user?.id ?? 'local', personaCardId, useAiriCardStore().cards.keys())
  if (!localCardId)
    return false
  const scope = notebook.resolveMemoryScope({ personaCardId: localCardId })
  const key = syncStateKey(personaCardId)
  const state = await stateStore.getItem<SyncState>(key)
  const conflict = state?.conflicts.find(item => item.id === id)
  if (!state || !conflict)
    return false
  const local = await notebookRepo.load(scope.characterId)
  if (!local)
    return false
  const current = local.entries.find(entry => entry.id === id)
  const remote = conflict.remote
  if (choice === 'local') {
    const operation = current
      ? { id, baseRevision: remote.revision, entry: comparable(current, entryScope(current, state.records[id])) }
      : { id, baseRevision: remote.revision, deleted: true }
    const result = await request(`/sync/${encodeURIComponent(personaCardId)}`, { method: 'POST', body: JSON.stringify({ operations: [operation] }) }) as { enabled: boolean, entries: RemoteEntry[], conflicts: string[], serverRevision: number }
    if (!result.enabled || result.conflicts.includes(id))
      return false
    const saved = result.entries.find(entry => entry.id === id)
    if (!saved)
      return false
    state.records[id] = { revision: saved.revision, hash: current ? hash(current, saved.scope) : '', scope: saved.scope }
    state.serverRevision = result.serverRevision
  }
  else if (remote.deletedAt) {
    const latest = await request(`/sync/${encodeURIComponent(personaCardId)}`, { method: 'POST', body: JSON.stringify({ operations: [] }) }) as { enabled: boolean, entries: RemoteEntry[], serverRevision: number }
    const latestEntry = latest.entries.find(entry => entry.id === id)
    if (!latest.enabled || !latestEntry || latestEntry.revision !== remote.revision) {
      if (latestEntry) {
        state.conflicts = state.conflicts.map(item => item.id === id ? { id, remote: latestEntry } : item)
        state.serverRevision = latest.serverRevision
        await stateStore.setItem(key, state)
      }
      return false
    }
    await notebookRepo.update(scope.characterId, currentData => ({
      ...currentData,
      entries: currentData.entries.filter(entry => entry.id !== id),
      deletedMemoryEntryIds: [...new Set([...(currentData.deletedMemoryEntryIds ?? []), id])],
    }))
    state.records[id] = { revision: remote.revision, hash: '', scope: remote.scope }
  }
  else {
    const latest = await request(`/sync/${encodeURIComponent(personaCardId)}`, { method: 'POST', body: JSON.stringify({ operations: [] }) }) as { enabled: boolean, entries: RemoteEntry[], serverRevision: number }
    const latestEntry = latest.entries.find(entry => entry.id === id)
    if (!latest.enabled || !latestEntry || latestEntry.revision !== remote.revision) {
      if (latestEntry) {
        state.conflicts = state.conflicts.map(item => item.id === id ? { id, remote: latestEntry } : item)
        state.serverRevision = latest.serverRevision
        await stateStore.setItem(key, state)
      }
      return false
    }
    const entry: NotebookEntry = {
      id,
      kind: remote.kind,
      text: remote.text,
      tags: remote.tags,
      createdAt: current?.createdAt ?? new Date(remote.recordedAt).getTime(),
      metadata: { ...sharedMetadata(remote.metadata), userId: scope.userId, characterId: scope.characterId, personaCardId: localCardId, ...localReferenceMetadata(current?.metadata) },
    }
    await notebookRepo.update(scope.characterId, currentData => ({
      ...currentData,
      entries: [...currentData.entries.filter(item => item.id !== id), entry],
      deletedMemoryEntryIds: (currentData.deletedMemoryEntryIds ?? []).filter(deletedId => deletedId !== id),
    }))
    state.records[id] = { revision: remote.revision, hash: hash(entry, remote.scope), scope: remote.scope }
  }
  state.conflicts = state.conflicts.filter(item => item.id !== id)
  await stateStore.setItem(key, state)
  if (notebook.characterId === scope.characterId)
    await notebook.loadFromStorage({ force: true })
  return true
}

export async function syncEnabledCharacterMemories() {
  const auth = useAuthStore()
  const ownerId = auth.user?.id
  if (!auth.isAuthenticated || !ownerId)
    return
  const cards = useAiriCardStore()
  const settings = await listSharedMemorySettings()
  if (auth.user?.id !== ownerId)
    return
  if (settings.some(setting => setting.personaCardId === ACCOUNT_MEMORY_SETTING_ID && !setting.enabled))
    return
  const disabled = new Set(settings.filter(setting => !setting.enabled).map(setting => setting.personaCardId))
  const personaIds = new Set([...cards.cards.keys(), ...mappedServerMemoryCardIds(ownerId), ...settings.filter(setting => setting.enabled && setting.personaCardId !== ACCOUNT_MEMORY_SETTING_ID).map(setting => setting.personaCardId)])
  for (const personaCardId of personaIds) {
    if (auth.user?.id !== ownerId)
      return
    if (!disabled.has(personaCardId) && resolveLocalMemoryCardId(ownerId, personaCardId, cards.cards.keys()))
      await syncCharacterMemory(personaCardId)
  }
}

export async function syncMemoryForLocalCard(localCardId: string) {
  const ownerId = useAuthStore().user?.id
  if (!ownerId)
    return false
  const cards = useAiriCardStore()
  const settings = await listSharedMemorySettings()
  if (useAuthStore().user?.id !== ownerId || settings.some(setting => setting.personaCardId === ACCOUNT_MEMORY_SETTING_ID && !setting.enabled))
    return false
  const disabled = new Set(settings.filter(setting => !setting.enabled).map(setting => setting.personaCardId))
  const personaIds = new Set([localCardId, ...mappedServerMemoryCardIds(ownerId)])
  let synced = false
  for (const personaCardId of personaIds) {
    if (!disabled.has(personaCardId) && resolveLocalMemoryCardId(ownerId, personaCardId, cards.cards.keys()) === localCardId) {
      await syncCharacterMemory(personaCardId)
      synced = true
    }
  }
  return synced
}
