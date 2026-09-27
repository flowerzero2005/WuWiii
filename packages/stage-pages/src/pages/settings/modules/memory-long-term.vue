<script setup lang="ts">
import type { NotebookEntry, NotebookMemoryScope } from '@proj-airi/stage-ui/stores/character/notebook'

import { useConversationNavigation } from '@proj-airi/stage-ui/composables/use-conversation-navigation'
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { useMemoryManager } from '@proj-airi/stage-ui/stores/chat/memory-manager'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const chatSession = useChatSessionStore()
const memoryManager = useMemoryManager()
const notebookStore = useCharacterNotebookStore()
const airiCards = useAiriCardStore()
const navigation = useConversationNavigation()
const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const filtersPanelClass = 'airi-surface-panel rounded-xl p-4 space-y-4'
const searchIconClass = 'absolute left-3 top-1/2 text-[var(--airi-text-soft)] -translate-y-1/2'
const searchInputClass = 'airi-input py-3 pl-10 pr-10'
const clearSearchClass = 'absolute right-3 top-1/2 cursor-pointer text-[var(--airi-text-soft)] transition-colors -translate-y-1/2 hover:text-[var(--airi-text)]'
const filterButtonClass = 'airi-control px-4 py-2 font-medium'
const selectedFilterButtonClass = 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
const tagButtonClass = 'airi-control-muted rounded-full px-3 py-1 text-sm'
const statCardClass = 'airi-card flex-1 rounded-xl p-4'
const statLabelClass = 'mb-1 text-sm text-[var(--airi-text-muted)] font-medium'
const statValueClass = 'text-3xl text-[var(--airi-accent-strong)] font-bold'
const memoryCardClass = 'airi-card airi-card-hover rounded-xl p-4 transition-all'
const dateTextClass = 'text-sm font-medium text-[var(--airi-text-muted)]'
const editTextareaClass = 'airi-input w-full resize-none p-3'
const cancelEditButtonClass = 'airi-control-muted rounded-lg px-4 py-2 text-sm'
const saveEditButtonClass = 'airi-control-primary rounded-lg px-4 py-2 text-sm shadow-sm shadow-black/5 dark:shadow-none'
const shortcutHintClass = 'text-xs text-[var(--airi-text-soft)]'
const kbdClass = 'rounded bg-[var(--airi-surface-control-muted)] px-2 py-1 font-mono'
const traceTextClass = 'mt-3 flex flex-wrap gap-2 text-xs text-[var(--airi-text-muted)]'
const sourceTraceClass = 'rounded-md bg-[var(--airi-surface-control-muted)] px-2 py-1'
const traceAccentClass = 'rounded-md bg-[var(--airi-accent-surface)] px-2 py-1 text-[var(--airi-accent-text)]'
const memoryActionButtonClass = 'rounded-lg p-2 text-[var(--airi-text-muted)] transition-all hover:bg-[var(--airi-surface-control-hover)] hover:text-[var(--airi-text)] focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]'
const sourceActionButtonClass = memoryActionButtonClass
const solidifyActionButtonClass = memoryActionButtonClass
const ignoreActionButtonClass = memoryActionButtonClass
const editActionButtonClass = memoryActionButtonClass
const deleteActionButtonClass = memoryActionButtonClass
const emptyStateClass = 'py-16 text-center text-[var(--airi-text-muted)]'

function mt(key: string, params?: Record<string, number | string>) {
  return t(`settings.pages.modules.memory-long-term.${key}`, params ?? {})
}

// 等待数据加载
const isLoading = ref(true)

