import type { AiriCard } from '../stores/modules/airi-card'

import localforage from 'localforage'

import { nanoid } from 'nanoid'
import { toRaw } from 'vue'

import { notebookRepo } from '../database/repos/notebook.repo'
import { useAuthStore } from '../stores/auth'
import { useCharacterNotebookStore } from '../stores/character/notebook'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { getOfficialApiFetch, SERVER_URL } from './auth'

interface RemoteCard {
  cardId: string
  card: AiriCard
  revision: number
  deletedAt: string | null
}
interface SyncRecord { hash: string, revision: number }
export interface PersonaCardConflict { id: string, local: AiriCard, remote: AiriCard, revision: number }
interface SyncState { records: Record<string, SyncRecord>, conflicts: PersonaCardConflict[] }
interface Operation { id: string, baseRevision: number, card?: AiriCard, deleted?: boolean }

const stateStore = localforage.createInstance({ name: 'airi-persona-card-sync', storeName: 'states' })
const pending = new Map<string, Promise<PersonaCardConflict[]>>()
let syncQueue: Promise<unknown> = Promise.resolve()
const LAST_OWNER_KEY = 'airi-persona-card-last-owner'

async function prepareAccountCards(ownerId: string) {
  const store = useAiriCardStore()
  const previousOwner = localStorage.getItem(LAST_OWNER_KEY)
  if (previousOwner && previousOwner !== ownerId) {
    await stateStore.setItem(`snapshot:${previousOwner}`, Array.from(store.cards, ([id, card]) => [id, JSON.parse(JSON.stringify(card))]))
    const saved = await stateStore.getItem<Array<[string, AiriCard]>>(`snapshot:${ownerId}`)
    store.cards = new Map(saved ?? [])
    if (!store.cards.has(store.activeCardId))
      store.activeCardId = 'default'
  }
  localStorage.setItem(LAST_OWNER_KEY, ownerId)
  store.initialize()
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

function cardHash(card: AiriCard) {
  return JSON.stringify(canonical(toRaw(card)))
}

async function request(path: string, init?: RequestInit) {
  const response = await getOfficialApiFetch()(`${SERVER_URL}/api/persona-cards${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok)
    throw new Error(`角色卡同步失败（HTTP ${response.status}）`)
  return response.json()
}

async function fetchRemote(): Promise<RemoteCard[]> {
  return request('/')
}

async function submit(operations: Operation[]): Promise<{ cards: RemoteCard[], conflicts: string[] }> {
  return request('/sync', { method: 'POST', body: JSON.stringify({ operations }) })
}

export function syncPersonaCards(): Promise<PersonaCardConflict[]> {
  const ownerId = useAuthStore().user?.id
  if (!ownerId)
    return Promise.resolve([])
  const existing = pending.get(ownerId)
  if (existing)
    return existing
  const task = syncQueue.catch(() => undefined).then(async () => {
    const run = () => syncPersonaCardsNow(ownerId)
    return globalThis.navigator?.locks
      ? await globalThis.navigator.locks.request('airi-persona-cards-account-switch', run)
      : await run()
  }).finally(() => pending.delete(ownerId))
  syncQueue = task
  pending.set(ownerId, task)
  return task
}

async function syncPersonaCardsNow(ownerId: string): Promise<PersonaCardConflict[]> {
  if (useAuthStore().user?.id !== ownerId)
    return []
  await prepareAccountCards(ownerId)
  const store = useAiriCardStore()
  const previous = await stateStore.getItem<SyncState>(ownerId) ?? { records: {}, conflicts: [] }
  const local = new Map(Array.from(store.cards, ([id, card]) => [id, JSON.parse(JSON.stringify(card)) as AiriCard]))
  const remoteBefore = new Map((await fetchRemote()).map(card => [card.cardId, card]))
  if (useAuthStore().user?.id !== ownerId)
    return []
  const operations: Operation[] = []
  for (const [id, card] of local) {
    const known = previous.records[id]
    if (known?.hash === cardHash(card))
      continue
    if (JSON.stringify(card).length > 2_000_000)
      throw new Error(`角色卡「${card.name}」超过 2 MB，同步已暂停；请缩小卡片中的内嵌图片后重试`)
    // An older device must not overwrite a different card at the same ID on its first sync.
    if (!known && remoteBefore.has(id))
      continue
    operations.push({ id, baseRevision: known?.revision ?? 0, card })
  }
  for (const [id, known] of Object.entries(previous.records)) {
    if (id !== 'default' && !local.has(id))
      operations.push({ id, baseRevision: known.revision, deleted: true })
  }

  const serverConflicts = new Set<string>()
  let remote = [...remoteBefore.values()]
  for (let i = 0; i < operations.length; i += 50) {
    if (useAuthStore().user?.id !== ownerId)
      return []
    const result = await submit(operations.slice(i, i + 50))
    remote = result.cards
    result.conflicts.forEach(id => serverConflicts.add(id))
  }
  const records: Record<string, SyncRecord> = { ...previous.records }
  const conflicts: PersonaCardConflict[] = []
  const next = new Map(store.cards)
  for (const item of remote) {
    const before = local.get(item.cardId)
    const current = next.get(item.cardId)
    const known = previous.records[item.cardId]
    const changedDuringRequest = (current ? cardHash(current) : '') !== (before ? cardHash(before) : '')
    const localChanged = !!before && (!known || cardHash(before) !== known.hash)
    const remoteChanged = !!known && item.revision !== known.revision
    const firstSyncCollision = !!before && !known && (item.deletedAt !== null || cardHash(before) !== cardHash(item.card))
    if (serverConflicts.has(item.cardId) || firstSyncCollision || (localChanged && remoteChanged && (item.deletedAt !== null || cardHash(before!) !== cardHash(item.card))) || changedDuringRequest) {
      if (current)
        conflicts.push({ id: item.cardId, local: current, remote: item.card, revision: item.revision })
      continue
    }
    if (item.deletedAt) {
      if (item.cardId !== 'default')
        next.delete(item.cardId)
      records[item.cardId] = { hash: '', revision: item.revision }
    }
    else {
      if (!current || cardHash(current) !== cardHash(item.card))
        next.set(item.cardId, item.card)
      records[item.cardId] = { hash: cardHash(item.card), revision: item.revision }
    }
  }
  if (useAuthStore().user?.id !== ownerId)
    return []
  if (next.size !== store.cards.size || [...next].some(([id, card]) => !store.cards.has(id) || cardHash(store.cards.get(id)!) !== cardHash(card)))
    store.cards = next
  await stateStore.setItem(ownerId, { records, conflicts })
  return conflicts
}

export async function getPersonaCardConflicts(): Promise<PersonaCardConflict[]> {
  const ownerId = useAuthStore().user?.id
  return ownerId ? (await stateStore.getItem<SyncState>(ownerId))?.conflicts ?? [] : []
}

export async function resolvePersonaCardConflict(id: string, choice: 'local' | 'remote') {
  const ownerId = useAuthStore().user?.id
  if (!ownerId)
    return false
  if (pending.has(ownerId))
    await pending.get(ownerId)
  if (useAuthStore().user?.id !== ownerId)
    return false
  const state = await stateStore.getItem<SyncState>(ownerId)
  const conflict = state?.conflicts.find(item => item.id === id)
  if (!state || !conflict)
    return false
  const store = useAiriCardStore()
  const local = store.cards.get(id)
  const latest = (await fetchRemote()).find(item => item.cardId === id)
  if (useAuthStore().user?.id !== ownerId)
    return false
  if (!local || !latest || latest.revision !== conflict.revision)
    return false
  if (choice === 'local') {
    const result = await submit([{ id, baseRevision: latest.revision, card: JSON.parse(JSON.stringify(local)) as AiriCard }])
    if (result.conflicts.includes(id))
      return false
    const saved = result.cards.find(item => item.cardId === id)
    if (!saved)
      return false
    state.records[id] = { revision: saved.revision, hash: cardHash(saved.card) }
  }
  else {
    // Keep the previous persona and its local notebook before accepting the cloud copy.
    const backupId = nanoid()
    const notebook = useCharacterNotebookStore()
    const oldScope = notebook.resolveMemoryScope({ personaCardId: id })
    const backupScope = notebook.resolveMemoryScope({ personaCardId: backupId })
    const oldData = await notebookRepo.load(oldScope.characterId)
    if (oldData)
      await notebookRepo.update(backupScope.characterId, () => ({ ...oldData, entries: oldData.entries.map(entry => ({ ...entry, metadata: { ...entry.metadata, characterId: backupScope.characterId, personaCardId: backupId } })) }))
    const next = new Map(store.cards)
    next.set(backupId, { ...local, name: `${local.name}（旧设备备份）` })
    if (latest.deletedAt)
      next.delete(id)
    else
      next.set(id, latest.card)
    store.cards = next
    state.records[id] = { revision: latest.revision, hash: latest.deletedAt ? '' : cardHash(latest.card) }
  }
  state.conflicts = state.conflicts.filter(item => item.id !== id)
  await stateStore.setItem(ownerId, state)
  return true
}
