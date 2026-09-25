<script setup lang="ts">
import { useAssistantInnerVoiceNoteStore } from '@proj-airi/stage-ui/stores/chat/inner-voice-notes'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useMemoryShortTermSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-short-term'
import { summarizeChatHistoryMessage } from '@proj-airi/stage-ui/utils'
import { DoubleCheckButton, FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const innerVoiceNotes = useAssistantInnerVoiceNoteStore()
const chatSession = useChatSessionStore()
const memoryShortTerm = useMemoryShortTermSettingsStore()
const airiCards = useAiriCardStore()
const { t } = useI18n()

function mt(key: string) {
  return t(`settings.pages.modules.memory-short-term.${key}`)
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
  'text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-hover)] hover:text-[var(--airi-text)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
]
const innerVoiceTagClass = 'rounded-full bg-[var(--airi-accent-surface)] px-2 py-0.5 text-[11px] text-[var(--airi-accent-text)]'

// NOTICE: 问题 12.4（短期记忆界面看不到群聊会话）。设置窗口的 activeSessionId
// 与聊天窗口当前选中的会话不同步，页面原来只读"当前活动会话"，群聊记忆永远
// 看不到。加会话选择器：默认跟随活动会话，可切换查看/清理任意 persona 或群聊
// 会话；清理操作与心声操作都作用于当前选中的会话。
const viewSessionId = ref('')
watch(() => chatSession.activeSessionId, (id) => {
  if (!viewSessionId.value && id)
    viewSessionId.value = id
}, { immediate: true })

const sessionOptions = computed(() => {
  const groupSessions = chatSession.groupSessions
  const groupSessionIds = new Set(groupSessions.map(meta => meta.sessionId))
  const personaOptions = chatSession.personaContactSessions
    .filter(summary => !groupSessionIds.has(summary.id))
    .map(summary => ({
      id: summary.id,
      label: airiCards.cards.get(summary.characterId ?? '')?.name || summary.characterId || 'memory',
      updatedAt: summary.lastMessageAt,
    }))
  const groupOptions = groupSessions.map(meta => ({
    id: meta.sessionId,
    // Prefer the user-authored room title. Older rooms may not have one, so
    // derive a stable, readable label from their persisted participants
    // instead of exposing the internal `group`/`room` kind string.
    label: (meta.title?.trim() && !['group', 'room'].includes(meta.title.trim().toLowerCase())
      ? meta.title.trim()
      : undefined)
    || meta.participants?.map(participant => String(participant.displayName ?? '').trim()).filter(Boolean).join('、')
    || '群聊',
    updatedAt: meta.updatedAt,
  }))
  return [...personaOptions, ...groupOptions]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
})

watch(sessionOptions, (options) => {
  if (options.some(option => option.id === viewSessionId.value))
    return

  // Keep the chat window's current session as the initial selection when its
  // metadata arrives after the first render (common for room sessions loaded
  // from IndexedDB). Fall back to the most recently updated session only when
  // the active session is not present anymore.
  const activeId = chatSession.activeSessionId
  viewSessionId.value = options.find(option => option.id === activeId)?.id
    ?? options[0]?.id
    ?? ''
}, { immediate: true })

const messages = computed<any[]>({
  get: () => (viewSessionId.value
    ? chatSession.getSessionMessages(viewSessionId.value) ?? []
    : []),
  set: (next) => {
    if (viewSessionId.value)
      chatSession.setSessionMessages(viewSessionId.value, next)
  },
})
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

function getAssistantMessageIdsFromMessages(sourceMessages: any[]) {
  return Array.from(new Set(sourceMessages
    .filter(message => message.role === 'assistant' && message.id)
    .map(message => String(message.id))))
}

async function deleteInnerVoiceNotesForMessages(sessionId: string, sourceMessages: any[]) {
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
    if (!chatSession.isReady)
      await chatSession.initialize()

    status.value = '加载成功'

    const savedConfig = localStorage.getItem('short-term-memory-config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      keepCount.value = Math.min(400, Math.max(10, config.keepCount ?? 20))
    }
  }
  catch (error: any) {
    errorMsg.value = error?.message || String(error)
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
  const msgs = messages.value
  return {
    total: msgs.length,
    user: msgs.filter(m => m.role === 'user').length,
    assistant: msgs.filter(m => m.role === 'assistant').length,
    system: msgs.filter(m => m.role === 'system').length,
    innerVoice: innerVoiceNoteCount.value,
  }
})