// Edit state
const editingId = ref<string | null>(null)
const editingText = ref('')
const editingScope = ref<NotebookMemoryScope>()
const selectedCharacterId = ref('')
const scopedEntries = ref<NotebookEntry[]>([])
const actionPending = ref(false)
const scopeError = ref('')
const selectedScope = computed(() => notebookStore.resolveMemoryScope({ personaCardId: selectedCharacterId.value }))
const characterOptions = computed(() => Array.from(new Set([
  'default',
  ...airiCards.cards.keys(),
  ...chatSession.directSessions.map(meta => meta.characterId),
  ...chatSession.groupSessions.flatMap(meta => meta.participants?.map(participant => participant.characterId) ?? []),
])).map(id => ({ id, name: airiCards.cards.get(id)?.name || (id === 'default' ? t('base.resident.default-name') : id) })))
let loadRevision = 0

async function refreshLongTermMemory() {
  if (!selectedCharacterId.value || editingId.value)
    return
  const scope = { ...selectedScope.value }
  const revision = ++loadRevision
  isLoading.value = true
  scopeError.value = ''
  try {
    const notebook = await notebookStore.getNotebookForScope(scope, { force: true })
    if (revision === loadRevision && selectedScope.value.characterId === scope.characterId)
      scopedEntries.value = notebook.entries.filter(entry => notebookStore.entryBelongsToMemoryScope(entry, scope))
  }
  catch {
    if (revision === loadRevision)
      scopeError.value = mt('character-selector.load-failed')
  }
  finally {
    if (revision === loadRevision)
      isLoading.value = false
  }
}

watch(() => selectedScope.value.characterId, () => {
  ++loadRevision
  scopedEntries.value = []
  cancelEdit()
  void refreshLongTermMemory()
}, { flush: 'sync' })

function refreshLongTermMemoryFromFocus() {
  void refreshLongTermMemory()
}

function refreshLongTermMemoryWhenVisible() {
  if (document.visibilityState === 'visible')
    void refreshLongTermMemory()
}

onMounted(async () => {
  window.addEventListener('focus', refreshLongTermMemoryFromFocus)
  document.addEventListener('visibilitychange', refreshLongTermMemoryWhenVisible)

  try {
    await chatSession.initializeForInspection()
    const requestedCharacter = typeof route.query.characterId === 'string' ? route.query.characterId : undefined
    const requestedSession = typeof route.query.sessionId === 'string' ? route.query.sessionId : undefined
    const sessionId = requestedSession || (navigation ? await navigation.getCurrentConversation() : chatSession.activeSessionId)
    const meta = [...chatSession.directSessions, ...chatSession.groupSessions].find(meta => meta.sessionId === sessionId)
    const characterId = requestedCharacter || (meta?.kind === 'room' ? meta.primaryCharacterId || meta.participants?.[0]?.characterId : meta?.characterId)
    selectedCharacterId.value = characterOptions.value.some(option => option.id === characterId) ? characterId! : characterOptions.value[0]?.id ?? 'default'
    await refreshLongTermMemory()
  }
  catch (error) {
    scopeError.value = mt('character-selector.load-failed')
    console.error('[Long-term Memory] Failed to load:', error)
  }
  finally {
    isLoading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshLongTermMemoryFromFocus)
  document.removeEventListener('visibilitychange', refreshLongTermMemoryWhenVisible)
})

// Filter and sort options
type MemoryListFilter = 'all' | 'focus' | 'note' | 'growth-candidate'

const selectedImportance = ref<MemoryListFilter>('all')
const searchQuery = ref('')
const selectedTags = ref<string[]>([])

// Get all entries sorted by creation time (newest first)
const allEntries = computed(() => {
  let filtered = [...scopedEntries.value]

  // Filter by importance
  if (selectedImportance.value === 'focus') {
    filtered = filtered.filter(e => e.kind === 'focus')
  }
  else if (selectedImportance.value === 'note') {
    filtered = filtered.filter(e => e.kind === 'note')
  }
  else if (selectedImportance.value === 'growth-candidate') {
    filtered = filtered.filter(e => e.metadata?.memoryKind === 'persona-growth-candidate')
  }

  // Filter by search query
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(e =>
      e.text.toLowerCase().includes(query)
      || e.tags?.some(tag => tag.toLowerCase().includes(query)),
    )
  }

  // Filter by selected tags
  if (selectedTags.value.length > 0) {
    filtered = filtered.filter(e =>
      e.tags?.some(tag => selectedTags.value.includes(tag)),
    )
  }

  return filtered.sort((a, b) => b.createdAt - a.createdAt)
})

