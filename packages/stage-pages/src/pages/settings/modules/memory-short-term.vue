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

const status = ref('正在加载...')
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
const actionPending = computed(() => cleanupPending.value || deletePending.value)
const deleteTarget = ref<{ sessionId: string, userId: string, roleId: string, title: string }>()
// Keep a removed character's inspection row available after its last chat is deleted.
const retainedRoleOption = ref<{ id: string, label: string, userId: string }>()
const inspectionMessages = ref<ChatHistoryItem[]>([])
const inspectionLoading = ref(false)
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
  deleteTarget.value = undefined
  if (retainedRoleOption.value?.id !== viewRoleId.value
    || retainedRoleOption.value?.userId !== chatSession.sessionUserId)
    retainedRoleOption.value = undefined
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
  navigationPending.value = true
  try {
    const id = conversationNavigation
      ? await conversationNavigation.getCurrentConversation()
      : chatSession.activeSessionId
    if (id && allSessions.value.some(meta => meta.sessionId === id))
      inspectSession(id)
    else
      setFeedback(mt('session-selector.current-unavailable'), 'neutral')
  }
  catch {
    setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  finally {
    navigationPending.value = false
  }
}
async function openInspectedConversation() {
  const id = viewSessionId.value
  if (!conversationNavigation || !id || navigationPending.value || actionPending.value)
    return
  navigationPending.value = true
  try {
    if (!await conversationNavigation.openConversation(id))
      setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  catch {
    setFeedback(mt('session-selector.navigation-failed'), 'error')
  }
  finally {
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

let inspectionRevision = 0
async function refreshInspection() {
  const sessionId = viewSessionId.value
  const revision = ++inspectionRevision
  inspectionMessages.value = []
  inspectionLoading.value = Boolean(sessionId)
  errorMsg.value = ''
  if (!sessionId)
    return
  try {
    const record = await chatSession.readSessionForInspection(sessionId)
    if (revision === inspectionRevision)
      inspectionMessages.value = record?.messages ?? []
  }
  catch {
    if (revision === inspectionRevision)
      errorMsg.value = mt('session-selector.load-failed')
  }
  finally {
    if (revision === inspectionRevision)
      inspectionLoading.value = false
  }
}
watch([
  viewSessionId,
  () => allSessions.value.find(meta => meta.sessionId === viewSessionId.value)?.updatedAt,
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
}))
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

  if (status.value !== '加载成功') {
    return {
      message: status.value,
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

function getAssistantMessageIdsFromMessages(sourceMessages: ChatHistoryItem[]) {
  return Array.from(new Set(sourceMessages
    .filter(message => message.role === 'assistant' && message.id)
    .map(message => String(message.id))))
}

async function deleteInnerVoiceNotesForMessages(sessionId: string, sourceMessages: ChatHistoryItem[]) {
  if (!sessionId)
    return 0

  const messageIds = getAssistantMessageIdsFromMessages(sourceMessages)
  const deletedNotes = await Promise.all(
    messageIds.map(messageId => innerVoiceNotes.deleteNoteForMessage(sessionId, messageId)),
  )
  return deletedNotes.filter(note => Boolean(note)).length
}

function formatInnerVoiceDeleteSuffix(deletedCount: number) {
  return deletedCount > 0 ? `，同步删除 ${deletedCount} 条心声札记` : ''
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
  window.addEventListener('focus', refreshInnerVoiceNotesForActiveSession)
  document.addEventListener('visibilitychange', refreshInnerVoiceNotesWhenVisible)

  try {
    await chatSession.initializeForInspection()

    const requestedSessionId = typeof route.query.sessionId === 'string' ? route.query.sessionId : undefined
    const requestedCharacterId = typeof route.query.characterId === 'string' ? route.query.characterId : undefined
    if (requestedSessionId && allSessions.value.some(meta => meta.sessionId === requestedSessionId))
      inspectSession(requestedSessionId)
    else if (requestedCharacterId && roleOptions.value.some(option => option.id === `direct:${requestedCharacterId}`))
      viewRoleId.value = `direct:${requestedCharacterId}`
    else
      await inspectCurrentConversation()

    status.value = '加载成功'

    const savedConfig = localStorage.getItem('short-term-memory-config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      keepCount.value = Math.min(400, Math.max(10, config.keepCount ?? 20))
    }
  }
  catch (error) {
    errorMsg.value = error instanceof Error ? error.message : String(error)
    status.value = '加载失败'
    console.error('[Short-term Memory] Error:', error)
  }
})

onBeforeUnmount(() => {
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
    system: msgs.filter(m => m.role === 'system').length,
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
    return '刚刚'
  if (diffMins < 60)
    return `${diffMins} 分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24)
    return `${diffHours} 小时前`
  return date.toLocaleString('zh-CN')
}

// 获取消息预览
function getPreview(message: ChatHistoryItem) {
  return summarizeChatHistoryMessage(message, {
    maxLength: 160,
    toolLimit: 4,
  })
}

// 清空所有消息（作用于当前选中的记忆会话）。
async function clearAll() {
  if (!chatSession.catalogReady || inspectionLoading.value || !viewSessionId.value || actionPending.value || navigationPending.value)
    return

  cleanupPending.value = true
  deleteTarget.value = undefined
  try {
    const sessionId = viewSessionIdSnapshot.value
    const deletedInnerVoiceCount = sessionId
      ? (await innerVoiceNotes.deleteNotesForSession(sessionId)).length
      : 0

    await chatSession.cleanupMessages(sessionId || undefined)
    await refreshInspection()
    setFeedback(`消息已清空${formatInnerVoiceDeleteSuffix(deletedInnerVoiceCount)}`)
    await nextTick()
  }
  catch (error) {
    setFeedback(`清空失败: ${error}`, 'error')
  }
  finally {
    cleanupPending.value = false
  }
}

async function clearInnerVoiceNotes() {
  if (!chatSession.catalogReady || inspectionLoading.value || !viewSessionIdSnapshot.value || actionPending.value || navigationPending.value)
    return

  cleanupPending.value = true
  deleteTarget.value = undefined
  try {
    const deletedNotes = await innerVoiceNotes.deleteNotesForSession(viewSessionIdSnapshot.value)
    setFeedback(
      deletedNotes.length > 0
        ? `已清理 ${deletedNotes.length} 条心声札记`
        : '没有可清理的心声札记',
      deletedNotes.length > 0 ? 'success' : 'neutral',
    )
    await nextTick()
  }
  catch (error) {
    setFeedback(`清理心声札记失败: ${error}`, 'error')
  }
  finally {
    cleanupPending.value = false
  }
}

// 保留最近N条（作用于当前选中的记忆会话）。
async function keepRecent() {
  if (!chatSession.catalogReady || inspectionLoading.value || !viewSessionId.value || actionPending.value || navigationPending.value)
    return

  const sessionId = viewSessionIdSnapshot.value
  const msgs = messages.value
  if (msgs.length <= keepCount.value) {
    setFeedback('消息数量未超过保留数量', 'neutral')
    return
  }

  const toRemove = msgs.length - keepCount.value
  cleanupPending.value = true
  deleteTarget.value = undefined
  try {
    const removedMessages = msgs.slice(0, toRemove)
    const deletedInnerVoiceCount = await deleteInnerVoiceNotesForMessages(sessionId, removedMessages)
    await chatSession.retainRecentMessages(sessionId, keepCount.value)
    if (viewSessionId.value === sessionId)
      await refreshInspection()
    setFeedback(`已删除 ${toRemove} 条旧消息，保留最近 ${keepCount.value} 条消息${formatInnerVoiceDeleteSuffix(deletedInnerVoiceCount)}`)
    await nextTick()
  }
  catch (error) {
    setFeedback(`删除旧消息失败: ${error}`, 'error')
  }
  finally {
    cleanupPending.value = false
  }
}

async function deleteInnerVoiceNoteForMessage(messageId?: string, sessionId = viewSessionIdSnapshot.value) {
  if (!sessionId || !messageId || actionPending.value || navigationPending.value)
    return

  cleanupPending.value = true
  deleteTarget.value = undefined
  try {
    const deletedNote = await innerVoiceNotes.deleteNoteForMessage(sessionId, String(messageId))
    setFeedback(deletedNote ? '心声札记已删除，可在聊天继续时重新生成' : '没有找到可删除的心声札记', deletedNote ? 'success' : 'neutral')
    await nextTick()
  }
  catch (error) {
    setFeedback(`删除心声札记失败: ${error}`, 'error')
  }
  finally {
    cleanupPending.value = false
  }
}

function requestConversationDeletion() {
  const session = selectedDirectSession.value
  if (deletionDisabled.value || !session)
    return
  // Freeze the confirmation target so a changed selection cannot delete another chat.
  deleteTarget.value = {
    sessionId: session.sessionId,
    userId: chatSession.sessionUserId,
    roleId: viewRoleId.value,
    title: session.title?.trim() || t('stage.chat.conversations.untitled'),
  }
}

async function deleteInspectedConversation() {
  const target = deleteTarget.value
  if (deletionDisabled.value || !target
    || target.sessionId !== viewSessionId.value || target.roleId !== viewRoleId.value
    || target.userId !== chatSession.sessionUserId)
    return

  deletePending.value = true
  errorMsg.value = ''
  feedbackMessage.value = ''
  const role = roleOptions.value.find(option => option.id === target.roleId)
  if (role)
    retainedRoleOption.value = { ...role, userId: target.userId }
  try {
    const deleted = await chatSession.deleteSession(target.sessionId)
    if (target.userId !== chatSession.sessionUserId)
      return
    if (!deleted) {
      setFeedback(mt('delete-conversation.failed'), 'error')
      return
    }
    await chatSession.refreshFromPersistence()
    if (target.userId !== chatSession.sessionUserId)
      return
    await nextTick()
    await refreshInspection()
    if (target.userId === chatSession.sessionUserId)
      setFeedback(mt('delete-conversation.success', { title: target.title }))
  }
  catch {
    if (target.userId === chatSession.sessionUserId)
      setFeedback(mt('delete-conversation.failed'), 'error')
  }
  finally {
    deleteTarget.value = undefined
    deletePending.value = false
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
      <p :class="['mt-2 text-xs text-[var(--airi-text-muted)] leading-5']">{{ mt('session-selector.context-description') }}</p>
      <div :class="['mt-3 flex flex-wrap gap-2']">
        <button type="button" :disabled="navigationPending || actionPending" :class="['rounded-md px-3 py-2 text-xs airi-overlay-control-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="inspectCurrentConversation">
          {{ mt('session-selector.current') }}
        </button>
        <button v-if="conversationNavigation" type="button" :disabled="navigationPending || actionPending || inspectionLoading || !viewSessionId" :class="['rounded-md px-3 py-2 text-xs airi-overlay-control-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="openInspectedConversation">
          {{ mt('session-selector.open') }}
        </button>
      </div>
      <p v-if="inspectionLoading" role="status" :class="['mt-2 text-sm text-[var(--airi-text-muted)]']">{{ mt('session-selector.loading') }}</p>
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
          用户消息
        </div>
        <div class="text-2xl text-[var(--airi-accent-strong)] font-bold">
          {{ stats.user }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          助手消息
        </div>
        <div class="text-2xl text-[var(--airi-accent-text)] font-bold">
          {{ stats.assistant }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          心声札记
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
        手动清理
      </h3>

      <div :class="['mb-4 max-w-sm']">
        <label :class="['mb-2 block text-sm font-medium']">
          保留消息数：{{ keepCount }} 条
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
          只有在下方二次确认后才会删除旧消息。
        </p>
      </div>

      <div :key="`${chatSession.sessionUserId}:${viewRoleId}:${viewSessionId}`" :class="['flex flex-wrap items-start gap-2']">
        <DoubleCheckButton
          variant="caution"
          size="sm"
          :disabled="!chatSession.catalogReady || inspectionLoading || actionPending || navigationPending || conversationMessages.length <= keepCount"
          @confirm="keepRecent"
        >
          保留最近 {{ keepCount }} 条
          <template #confirm>
            确认保留最近 {{ keepCount }} 条
          </template>
          <template #cancel>
            取消
          </template>
        </DoubleCheckButton>
        <DoubleCheckButton
          variant="caution"
          size="sm"
          :disabled="!chatSession.catalogReady || inspectionLoading || actionPending || navigationPending || innerVoiceNoteCount === 0"
          @confirm="clearInnerVoiceNotes"
        >
          一键清理心声
          <template #confirm>
            确认清理全部心声
          </template>
          <template #cancel>
            取消
          </template>
        </DoubleCheckButton>
        <DoubleCheckButton
          variant="danger"
          size="sm"
          :disabled="!chatSession.catalogReady || inspectionLoading || actionPending || navigationPending || messages.length === 0"
          @confirm="clearAll"
        >
          清空所有消息
          <template #confirm>
            确认清空
          </template>
          <template #cancel>
            取消
          </template>
        </DoubleCheckButton>
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
            {{ mt('delete-conversation.confirm-description', { title: deleteTarget.title }) }}
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
        消息历史 ({{ messages.length }})
      </h3>

      <div v-if="messages.length === 0" :class="emptyStateClass">
        暂无消息
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
        <div class="mb-2 flex items-start justify-between">
          <span :class="roleTextClass">
            {{ row.message.role === 'user' ? '👤 用户' : row.message.role === 'assistant' ? '🤖 助手' : '⚙️ 系统' }}
          </span>
          <span :class="timeTextClass">
            {{ formatTime(row.message.createdAt) }}
          </span>
        </div>
        <div :class="previewTextClass">
          {{ getPreview(row.message) }}
        </div>
        <div
          v-if="row.innerVoiceGenerating && !row.innerVoiceNote?.text"
          :class="innerVoicePendingClass"
        >
          心声札记正在后台生成，还没有写入记忆页。
        </div>
        <div
          v-else-if="row.innerVoiceError && !row.innerVoiceNote?.text"
          :class="innerVoiceErrorClass"
        >
          心声札记没有写入：{{ row.innerVoiceError }}
        </div>
        <div
          v-if="row.innerVoiceNote?.text"
          :class="['mt-3', innerVoiceNoteCardClass]"
        >
          <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
            <span class="min-w-0 flex items-center gap-1.5">
              <span class="i-ph:heart-straight-duotone size-3.5 shrink-0" />
              <span>心声札记</span>
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <span :class="innerVoiceMetaTextClass">
                {{ formatTime(row.innerVoiceNote.updatedAt) }}
              </span>
              <button
                type="button"
                :disabled="actionPending || navigationPending"
                :class="innerVoiceDeleteButtonClass"
                aria-label="只删除这条心声札记"
                title="只删除这条心声札记"
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
          未关联到消息行的心声札记 ({{ unattachedInnerVoiceNotes.length }})
        </h4>
        <div
          v-for="note in unattachedInnerVoiceNotes"
          :key="note.id"
          :class="innerVoiceNoteCardClass"
        >
          <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium">
            <span class="min-w-0 flex items-center gap-1.5">
              <span class="i-ph:heart-straight-duotone size-3.5 shrink-0" />
              <span>心声札记</span>
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <span :class="innerVoiceMetaTextClass">
                {{ formatTime(note.updatedAt) }}
              </span>
              <button
                type="button"
                :disabled="actionPending || navigationPending"
                :class="innerVoiceDeleteButtonClass"
                aria-label="只删除这条心声札记"
                title="只删除这条心声札记"
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
            消息 {{ note.messageId }}
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