// 格式化时间
function formatTime(timestamp: number) {
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
function getPreview(message: any) {
  return summarizeChatHistoryMessage(message, {
    maxLength: 160,
    toolLimit: 4,
  })
}

// 清空所有消息（作用于当前选中的记忆会话）。
async function clearAll() {
  if (!chatSession.isReady)
    return

  try {
    const sessionId = viewSessionIdSnapshot.value
    const deletedInnerVoiceCount = sessionId
      ? (await innerVoiceNotes.deleteNotesForSession(sessionId)).length
      : 0

    await chatSession.cleanupMessages(sessionId || undefined)
    setFeedback(`消息已清空${formatInnerVoiceDeleteSuffix(deletedInnerVoiceCount)}`)
    await nextTick()
  }
  catch (error) {
    setFeedback(`清空失败: ${error}`, 'error')
  }
}

async function clearInnerVoiceNotes() {
  if (!chatSession.isReady || !viewSessionIdSnapshot.value)
    return

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
}

// 保留最近N条（作用于当前选中的记忆会话）。
async function keepRecent() {
  if (!chatSession.isReady)
    return

  const sessionId = viewSessionIdSnapshot.value
  const msgs = messages.value
  if (msgs.length <= keepCount.value) {
    setFeedback('消息数量未超过保留数量', 'neutral')
    return
  }

  const toRemove = msgs.length - keepCount.value
  try {
    const removedMessages = msgs.slice(0, toRemove)
    const deletedInnerVoiceCount = await deleteInnerVoiceNotesForMessages(sessionId, removedMessages)
    messages.value = msgs.slice(-keepCount.value)
    setFeedback(`已删除 ${toRemove} 条旧消息，保留最近 ${keepCount.value} 条消息${formatInnerVoiceDeleteSuffix(deletedInnerVoiceCount)}`)
    await nextTick()
  }
  catch (error) {
    setFeedback(`删除旧消息失败: ${error}`, 'error')
  }
}

async function deleteInnerVoiceNoteForMessage(messageId?: string, sessionId = viewSessionIdSnapshot.value) {
  if (!sessionId || !messageId)
    return

  try {
    const deletedNote = await innerVoiceNotes.deleteNoteForMessage(sessionId, String(messageId))
    setFeedback(deletedNote ? '心声札记已删除，可在聊天继续时重新生成' : '没有找到可删除的心声札记', deletedNote ? 'success' : 'neutral')
    await nextTick()
  }
  catch (error) {
    setFeedback(`删除心声札记失败: ${error}`, 'error')
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

    <!-- 会话选择器：查看/清理任意会话（含群聊）的短期记忆 -->
    <div :class="panelClass">
      <label class="mb-2 block text-sm font-medium">
        {{ mt('session-selector.label') }}
      </label>
      <select
        v-model="viewSessionId"
        class="w-full max-w-sm rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card-base)] px-3 py-2 text-sm"
      >
        <option
          v-for="option in sessionOptions"
          :key="option.id"
          :value="option.id"
        >
          {{ option.label }}
        </option>
      </select>
      <p class="mt-1 text-xs text-[var(--airi-text-muted)]">
        {{ mt('session-selector.description') }}
      </p>
    </div>

    <!-- 统计卡片 -->
    <div class="flex gap-4">
      <div :class="statCardClass">
        <div :class="statLabelClass">
          总消息数
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
      <h3 class="mb-4 text-lg font-semibold">
        手动清理
      </h3>

      <div class="mb-4 max-w-sm">
        <label class="mb-2 block text-sm font-medium">
          保留消息数：{{ keepCount }} 条
        </label>
        <input
          v-model.number="keepCount"
          type="range"
          min="10"
          max="400"
          step="5"
          class="w-full"
        >
        <p class="mt-1 text-xs text-[var(--airi-text-muted)]">
          只有在下方二次确认后才会删除旧消息。
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <DoubleCheckButton
          variant="caution"
          :disabled="!chatSession.isReady || messages.length <= keepCount"
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
          :disabled="!chatSession.isReady || innerVoiceNoteCount === 0"
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
          :disabled="!chatSession.isReady || messages.length === 0"
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