// Get all unique tags
const allTags = computed(() => {
  const tags = new Set<string>()

  scopedEntries.value.forEach((entry) => {
    entry.tags?.forEach(tag => tags.add(tag))
  })
  return Array.from(tags).sort()
})

// Statistics
const stats = computed(() => ({
  total: scopedEntries.value.length,
  focus: scopedEntries.value.filter(e => e.kind === 'focus').length,
  growthCandidate: scopedEntries.value.filter(e => e.metadata?.memoryKind === 'persona-growth-candidate').length,
  note: scopedEntries.value.filter(e => e.kind === 'note').length,
}))

function getImportanceIcon(kind: string) {
  switch (kind) {
    case 'focus':
      return '⭐'
    case 'note':
      return '📌'
    default:
      return '💡'
  }
}

function getEntryIcon(entry: NotebookEntry) {
  if (entry.metadata?.memoryKind === 'persona-growth-candidate')
    return '🧩'
  if (entry.metadata?.memoryKind === 'persona-growth-memory')
    return '🌱'
  return getImportanceIcon(entry.kind)
}

const memoryListTitle = computed(() => {
  if (selectedImportance.value === 'growth-candidate')
    return mt('list-title-growth', { count: allEntries.value.length })
  return mt('list-title', { count: allEntries.value.length })
})

function formatDate(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0)
    return mt('relative.today')
  if (diffDays === 1)
    return mt('relative.yesterday')
  if (diffDays < 7)
    return mt('relative.days-ago', { count: diffDays })
  if (diffDays < 30)
    return mt('relative.weeks-ago', { count: Math.floor(diffDays / 7) })
  return date.toLocaleDateString(locale.value)
}

function getMetadataString(entry: NotebookEntry, key: string) {
  const value = entry.metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : ''
}

