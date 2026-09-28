<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { useConversationNavigation } from '@proj-airi/stage-ui/composables/use-conversation-navigation'
import { useAssistantInnerVoiceNoteStore } from '@proj-airi/stage-ui/stores/chat/inner-voice-notes'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useMemoryShortTermSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-short-term'
import { summarizeChatHistoryMessage } from '@proj-airi/stage-ui/utils'
import { Button, DoubleCheckButton, FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const innerVoiceNotes = useAssistantInnerVoiceNoteStore()
const chatSession = useChatSessionStore()
const memoryShortTerm = useMemoryShortTermSettingsStore()
const airiCards = useAiriCardStore()
const { t, locale } = useI18n()
const route = useRoute()
const conversationNavigation = useConversationNavigation()
const navigationPending = ref(false)

function mt(key: string, params: Record<string, string | number> = {}) {
  return t(`settings.pages.modules.memory-short-term.${key}`, params)
}

const status = ref<'loading' | 'ready' | 'failed'>('loading')
const errorMsg = ref('')
const feedbackMessage = ref('')
const feedbackTone = ref<'neutral' | 'success' | 'error'>('neutral')
const keepCount = ref(20)
// 自动清理上限：绑定到设置 store，setter 统一经过 clamp（1..400）。
const autoCleanupLimitModel = computed({
  get: () => memoryShortTerm.settings.autoCleanupLimit,
  set: (value: number) => memoryShortTerm.setAutoCleanupLimit(value),
})
const statCardClass = 'airi-card flex-1 rounded-lg p-4'
const statLabelClass = 'text-sm text-[var(--airi-text-muted)]'
const panelClass = 'airi-surface-panel rounded-lg p-4'
const emptyStateClass = 'py-12 text-center text-[var(--airi-text-muted)]'
const messageCardClass = 'airi-card rounded-lg p-4 transition-colors hover:border-[var(--airi-border-accent)]'
const userMessageCardClass = 'border-[var(--airi-border-accent)]'
const assistantMessageCardClass = 'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)]'
const roleTextClass = 'text-xs font-semibold uppercase text-[var(--airi-text-muted)]'
const timeTextClass = 'text-xs text-[var(--airi-text-soft)]'
const previewTextClass = 'line-clamp-3 break-words text-sm text-[var(--airi-text)]'
const unattachedTitleClass = 'text-sm font-medium text-[var(--airi-text-muted)]'
const innerVoiceCountClass = 'text-2xl text-[var(--airi-accent-strong)] font-bold'
const innerVoicePendingClass = [
  'mt-3 rounded-lg border px-3 py-2 text-xs leading-5',
  'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]',
]
const innerVoiceErrorClass = 'airi-status-danger mt-3 rounded-lg px-3 py-2 text-xs leading-5'
const innerVoiceNoteCardClass = [
  'rounded-lg border px-3 py-2 text-xs leading-5',
  'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-text)]',
]
const innerVoiceMetaTextClass = 'text-[var(--airi-text-muted)]'
const innerVoiceDeleteButtonClass = [
  'inline-flex size-6 items-center justify-center rounded-md transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-hover)] hover:text-[var(--airi-text)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
]
const innerVoiceTagClass = 'rounded-full bg-[var(--airi-accent-surface)] px-2 py-0.5 text-[11px] text-[var(--airi-accent-text)]'

const viewSessionId = ref('')
const viewRoleId = ref('')
const cleanupPending = ref(false)
const deletePending = ref(false)
const starPendingMessageId = ref('')
const actionPending = computed(() => cleanupPending.value || deletePending.value || Boolean(starPendingMessageId.value))
interface ConfirmationTarget {
  sessionId: string
  userId: string
  roleId: string
  title: string
  starCount: number
  starsRevision: number
}
const deleteTarget = ref<ConfirmationTarget>()
const clearTarget = ref<ConfirmationTarget>()
// Keep a removed character's inspection row available after its last chat is deleted.
const retainedRoleOption = ref<{ id: string, label: string, userId: string }>()
const inspectionMessages = ref<ChatHistoryItem[]>([])
const inspectionStars = ref<Record<string, { starred: boolean, revision: number }>>({})
const inspectionStarsRevision = ref(0)
const inspectionLoading = ref(false)
let scopeRevision = 0
let inspectionRevision = 0
let disposed = false

function captureScope() {
  return { revision: scopeRevision, sessionId: viewSessionId.value, roleId: viewRoleId.value, userId: chatSession.sessionUserId }
}

function isCurrentScope(scope: ReturnType<typeof captureScope>) {
  return !disposed && scope.revision === scopeRevision && scope.sessionId === viewSessionId.value
    && scope.roleId === viewRoleId.value && scope.userId === chatSession.sessionUserId
}
const allSessions = computed(() => [...chatSession.directSessions, ...chatSession.groupSessions])
const roleOptions = computed(() => {
  const directIds = new Set([
    ...Array.from(airiCards.cards.keys()),
    ...chatSession.directSessions.map(meta => meta.characterId),
  ])
  const retainedRole = retainedRoleOption.value
  if (retainedRole?.userId === chatSession.sessionUserId)
    directIds.add(retainedRole.id.slice('direct:'.length))
  return [
    ...Array.from(directIds).map(characterId => ({
      id: `direct:${characterId}`,
      label: airiCards.cards.get(characterId)?.name
        || (retainedRole?.id === `direct:${characterId}` ? retainedRole.label : undefined)
        || t('base.resident.default-name'),
    })),
    ...chatSession.groupSessions.map(meta => ({
      id: `room:${meta.sessionId}`,
      label: meta.title?.trim() || meta.participants?.map(participant => participant.displayName).join('、') || mt('session-selector.group'),
    })),
  ]
})
const inspectingGroup = computed(() => viewRoleId.value.startsWith('room:'))
const sessionOptions = computed(() => allSessions.value
  .filter(meta => inspectingGroup.value
    ? meta.kind === 'room' && `room:${meta.sessionId}` === viewRoleId.value
    : meta.kind !== 'room' && `direct:${meta.characterId}` === viewRoleId.value)
  .map(meta => ({
    id: meta.sessionId,
    label: meta.title?.trim() || t('stage.chat.conversations.untitled'),
    updatedAt: meta.updatedAt,
  }))
  .sort((left, right) => right.updatedAt - left.updatedAt))
const selectedDirectSession = computed(() => chatSession.directSessions.find(meta => (
  meta.sessionId === viewSessionId.value
  && `direct:${meta.characterId}` === viewRoleId.value
  && meta.userId === chatSession.sessionUserId
)))
const deletionDisabled = computed(() => !chatSession.catalogReady || inspectionLoading.value
  || navigationPending.value || actionPending.value || !selectedDirectSession.value)

watch([viewRoleId, viewSessionId, () => chatSession.sessionUserId], () => {
  scopeRevision++
  inspectionRevision++
  inspectionMessages.value = []
  inspectionStars.value = {}
  inspectionStarsRevision.value = 0
  inspectionLoading.value = Boolean(viewSessionId.value)
  cleanupPending.value = false
  deletePending.value = false
  starPendingMessageId.value = ''
  navigationPending.value = false
  feedbackMessage.value = ''
  errorMsg.value = ''
  deleteTarget.value = undefined
  clearTarget.value = undefined
  if (retainedRoleOption.value?.id !== viewRoleId.value
    || retainedRoleOption.value?.userId !== chatSession.sessionUserId) {
    retainedRoleOption.value = undefined
  }
}, { flush: 'sync' })

function inspectSession(sessionId: string) {
  const meta = allSessions.value.find(meta => meta.sessionId === sessionId)
  if (!meta)
    return
  viewRoleId.value = meta.kind === 'room' ? `room:${meta.sessionId}` : `direct:${meta.characterId}`
  viewSessionId.value = sessionId
}
async function inspectCurrentConversation() {
  if (actionPending.value || navigationPending.value)
    return
  const scope = captureScope()
  navigationPending.value = true
  try {
    const id = conversationNavigation
      ? await conversationNavigation.getCurrentConversation()
      : chatSession.activeSessionId
    if (!isCurrentScope(scope))
      return
    if (id && allSessions.value.some(meta => meta.sessionId === id))
      inspectSession(id)
    else
      setFeedback(mt('session-selector.current-unavailable'), 'neutral')
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      navigationPending.value = false
  }
}
async function openInspectedConversation() {
  const id = viewSessionId.value
  if (!conversationNavigation || !id || navigationPending.value || actionPending.value)
    return
  const scope = captureScope()
  navigationPending.value = true
  try {
    if (!await conversationNavigation.openConversation(id) && isCurrentScope(scope))
      setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      navigationPending.value = false
  }
}
watch(roleOptions, (options) => {
  if (options.some(option => option.id === viewRoleId.value))
    return
  inspectSession(chatSession.activeSessionId)
  if (!options.some(option => option.id === viewRoleId.value))
    viewRoleId.value = options[0]?.id ?? ''
}, { immediate: true })
watch(sessionOptions, (options) => {
  if (!options.some(option => option.id === viewSessionId.value))
    viewSessionId.value = options[0]?.id ?? ''
}, { immediate: true })

async function refreshInspection() {
  const scope = captureScope()
  const sessionId = viewSessionId.value
  const revision = ++inspectionRevision
  inspectionMessages.value = []
  inspectionStars.value = {}
  inspectionLoading.value = Boolean(sessionId)
  errorMsg.value = ''
  if (!sessionId)
    return
  try {
    const record = await chatSession.readSessionForInspection(sessionId)
    if (revision === inspectionRevision && isCurrentScope(scope)) {
      inspectionMessages.value = record?.messages ?? []
      inspectionStars.value = record?.messageStars ?? {}
      inspectionStarsRevision.value = record?.meta.messageStarsRevision ?? 0
      return true
    }
  }
  catch {
    if (revision === inspectionRevision && isCurrentScope(scope))
      errorMsg.value = mt('session-selector.load-failed')
  }
  finally {
    if (revision === inspectionRevision && isCurrentScope(scope))
      inspectionLoading.value = false
  }
}
watch([
  viewSessionId,
  viewRoleId,
  () => chatSession.sessionUserId,
  () => allSessions.value.find(meta => meta.sessionId === viewSessionId.value)?.updatedAt,
  () => allSessions.value.find(meta => meta.sessionId === viewSessionId.value)?.messageStarsRevision,
], () => void refreshInspection(), { immediate: true })
const messages = computed(() => inspectionMessages.value)
const conversationMessages = computed(() => messages.value.filter(message => message.role !== 'system'))
const viewSessionIdSnapshot = computed(() => viewSessionId.value ?? '')
const assistantMessageIdsKey = computed(() => messages.value
  .filter(message => message.role === 'assistant' && message.id)
  .map(message => message.id)
  .join(':'))
const messageRows = computed(() => messages.value.map((message, index) => {
  const canResolveInnerVoice = message.role === 'assistant' && message.id && viewSessionIdSnapshot.value

  return {
    index,
    message,
    starred: Boolean(message.id && inspectionStars.value[message.id]?.starred),
    innerVoiceError: canResolveInnerVoice
      ? innerVoiceNotes.getGenerationErrorForMessage(viewSessionIdSnapshot.value, message.id)
      : undefined,
    innerVoiceGenerating: canResolveInnerVoice
      ? innerVoiceNotes.isGeneratingNoteForMessage(viewSessionIdSnapshot.value, message.id)
      : false,
    innerVoiceNote: canResolveInnerVoice
      ? innerVoiceNotes.getNoteForMessage(viewSessionIdSnapshot.value, message.id)
      : undefined,
  }
}).sort((left, right) => Number(right.starred) - Number(left.starred) || left.index - right.index))
const starredCount = computed(() => messageRows.value.filter(row => row.starred).length)
const retainableCount = computed(() => conversationMessages.value.slice(0, -keepCount.value)
  .filter(message => !message.id || !inspectionStars.value[message.id]?.starred)
  .length)
const activeSessionInnerVoiceNotes = computed(() => {
  if (!viewSessionIdSnapshot.value)
    return []

  return innerVoiceNotes.allNotes.filter(note => note.sessionId === viewSessionIdSnapshot.value && note.text.trim())
})
const messageIdsWithRows = computed(() => new Set(messages.value
  .filter(message => message.role === 'assistant' && message.id)
  .map(message => message.id)))
const unattachedInnerVoiceNotes = computed(() => activeSessionInnerVoiceNotes.value
  .filter(note => !messageIdsWithRows.value.has(note.messageId)))
const innerVoiceNoteCount = computed(() => activeSessionInnerVoiceNotes.value.length)

const statusSummary = computed(() => {
  if (errorMsg.value) {
    return {
      message: errorMsg.value,
      tone: 'error' as const,
    }
  }

  if (status.value !== 'ready') {
    return {
      message: mt(`status.${status.value}`),
      tone: 'neutral' as const,
    }
  }

  if (feedbackMessage.value) {
    return {
      message: feedbackMessage.value,
      tone: feedbackTone.value,
    }
  }

  return undefined
})

function setFeedback(message: string, tone: 'neutral' | 'success' | 'error' = 'success') {
  feedbackMessage.value = message
  feedbackTone.value = tone
}

async function hydrateInnerVoiceNotesForActiveSession() {
  if (!viewSessionIdSnapshot.value)
    return

  try {
    await innerVoiceNotes.hydrateSessionNotes(viewSessionIdSnapshot.value, 'memory-short-term')
    await nextTick()
  }
  catch (error) {
    console.warn('[Short-term Memory] Failed to hydrate inner voice notes:', error)
  }
}

function refreshInnerVoiceNotesForActiveSession() {
  void refreshInspection()
  void hydrateInnerVoiceNotesForActiveSession()
}

function refreshInnerVoiceNotesWhenVisible() {
  if (document.visibilityState === 'visible')
    refreshInnerVoiceNotesForActiveSession()
}

// 从 localStorage 加载配置
onMounted(async () => {
  const userId = chatSession.sessionUserId
  window.addEventListener('focus', refreshInnerVoiceNotesForActiveSession)
  document.addEventListener('visibilitychange', refreshInnerVoiceNotesWhenVisible)

  try {
    await chatSession.initializeForInspection()
    if (disposed || userId !== chatSession.sessionUserId)
      return

    const requestedSessionId = typeof route.query.sessionId === 'string' ? route.query.sessionId : undefined
    const requestedCharacterId = typeof route.query.characterId === 'string' ? route.query.characterId : undefined
    if (requestedSessionId && allSessions.value.some(meta => meta.sessionId === requestedSessionId))
      inspectSession(requestedSessionId)
    else if (requestedCharacterId && roleOptions.value.some(option => option.id === `direct:${requestedCharacterId}`))
      viewRoleId.value = `direct:${requestedCharacterId}`
    else
      await inspectCurrentConversation()

    if (disposed || userId !== chatSession.sessionUserId)
      return
    status.value = 'ready'

    const savedConfig = localStorage.getItem('short-term-memory-config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      keepCount.value = Math.min(400, Math.max(10, config.keepCount ?? 20))
    }
  }
  catch (error) {
    if (disposed || userId !== chatSession.sessionUserId)
      return
    errorMsg.value = mt('session-selector.load-failed')
    status.value = 'failed'
    console.error('[Short-term Memory] Error:', error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  scopeRevision++
  inspectionRevision++
  window.removeEventListener('focus', refreshInnerVoiceNotesForActiveSession)
  document.removeEventListener('visibilitychange', refreshInnerVoiceNotesWhenVisible)
})

// Keep the manual retention preference without running destructive cleanup
// from a settings-page lifecycle. 自动清理已迁移到设置 store；这里只保留
// "手动保留最近 N 条"的偏好，避免与自动清理的设置混淆。
watch(keepCount, () => {
  localStorage.setItem('short-term-memory-config', JSON.stringify({ keepCount: keepCount.value }))
})

watch([viewSessionIdSnapshot, assistantMessageIdsKey], () => {
  void hydrateInnerVoiceNotesForActiveSession()
}, { immediate: true })

// 统计信息
const stats = computed(() => {
  const msgs = conversationMessages.value
  return {
    total: msgs.length,
    user: msgs.filter(m => m.role === 'user').length,
    assistant: msgs.filter(m => m.role === 'assistant').length,
    innerVoice: innerVoiceNoteCount.value,
  }
})

// 格式化时间
function formatTime(timestamp?: number) {
  if (timestamp === undefined)
    return '—'
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))

  if (diffMins < 1)
    return mt('time.just-now')
  if (diffMins < 60)
    return mt('time.minutes-ago', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24)
    return mt('time.hours-ago', { count: diffHours })
  return date.toLocaleString(locale.value)
}

// 获取消息预览
function getPreview(message: ChatHistoryItem) {
  return summarizeChatHistoryMessage(message, {
    maxLength: 160,
    toolLimit: 4,
  })
}

const mutationDisabled = computed(() => !chatSession.catalogReady || inspectionLoading.value
  || !viewSessionId.value || actionPending.value || navigationPending.value)

function confirmationTarget(): ConfirmationTarget {
  return {
    sessionId: viewSessionId.value,
    userId: chatSession.sessionUserId,
    roleId: viewRoleId.value,
    title: allSessions.value.find(meta => meta.sessionId === viewSessionId.value)?.title?.trim()
      || t('stage.chat.conversations.untitled'),
    starCount: starredCount.value,
    starsRevision: inspectionStarsRevision.value,
  }
}

function matchesConfirmation(target: ConfirmationTarget) {
  return target.sessionId === viewSessionId.value && target.roleId === viewRoleId.value
    && target.userId === chatSession.sessionUserId
}

function resetConfirmations() {
  clearTarget.value = undefined
  deleteTarget.value = undefined
}

async function toggleMessageStar(messageId?: string) {
  if (mutationDisabled.value || !messageId)
    return
  const scope = captureScope()
  const desired = !inspectionStars.value[messageId]?.starred
  starPendingMessageId.value = messageId
  resetConfirmations()
  feedbackMessage.value = ''
  try {
    await chatSession.setMessageStarred(scope.sessionId, messageId, desired)
    if (isCurrentScope(scope) && await refreshInspection() && isCurrentScope(scope))
      setFeedback(mt(desired ? 'favorites.saved' : 'favorites.removed'))
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('favorites.failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      starPendingMessageId.value = ''
  }
}

function requestClearAll() {
  if (mutationDisabled.value)
    return
  deleteTarget.value = undefined
  clearTarget.value = confirmationTarget()
}

async function clearAll() {
  const target = clearTarget.value
  if (mutationDisabled.value || !target || !matchesConfirmation(target))
    return
  const scope = captureScope()
  cleanupPending.value = true
  resetConfirmations()
  feedbackMessage.value = ''
  try {
    const result = await chatSession.cleanupMessages(target.sessionId, { expectedMessageStarsRevision: target.starsRevision })
    if (!result)
      throw new Error('Cleanup was not completed')
    if (isCurrentScope(scope) && await refreshInspection() && isCurrentScope(scope))
      setFeedback(mt(result.innerVoiceCleanupFailed ? 'manual-cleanup.notes-failed' : 'manual-cleanup.cleared'), result.innerVoiceCleanupFailed ? 'error' : 'success')
  }
  catch {
    if (isCurrentScope(scope)) {
      await refreshInspection()
      if (isCurrentScope(scope))
        setFeedback(mt('manual-cleanup.clear-failed'), 'error')
    }
  }
  finally {
    if (isCurrentScope(scope))
      cleanupPending.value = false
  }
}

async function clearInnerVoiceNotes() {
  if (mutationDisabled.value)
    return
  const scope = captureScope()
  cleanupPending.value = true
  resetConfirmations()
  try {
    const deletedNotes = await innerVoiceNotes.deleteNotesForSession(scope.sessionId)
    if (!isCurrentScope(scope))
      return
    setFeedback(
      deletedNotes.length > 0
        ? mt('inner-voice.cleared', { count: deletedNotes.length })
        : mt('inner-voice.none'),
      deletedNotes.length > 0 ? 'success' : 'neutral',
    )
    await nextTick()
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('inner-voice.delete-failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      cleanupPending.value = false
  }
}

// 保留最近N条（作用于当前选中的记忆会话）。
async function keepRecent() {
  if (mutationDisabled.value)
    return
  const scope = captureScope()
  const count = keepCount.value
  cleanupPending.value = true
  resetConfirmations()
  try {
    const result = await chatSession.retainRecentMessages(scope.sessionId, count)
    if (isCurrentScope(scope) && await refreshInspection() && isCurrentScope(scope)) {
      const removed = result.removedMessageIds.length
      if (result.innerVoiceCleanupFailed)
        setFeedback(mt('manual-cleanup.notes-failed'), 'error')
      else
        setFeedback(removed > 0 ? mt('manual-cleanup.retained', { removed, count }) : mt('manual-cleanup.nothing-to-remove'), removed > 0 ? 'success' : 'neutral')
    }
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('manual-cleanup.retain-failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      cleanupPending.value = false
  }
}

async function deleteInnerVoiceNoteForMessage(messageId?: string, sessionId = viewSessionIdSnapshot.value) {
  if (mutationDisabled.value || sessionId !== viewSessionId.value || !messageId)
    return
  const scope = captureScope()
  cleanupPending.value = true
  resetConfirmations()
  try {
    const deletedNote = await innerVoiceNotes.deleteNoteForMessage(sessionId, String(messageId))
    if (!isCurrentScope(scope))
      return
    setFeedback(mt(deletedNote ? 'inner-voice.deleted' : 'inner-voice.none'), deletedNote ? 'success' : 'neutral')
    await nextTick()
  }
  catch {
    if (isCurrentScope(scope))
      setFeedback(mt('inner-voice.delete-failed'), 'error')
  }
  finally {
    if (isCurrentScope(scope))
      cleanupPending.value = false
  }
}

function requestConversationDeletion() {
  const session = selectedDirectSession.value
  if (deletionDisabled.value || !session)
    return
  clearTarget.value = undefined
  deleteTarget.value = confirmationTarget()
}

async function deleteInspectedConversation() {
  const target = deleteTarget.value
  if (deletionDisabled.value || !target || !matchesConfirmation(target))
    return
  const scope = captureScope()
  deletePending.value = true
  errorMsg.value = ''
  feedbackMessage.value = ''
  const role = roleOptions.value.find(option => option.id === target.roleId)
  if (role)
    retainedRoleOption.value = { ...role, userId: target.userId }
  try {
    const deleted = await chatSession.deleteSession(target.sessionId, { expectedMessageStarsRevision: target.starsRevision })
    if (!isCurrentScope(scope))
      return
    if (!deleted) {
      setFeedback(mt('delete-conversation.failed'), 'error')
      return
    }
    await chatSession.refreshFromPersistence()
    if (!isCurrentScope(scope))
      return
    await nextTick()
    await refreshInspection()
    if (isCurrentScope(scope))
      setFeedback(mt('delete-conversation.success', { title: target.title }))
  }
  catch {
    if (isCurrentScope(scope)) {
      await refreshInspection()
      if (!isCurrentScope(scope))
        return
      setFeedback(mt('delete-conversation.failed'), 'error')
    }
  }
  finally {
    if (isCurrentScope(scope)) {
      deleteTarget.value = undefined
      deletePending.value = false
    }
  }
}
</script>

<template>
  <div
    class="h-full min-h-0 overflow-y-auto p-6 space-y-6"
    style="scrollbar-gutter: stable; scrollbar-width: thin;"
  >
    <div
      v-if="statusSummary"
      :class="[
        'rounded-lg px-4 py-3 text-sm',
        statusSummary.tone === 'error'
          ? 'airi-status-danger'
          : statusSummary.tone === 'success'
            ? 'airi-status-success'
            : 'airi-status-neutral',
      ]"
    >
      {{ statusSummary.message }}
    </div>

    <div :class="panelClass">
      <div :class="['grid gap-3 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          {{ mt('session-selector.role-label') }}
          <select v-model="viewRoleId" :disabled="actionPending || navigationPending" :class="['w-full rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card-base)] px-3 py-2 text-sm disabled:opacity-50']">
            <option v-for="option in roleOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="!inspectingGroup" :class="['flex flex-col gap-2 text-sm font-medium']">
          {{ mt('session-selector.label') }}
          <select v-model="viewSessionId" :disabled="!sessionOptions.length || actionPending || navigationPending" :class="['w-full rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card-base)] px-3 py-2 text-sm disabled:opacity-50']">
            <option v-if="!sessionOptions.length" value="">{{ mt('session-selector.empty') }}</option>
            <option v-for="option in sessionOptions" :key="option.id" :value="option.id">{{ option.label }} · {{ new Date(option.updatedAt).toLocaleString(locale) }}</option>
          </select>
        </label>
      </div>
      <p class="mt-3 text-xs text-[var(--airi-text-muted)]">
        {{ mt('session-selector.description') }}
      </p>
      <p :class="['mt-2 text-xs text-[var(--airi-text-muted)] leading-5']">
        {{ mt('session-selector.context-description') }}
      </p>
      <div :class="['mt-3 flex flex-wrap gap-2']">
        <button type="button" :disabled="navigationPending || actionPending" :class="['rounded-md px-3 py-2 text-xs airi-overlay-control-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="inspectCurrentConversation">
          {{ mt('session-selector.current') }}
        </button>
        <button v-if="conversationNavigation" type="button" :disabled="navigationPending || actionPending || inspectionLoading || !viewSessionId" :class="['rounded-md px-3 py-2 text-xs airi-overlay-control-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="openInspectedConversation">
          {{ mt('session-selector.open') }}
        </button>
      </div>
      <p v-if="inspectionLoading" role="status" :class="['mt-2 text-sm text-[var(--airi-text-muted)]']">
        {{ mt('session-selector.loading') }}
      </p>
    </div>

    <!-- 统计卡片 -->
    <div :class="['grid grid-cols-2 gap-4 lg:grid-cols-4']">
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('session-selector.saved-count') }}
        </div>
        <div class="text-2xl font-bold">
          {{ stats.total }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.user') }}
        </div>
        <div class="text-2xl text-[var(--airi-accent-strong)] font-bold">
          {{ stats.user }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.assistant') }}
        </div>
        <div class="text-2xl text-[var(--airi-accent-text)] font-bold">
          {{ stats.assistant }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('inner-voice.title') }}
        </div>
        <div :class="innerVoiceCountClass">
          {{ stats.innerVoice }}
        </div>
      </div>
    </div>

    <!-- 自动清理设置 -->
    <div :class="panelClass">
      <h3 class="mb-4 text-lg font-semibold">
        {{ mt('auto-cleanup.title') }}
      </h3>
      <div class="space-y-4">
        <FieldCheckbox
          v-model="memoryShortTerm.settings.autoCleanupEnabled"
          :label="mt('auto-cleanup.enabled-label')"
          :description="mt('auto-cleanup.enabled-description')"
        />
        <FieldRange
          v-model="autoCleanupLimitModel"
          :label="mt('auto-cleanup.limit-label')"
          :description="mt('auto-cleanup.limit-description')"
          :min="1"
          :max="400"
          :step="1"
          :format-value="value => `${value} ${mt('auto-cleanup.unit')}`"
        />
      </div>
    </div>

    <!-- 手动清理操作 -->
    <div :class="panelClass">
      <h3 :class="['mb-4 text-lg font-semibold']">
        {{ mt('manual-cleanup.title') }}
      </h3>

      <div :class="['mb-4 max-w-sm']">
        <label :class="['mb-2 block text-sm font-medium']">
          {{ mt('manual-cleanup.keep-count', { count: keepCount }) }}
        </label>
        <input
          v-model.number="keepCount"
          type="range"
          min="10"
          max="400"
          step="5"
          :disabled="actionPending"
          :class="['w-full disabled:opacity-50']"
        >
        <p :class="['mt-1 text-xs text-[var(--airi-text-muted)]']">
          {{ mt('manual-cleanup.description') }}
        </p>
      </div>

      <div :key="`${chatSession.sessionUserId}:${viewRoleId}:${viewSessionId}`" :class="['flex flex-wrap items-start gap-2']">
        <DoubleCheckButton
          variant="caution"
          size="sm"
          :disabled="mutationDisabled || retainableCount === 0"
          @confirm="keepRecent"
        >
          {{ mt('manual-cleanup.keep', { count: keepCount }) }}
          <template #confirm>
            {{ mt('manual-cleanup.confirm-keep', { count: keepCount }) }}
          </template>
          <template #cancel>
            {{ mt('delete-conversation.cancel') }}
          </template>
        </DoubleCheckButton>
        <DoubleCheckButton
          variant="caution"
          size="sm"
          :disabled="!chatSession.catalogReady || inspectionLoading || actionPending || navigationPending || innerVoiceNoteCount === 0"
          @confirm="clearInnerVoiceNotes"
        >
          {{ mt('inner-voice.clear') }}
          <template #confirm>
            {{ mt('inner-voice.confirm-clear') }}
          </template>
          <template #cancel>
            {{ mt('delete-conversation.cancel') }}
          </template>
        </DoubleCheckButton>
        <Button
          variant="danger"
          size="sm"
          :disabled="mutationDisabled || messages.length === 0"
          @click="requestClearAll"
        >
          {{ mt('manual-cleanup.clear-all') }}
        </Button>
      </div>

      <div v-if="clearTarget" role="alert" :class="['mt-3 rounded-lg border border-[var(--airi-border-subtle)] p-3 space-y-3']">
        <p :class="['break-words text-sm text-[var(--airi-text)]']">
          {{ mt('manual-cleanup.confirm-clear', { title: clearTarget.title, count: clearTarget.starCount }) }}
        </p>
        <div :class="['flex flex-wrap gap-2']">
          <Button size="sm" variant="danger" :disabled="mutationDisabled" @click="clearAll">
            {{ mt('manual-cleanup.confirm-clear-action') }}
          </Button>
          <Button size="sm" variant="secondary" :disabled="actionPending" @click="clearTarget = undefined">
            {{ mt('delete-conversation.cancel') }}
          </Button>
        </div>
      </div>

      <div
        v-if="!inspectingGroup"
        :aria-busy="deletePending"
        :class="['mt-5 flex flex-col gap-3 border-t border-[var(--airi-border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between']"
      >
        <div :class="['min-w-0 flex-1 space-y-1']">
          <h4 :class="['flex items-center gap-2 text-sm font-medium text-[var(--airi-text)]']">
            <span aria-hidden="true" :class="['i-solar:trash-bin-2-bold-duotone size-4 shrink-0 text-[var(--airi-text-muted)]']" />
            {{ mt('delete-conversation.title') }}
          </h4>
          <p v-if="deleteTarget" role="status" :class="['break-words text-sm font-medium text-[var(--airi-text)]']">
            {{ mt('delete-conversation.confirm-description', { title: deleteTarget.title, count: deleteTarget.starCount }) }}
          </p>
          <p v-else :class="['break-words text-xs text-[var(--airi-text-muted)] leading-5']">
            {{ mt('delete-conversation.description') }}
          </p>
          <p :class="['text-xs text-[var(--airi-text-muted)] leading-5']">
            {{ mt('delete-conversation.scope') }}
          </p>
        </div>
        <div :class="['flex shrink-0 flex-wrap items-center gap-2']">
          <Button
            v-if="deleteTarget && !deletePending"
            type="button"
            size="sm"
            variant="secondary"
            @click="deleteTarget = undefined"
          >
            {{ mt('delete-conversation.cancel') }}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            :disabled="deletionDisabled"
            :loading="deletePending"
            :class="['whitespace-nowrap']"
            @click="deleteTarget ? deleteInspectedConversation() : requestConversationDeletion()"
          >
            {{ mt(deletePending ? 'delete-conversation.pending' : deleteTarget ? 'delete-conversation.confirm' : 'delete-conversation.action') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="space-y-3">
      <h3 class="text-lg font-semibold">
        {{ mt('history.title', { count: messages.length }) }}
      </h3>
      <p role="status" :class="['text-sm text-[var(--airi-text-muted)]']">
        {{ mt(starredCount ? 'favorites.count' : 'favorites.empty', { count: starredCount }) }}
      </p>
      <p :class="['text-xs text-[var(--airi-text-muted)] leading-5']">
        {{ mt('favorites.description') }}
      </p>

      <div v-if="messages.length === 0" :class="emptyStateClass">
        {{ mt('history.empty') }}
      </div>

      <div
        v-for="row in messageRows"
        v-else
        :key="row.message.id || row.index"
        :class="[
          messageCardClass,
          {
            [userMessageCardClass]: row.message.role === 'user',
            [assistantMessageCardClass]: row.message.role === 'assistant',
          },
        ]"
      >
        <div class="mb-2 flex flex-wrap items-start justify-between gap-2">
          <span :class="roleTextClass">
            {{ mt(row.message.role === 'user' ? 'history.user' : row.message.role === 'assistant' ? 'history.assistant' : 'history.system') }}
          </span>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <span :class="timeTextClass">{{ formatTime(row.message.createdAt) }}</span>
            <button
              type="button"
              :aria-pressed="row.starred"
              :aria-label="mt(row.starred ? 'favorites.unstar' : 'favorites.star')"
              :title="mt(!row.message.id ? 'favorites.unavailable' : row.starred ? 'favorites.unstar' : 'favorites.star')"
              :aria-busy="starPendingMessageId === row.message.id"
              :disabled="mutationDisabled || !row.message.id"
              :class="[innerVoiceDeleteButtonClass, 'size-8', row.starred ? 'text-[var(--airi-accent-strong)]' : '']"
              @click="toggleMessageStar(row.message.id)"
            >
              <span aria-hidden="true" :class="['size-4', starPendingMessageId === row.message.id ? 'i-svg-spinners:ring-resize' : row.starred ? 'i-ph:star-fill' : 'i-ph:star']" />
            </button>
          </div>
        </div>
        <div :class="previewTextClass">
          {{ getPreview(row.message) }}
        </div>
        <div
          v-if="row.innerVoiceGenerating && !row.innerVoiceNote?.text"
          :class="innerVoicePendingClass"
        >
          {{ mt('inner-voice.generating') }}
        </div>
        <div
          v-else-if="row.innerVoiceError && !row.innerVoiceNote?.text"
          :class="innerVoiceErrorClass"
        >
          {{ mt('inner-voice.generation-failed', { error: row.innerVoiceError }) }}
        </div>
        <div
          v-if="row.innerVoiceNote?.text"
          :class="['mt-3', innerVoiceNoteCardClass]"
        >
          <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
            <span class="min-w-0 flex items-center gap-1.5">
              <span class="i-ph:heart-straight-duotone size-3.5 shrink-0" />
              <span>{{ mt('inner-voice.title') }}</span>
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <span :class="innerVoiceMetaTextClass">
                {{ formatTime(row.innerVoiceNote.updatedAt) }}
              </span>
              <button
                type="button"
                :disabled="actionPending || navigationPending"
                :class="innerVoiceDeleteButtonClass"
                :aria-label="mt('inner-voice.delete')"
                :title="mt('inner-voice.delete')"
                @click.stop="deleteInnerVoiceNoteForMessage(row.message.id)"
              >
                <span class="i-solar:trash-bin-2-bold-duotone size-3.5" />
              </button>
            </div>
          </div>
          <div whitespace-pre-wrap>
            {{ row.innerVoiceNote.text }}
          </div>
          <div v-if="row.innerVoiceNote.moodTags?.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="tag in row.innerVoiceNote.moodTags"
              :key="tag"
              :class="innerVoiceTagClass"
            >
              #{{ tag }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="unattachedInnerVoiceNotes.length" class="space-y-3">
        <h4 :class="unattachedTitleClass">
          {{ mt('inner-voice.unattached', { count: unattachedInnerVoiceNotes.length }) }}
        </h4>
        <div
          v-for="note in unattachedInnerVoiceNotes"
          :key="note.id"
          :class="innerVoiceNoteCardClass"
        >
          <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
            <span class="min-w-0 flex items-center gap-1.5">
              <span class="i-ph:heart-straight-duotone size-3.5 shrink-0" />
              <span>{{ mt('inner-voice.title') }}</span>
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <span :class="innerVoiceMetaTextClass">
                {{ formatTime(note.updatedAt) }}
              </span>
              <button
                type="button"
                :disabled="actionPending || navigationPending"
                :class="innerVoiceDeleteButtonClass"
                :aria-label="mt('inner-voice.delete')"
                :title="mt('inner-voice.delete')"
                @click.stop="deleteInnerVoiceNoteForMessage(note.messageId, note.sessionId)"
              >
                <span class="i-solar:trash-bin-2-bold-duotone size-3.5" />
              </button>
            </div>
          </div>
          <div whitespace-pre-wrap>
            {{ note.text }}
          </div>
          <div :class="['mt-1 text-[11px]', innerVoiceMetaTextClass]">
            {{ mt('inner-voice.message', { id: note.messageId }) }}
          </div>
          <div v-if="note.moodTags?.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="tag in note.moodTags"
              :key="tag"
              :class="innerVoiceTagClass"
            >
              #{{ tag }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-short-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
