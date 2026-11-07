<script setup lang="ts">
import { getOfficialApiFetch, SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { syncPersonaCards } from '@proj-airi/stage-ui/libs/persona-card-sync'
import { syncEnabledCharacterMemories } from '@proj-airi/stage-ui/libs/shared-memory-sync'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

const props = defineProps<{ settingsPath: string, noticesEnabled?: boolean }>()
const auth = useAuthStore()
const cards = useAiriCardStore()
const router = useRouter()
const notified = new Set<string>()
const visibleNoticeIds = new Set<string>()
let timer: ReturnType<typeof setInterval> | undefined
let cardSyncTimer: ReturnType<typeof setTimeout> | undefined
const personaUpdatePending = new Set<string>()

function canShowNotice() {
  return props.noticesEnabled !== false && !document.hidden
}

function dismissNotices() {
  for (const id of visibleNoticeIds)
    toast.dismiss(id)
  visibleNoticeIds.clear()
}

async function updateQqPersonas(ownerId: string, accounts: Array<{ id: string, characterId: string, personaPromptHash: string | null }>, conflictingCardIds: Set<string>) {
  if (!globalThis.crypto?.subtle)
    return
  for (const account of accounts) {
    if (auth.user?.id !== ownerId)
      return
    if (!account.characterId.startsWith('local:') || personaUpdatePending.has(account.id))
      continue
    const cardId = account.characterId.slice(6)
    if (conflictingCardIds.has(cardId))
      continue
    const runtime = cards.getCardRuntime(cardId)
    if (!runtime?.systemPrompt || runtime.systemPrompt.length > 30_000)
      continue
    const persona = { name: runtime.displayName.trim(), prompt: runtime.systemPrompt.trim() }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([persona.name, persona.prompt])))
    if (auth.user?.id !== ownerId)
      return
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash === account.personaPromptHash)
      continue
    personaUpdatePending.add(account.id)
    try {
      const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/accounts/${account.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: account.characterId, persona }),
      })
      if (!response.ok)
        console.warn('[QQ] Persona snapshot refresh failed:', response.status)
    }
    catch (error) {
      console.warn('[QQ] Persona snapshot refresh failed:', error)
    }
    finally {
      personaUpdatePending.delete(account.id)
    }
  }
}

async function check() {
  const ownerId = auth.user?.id
  if (!auth.isAuthenticated || !ownerId)
    return
  // Reconcile cards before memory: a newly downloaded persona needs a local memory scope.
  let conflictingCardIds = new Set<string>()
  let cardsSynced = false
  try {
    const conflicts = await syncPersonaCards()
    if (auth.user?.id !== ownerId)
      return
    cardsSynced = true
    conflictingCardIds = new Set(conflicts.map(conflict => conflict.id))
    if (conflicts.length && canShowNotice()) {
      toast.warning(`${conflicts.length} 张角色卡在不同设备上都被修改，请在角色卡设置中选择版本`, { id: 'persona-card-conflict', duration: 8000 })
      visibleNoticeIds.add('persona-card-conflict')
    }
  }
  catch (error) {
    console.warn('[PersonaCards] Background sync failed:', error)
  }
  if (auth.user?.id !== ownerId)
    return
  void syncEnabledCharacterMemories().catch(error => console.warn('[SharedMemory] Background sync failed:', error))
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/diaries?limit=1`, { credentials: 'include' })
    if (response.ok) {
      const diaries = await response.json() as Array<{ id: string, metadata?: { diaryTitle?: string } }>
      const latest = diaries[0]
      const storageKey = `airi-qq-diary-notified:${ownerId}`
      if (latest && latest.id !== localStorage.getItem(storageKey) && canShowNotice()) {
        localStorage.setItem(storageKey, latest.id)
        const id = `qq-diary-${latest.id}`
        toast.info('角色写下了一篇新的 QQ 日记', {
          id,
          description: latest.metadata?.diaryTitle || '点击查看今天的日记',
          duration: 10_000,
          action: { label: '查看日记', onClick: () => void router.push(props.settingsPath) },
        })
        visibleNoticeIds.add(id)
      }
    }
  }
  catch (error) {
    console.warn('[QQ diary] Notification check failed:', error)
  }
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/accounts`, { credentials: 'include' })
    if (!response.ok)
      return
    const accounts = await response.json() as Array<{ id: string, selfId: string, status: string, connectionState: string, characterId: string, personaPromptHash: string | null }>
    if (auth.user?.id !== ownerId)
      return
    if (cardsSynced)
      void updateQqPersonas(ownerId, accounts, conflictingCardIds)
    const current = new Set(accounts.filter(account => account.status === 'active' && account.connectionState === 'authorization_required').map(account => account.id))
    for (const account of accounts) {
      if (!current.has(account.id) || notified.has(account.id) || !canShowNotice())
        continue
      const id = `qq-reauth-${account.id}`
      toast.warning(`QQ ${account.selfId} 需要重新登录`, {
        id,
        description: '自动回复已暂停，扫码确认后会恢复。',
        duration: 10_000,
        action: { label: '去重连', onClick: () => void router.push(props.settingsPath) },
      })
      visibleNoticeIds.add(id)
      notified.add(account.id)
    }
    for (const id of notified) {
      if (!current.has(id))
        notified.delete(id)
    }
  }
  catch {
    // QQ status notifications must not interrupt the main app.
  }
}

function onVisible() {
  if (canShowNotice())
    void check()
  else
    dismissNotices()
}

onMounted(() => {
  void check()
  timer = setInterval(() => void check(), 60_000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onVisible)
})
onUnmounted(() => {
  dismissNotices()
  if (timer)
    clearInterval(timer)
  if (cardSyncTimer)
    clearTimeout(cardSyncTimer)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onVisible)
})
watch(() => props.noticesEnabled, (enabled) => {
  if (enabled === false)
    dismissNotices()
  else
    void check()
})
watch(() => cards.cards, () => {
  if (!auth.isAuthenticated)
    return
  if (cardSyncTimer)
    clearTimeout(cardSyncTimer)
  cardSyncTimer = setTimeout(() => void check(), 1500)
}, { deep: true })
watch(() => auth.isAuthenticated, (authenticated) => {
  if (authenticated)
    void check()
  else
    notified.clear()
})
</script>

<template>
  <span class="hidden" aria-hidden="true" />
</template>