function getMetadataNumber(entry: NotebookEntry, key: string) {
  const value = entry.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getMetadataStringArray(entry: NotebookEntry, key: string) {
  const value = entry.metadata?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function shortId(value: string) {
  if (value.length <= 12)
    return value

  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function getSourceSurfaceLabel(sourceSurface: string) {
  const labels: Record<string, string> = {
    'chat-area': mt('source-surface.chat-area'),
    'chat-area:auto-speech': mt('source-surface.chat-area-auto-speech'),
    'chat-area:auto-speech-stop': mt('source-surface.chat-area-auto-speech-stop'),
    'chat-orchestrator': mt('source-surface.chat-orchestrator'),
    'page': mt('source-surface.page'),
    'proactive-topic': mt('source-surface.proactive-topic'),
    'stage': mt('source-surface.stage'),
    'widget': mt('source-surface.widget'),
  }

  return labels[sourceSurface] ?? sourceSurface
}

function getSourceTraceText(entry: NotebookEntry) {
  const sourceSurface = getMetadataString(entry, 'sourceSurface')
  const sourceSessionId = getMetadataString(entry, 'sourceSessionId')
  const sourceCreatedAt = getMetadataNumber(entry, 'sourceCreatedAt')
  const sourceMessageId = getSourceMessageId(entry)
  const parts: string[] = []

  if (sourceSurface)
    parts.push(getSourceSurfaceLabel(sourceSurface))
  if (sourceSessionId)
    parts.push(mt('trace.session', { id: shortId(sourceSessionId) }))
  if (sourceMessageId)
    parts.push(mt('trace.message', { id: shortId(sourceMessageId) }))
  if (sourceCreatedAt)
    parts.push(mt('trace.source-message-date', { date: formatDate(sourceCreatedAt) }))

  return parts.length > 0 ? mt('trace.source', { trace: parts.join(' · ') }) : ''
}

function getSourceMessageId(entry: NotebookEntry) {
  return getMetadataString(entry, 'sourceAssistantMessageId')
    || getMetadataStringArray(entry, 'sourceAssistantMessageIds').at(-1)
    || getMetadataString(entry, 'sourceUserMessageId')
}

function getSourceJumpTarget(entry: NotebookEntry) {
  const sessionId = getMetadataString(entry, 'sourceSessionId')
  const messageId = getSourceMessageId(entry)

  if (!sessionId || !messageId)
    return undefined

  return {
    messageId,
    sessionId,
  }
}

function canJumpToSource(entry: NotebookEntry) {
  return Boolean(getSourceJumpTarget(entry))
}

async function openSourceMessage(entry: NotebookEntry) {
  const target = getSourceJumpTarget(entry)
  if (!target)
    return

  try {
    if (navigation) {
      if (!await navigation.openConversation(target.sessionId))
        scopeError.value = mt('character-selector.navigation-failed')
      return
    }
    await router.push({ path: '/settings/modules/memory-short-term', query: { sessionId: target.sessionId } })
  }
  catch {
    scopeError.value = mt('character-selector.navigation-failed')
  }
}

function getReferenceTraceText(entry: NotebookEntry) {
  const lastReferencedAt = getMetadataNumber(entry, 'lastReferencedAt')
  if (!lastReferencedAt)
    return ''

  const referenceSource = getMetadataString(entry, 'lastReferenceSource')
  const referenceCount = getMetadataNumber(entry, 'referenceCount') ?? 1
  const sourceLabel = referenceSource === 'context-injection'
    ? mt('reference-source.context-injection')
    : referenceSource === 'tool:search_memory'
      ? mt('reference-source.search-memory-tool')
      : referenceSource

  return [
    mt('trace.recent-reference-date', { date: formatDate(lastReferencedAt) }),
    sourceLabel,
    mt('trace.reference-count', { count: referenceCount }),
  ].filter(Boolean).join(' · ')
}

function getMemoryScopeLabel(entry: NotebookEntry) {
  const scope = getMetadataString(entry, 'memoryScope') || 'current-persona'
  const labels: Record<string, string> = {
    'current-persona': mt('scope.current-persona'),
    'global-system': mt('scope.global-system'),
    'shared-by-user': mt('scope.shared-by-user'),
  }

  return labels[scope] ?? scope
}

function getMemoryScopeClass(entry: NotebookEntry) {
  const scope = getMetadataString(entry, 'memoryScope') || 'current-persona'
  if (scope === 'shared-by-user')
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-200'
  if (scope === 'global-system')
    return 'bg-orange-50 text-orange-700 dark:bg-orange-950/45 dark:text-orange-200'
  return 'bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-muted)]'
}

function getMemoryScopeText(entry: NotebookEntry) {
  const personaCardId = getMetadataString(entry, 'personaCardId')
  const userId = getMetadataString(entry, 'userId')
  const parts = [mt('trace.scope-prefix', { scope: getMemoryScopeLabel(entry) })]

  if (personaCardId)
    parts.push(mt('trace.persona', { id: shortId(personaCardId) }))
  if (userId)
    parts.push(mt('trace.user', { id: shortId(userId) }))

  return parts.join(' · ')
}

function isPersonaGrowthCandidate(entry: NotebookEntry) {
  return entry.metadata?.memoryKind === 'persona-growth-candidate'
}

function isActivePersonaGrowthCandidate(entry: NotebookEntry) {
  return isPersonaGrowthCandidate(entry) && entry.metadata?.personaGrowthStatus !== 'disabled'
}

function getPersonaGrowthTraceText(entry: NotebookEntry) {
  const memoryKind = getMetadataString(entry, 'memoryKind')
  if (memoryKind !== 'persona-growth-candidate' && memoryKind !== 'persona-growth-memory')
    return ''

  const status = getMetadataString(entry, 'personaGrowthStatus')
  const kind = getMetadataString(entry, 'personaGrowthKind')
  const source = getMetadataString(entry, 'personaGrowthSource')
  const confidence = getMetadataNumber(entry, 'personaGrowthConfidence')
  const statusLabel = status === 'solidified'
    ? mt('growth-status.solidified')
    : status === 'disabled'
      ? mt('growth-status.disabled')
      : mt('growth-status.candidate')
  const sourceLabel = source === 'reply-feedback-summary' ? mt('growth-source.reply-feedback-summary') : source

  return [
    mt('trace.growth-prefix', { status: statusLabel }),
    kind,
    confidence !== undefined ? mt('trace.confidence', { value: confidence.toFixed(2) }) : '',
    sourceLabel ? mt('trace.source-label', { source: sourceLabel }) : '',
  ].filter(Boolean).join(' · ')
}

async function runScopedAction(scope: NotebookMemoryScope, action: () => Promise<unknown>) {
  if (actionPending.value || scope.userId !== selectedScope.value.userId)
    return false
  actionPending.value = true
  scopeError.value = ''
  try {
    await action()
    if (scope.characterId === selectedScope.value.characterId) {
      cancelEdit()
      await refreshLongTermMemory()
    }
    return true
  }
  catch {
    scopeError.value = mt('character-selector.save-failed')
    return false
  }
  finally {
    actionPending.value = false
  }
}

async function deleteEntry(id: string) {
  const scope = { ...selectedScope.value }
  // NOTICE: This page already used native confirm for destructive deletion; replacing the dialog UX is outside this cleanup.
  // eslint-disable-next-line no-alert
  if (confirm(mt('confirm.delete'))) {
    await runScopedAction(scope, () => notebookStore.updateNotebookForScope(scope, (data) => {
      data.entries = data.entries.filter(entry => entry.id !== id)
    }))
  }
}

async function solidifyPersonaGrowthCandidate(id: string) {
  const scope = { ...selectedScope.value }
  // eslint-disable-next-line no-alert
  if (!confirm(mt('confirm.solidify-growth')))
    return

  await runScopedAction(scope, () => memoryManager.solidifyPersonaGrowthCandidate(id, scope))
}

async function disablePersonaGrowthCandidate(id: string) {
  const scope = { ...selectedScope.value }
  // eslint-disable-next-line no-alert
  if (!confirm(mt('confirm.ignore-growth')))
    return

  await runScopedAction(scope, () => memoryManager.disablePersonaGrowthCandidate(id, scope))
}

function startEdit(entry: NotebookEntry) {
  if (actionPending.value || isLoading.value)
    return
  editingId.value = entry.id
  editingText.value = entry.text
  editingScope.value = { ...selectedScope.value }
}

function cancelEdit() {
  editingId.value = null
  editingText.value = ''
  editingScope.value = undefined
}

async function saveEdit() {
  if (!editingId.value || !editingText.value.trim() || !editingScope.value)
    return

  const scope = { ...editingScope.value }
  const id = editingId.value
  const text = editingText.value.trim()
  await runScopedAction(scope, () => notebookStore.updateMemoryEntryInScope(id, scope, (entry) => {
    entry.text = text
  }))
}
</script>

<template>
  <div class="p-6 space-y-6">
    <section :class="filtersPanelClass">
      <label :class="['flex max-w-sm flex-col gap-2 text-sm font-medium']">
        {{ mt('character-selector.label') }}
        <select v-model="selectedCharacterId" :disabled="isLoading || actionPending || Boolean(editingId)" :class="['min-w-0 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card-base)] px-3 py-2 disabled:opacity-50']">
          <option v-for="character in characterOptions" :key="character.id" :value="character.id">{{ character.name }}</option>
        </select>
      </label>
      <p :class="['text-xs text-[var(--airi-text-muted)] leading-5']">{{ mt('character-selector.description') }}</p>
      <p v-if="editingId" :class="['text-xs text-[var(--airi-text-muted)]']">{{ mt('character-selector.finish-edit') }}</p>
      <p v-if="scopeError" role="alert" :class="['airi-status-danger rounded-md p-3 text-sm']">{{ scopeError }}</p>
    </section>
    <!-- Statistics -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.total') }}
        </div>
        <div :class="statValueClass">
          {{ stats.total }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.focus') }}
        </div>
        <div :class="statValueClass">
          {{ stats.focus }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.note') }}
        </div>
        <div :class="statValueClass">
          {{ stats.note }}
        </div>
      </div>
      <div :class="statCardClass">
        <div :class="statLabelClass">
          {{ mt('stats.growth-candidate') }}
        </div>
        <div :class="statValueClass">
          {{ stats.growthCandidate }}
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div :class="filtersPanelClass">
      <!-- Search -->
      <div class="relative">
        <div :class="searchIconClass">
          <div class="i-solar:magnifer-linear text-lg" />
        </div>
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="mt('filters.search-placeholder')"
          :class="searchInputClass"
        >
        <div
          v-if="searchQuery"
          :class="clearSearchClass"
          @click="searchQuery = ''"
        >
          <div class="i-solar:close-circle-bold text-lg" />
        </div>
      </div>

      <!-- Importance filter -->
      <div class="flex gap-2">
        <button
          :class="[filterButtonClass, { [selectedFilterButtonClass]: selectedImportance === 'all' }]"
          @click="selectedImportance = 'all'"
        >
          {{ mt('filters.all') }}
        </button>
        <button
          :class="[filterButtonClass, { [selectedFilterButtonClass]: selectedImportance === 'focus' }]"
          @click="selectedImportance = 'focus'"
        >
          {{ mt('filters.focus') }}
        </button>
        <button
          :class="[filterButtonClass, { [selectedFilterButtonClass]: selectedImportance === 'note' }]"
          @click="selectedImportance = 'note'"
        >
          {{ mt('filters.note') }}
        </button>
        <button
          :class="[filterButtonClass, { [selectedFilterButtonClass]: selectedImportance === 'growth-candidate' }]"
          @click="selectedImportance = 'growth-candidate'"
        >
          {{ mt('filters.growth-candidate') }}
        </button>
      </div>

      <!-- Tags -->
      <div v-if="allTags.length > 0" class="flex flex-wrap gap-2">
        <button
          v-for="tag in allTags"
          :key="tag"
          :class="[tagButtonClass, { [selectedFilterButtonClass]: selectedTags.includes(tag) }]"
          @click="() => {
            const index = selectedTags.indexOf(tag)
            if (index !== -1) {
              selectedTags.splice(index, 1)
            }
            else {
              selectedTags.push(tag)
            }
          }"
        >
          #{{ tag }}
        </button>
      </div>
    </div>

    <!-- Memory list -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">
          {{ memoryListTitle }}
        </h3>
      </div>

      <div
        v-for="entry in allEntries"
        :key="entry.id"
        :class="memoryCardClass"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="mb-2 flex items-center gap-2">
              <span class="text-2xl">{{ getEntryIcon(entry) }}</span>
              <span :class="dateTextClass">
                {{ formatDate(entry.createdAt) }}
              </span>
            </div>

            <!-- Edit mode -->
            <div v-if="editingId === entry.id" class="mb-2 space-y-2">
              <textarea
                v-model="editingText"
                :readonly="actionPending"
                :class="editTextareaClass"
                rows="3"
                @keydown.esc="!actionPending && cancelEdit()"
                @keydown.ctrl.enter="saveEdit"
              />
              <div class="flex items-center justify-between gap-2">
                <div class="flex gap-2">
                  <button
                    :class="saveEditButtonClass"
                    :disabled="actionPending"
                    @click="saveEdit"
                  >
                    {{ mt('actions.save') }}
                  </button>
                  <button
                    :class="cancelEditButtonClass"
                    :disabled="actionPending"
                    @click="cancelEdit"
                  >
                    {{ mt('actions.cancel') }}
                  </button>
                </div>
                <div :class="shortcutHintClass">
                  <kbd :class="kbdClass">Ctrl+Enter</kbd> {{ mt('actions.save') }}
                  <kbd :class="['ml-2', kbdClass]">Esc</kbd> {{ mt('actions.cancel') }}
                </div>
              </div>
            </div>

            <!-- View mode -->
            <div v-else>
              <div class="mb-3 break-words text-base leading-relaxed">
                {{ entry.text }}
              </div>
              <div v-if="entry.tags && entry.tags.length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="tag in entry.tags"
                  :key="tag"
                  class="rounded-full bg-[var(--airi-accent-surface)] px-3 py-1 text-xs text-[var(--airi-accent-text)] font-medium"
                >
                  #{{ tag }}
                </span>
              </div>
              <div
                v-if="getMemoryScopeText(entry) || getSourceTraceText(entry) || getReferenceTraceText(entry) || getPersonaGrowthTraceText(entry)"
                :class="traceTextClass"
              >
                <span
                  class="rounded-md px-2 py-1"
                  :class="getMemoryScopeClass(entry)"
                >
                  {{ getMemoryScopeText(entry) }}
                </span>
                <span
                  v-if="getPersonaGrowthTraceText(entry)"
                  :class="traceAccentClass"
                >
                  {{ getPersonaGrowthTraceText(entry) }}
                </span>
                <span
                  v-if="getSourceTraceText(entry)"
                  :class="sourceTraceClass"
                >
                  {{ getSourceTraceText(entry) }}
                </span>
                <span
                  v-if="getReferenceTraceText(entry)"
                  :class="traceAccentClass"
                >
                  {{ getReferenceTraceText(entry) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div v-if="editingId !== entry.id" class="flex flex-shrink-0 gap-1">
            <button
              v-if="canJumpToSource(entry)"
              :disabled="actionPending || isLoading || Boolean(editingId)"
              :class="sourceActionButtonClass"
              :title="mt('actions.open-source')"
              @click="openSourceMessage(entry)"
            >
              <div class="i-solar:map-arrow-right-bold-duotone text-xl" />
            </button>
            <button
              v-if="isActivePersonaGrowthCandidate(entry)"
              :class="solidifyActionButtonClass"
              :disabled="actionPending || isLoading || Boolean(editingId)"
              :title="mt('actions.solidify-growth')"
              @click="solidifyPersonaGrowthCandidate(entry.id)"
            >
              <div class="i-solar:check-circle-bold-duotone text-xl" />
            </button>
            <button
              v-if="isActivePersonaGrowthCandidate(entry)"
              :class="ignoreActionButtonClass"
              :disabled="actionPending || isLoading || Boolean(editingId)"
              :title="mt('actions.ignore-growth')"
              @click="disablePersonaGrowthCandidate(entry.id)"
            >
              <div class="i-solar:minus-circle-bold-duotone text-xl" />
            </button>
            <button
              :class="editActionButtonClass"
              :disabled="actionPending || isLoading || Boolean(editingId)"
              :title="mt('actions.edit')"
              @click="startEdit(entry)"
            >
              <div class="i-solar:pen-bold-duotone text-xl" />
            </button>
            <button
              :class="deleteActionButtonClass"
              :disabled="actionPending || isLoading || Boolean(editingId)"
              :title="mt('actions.delete')"
              @click="deleteEntry(entry.id)"
            >
              <div class="i-solar:trash-bin-2-bold-duotone text-xl" />
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="allEntries.length === 0"
        :class="emptyStateClass"
      >
        <div v-if="isLoading" class="flex flex-col items-center gap-4">
          <div class="i-svg-spinners:ring-resize text-5xl text-[var(--airi-accent-strong)]" />
          <div class="text-lg">
            {{ mt('empty.loading') }}
          </div>
        </div>
        <div v-else class="flex flex-col items-center gap-4">
          <div class="text-6xl">
            📝
          </div>
          <div class="text-lg">
            {{ mt('empty.no-memory') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
