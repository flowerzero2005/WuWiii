<script setup lang="ts">
import type {
  AiriReplyFeedbackMemoryState,
  AiriReplyFeedbackMemorySummary,
  AiriReplyFeedbackRating,
  AiriReplyFeedbackRecord,
  AiriReplyFeedbackScope,
  AiriReplyFeedbackSourceSurface,
} from '@proj-airi/stage-ui/types/reply-feedback'

import { useReplyFeedbackStore } from '@proj-airi/stage-ui/stores/chat/reply-feedback'
import { useReplyFeedbackReflectionStore } from '@proj-airi/stage-ui/stores/chat/reply-feedback-reflection'
import { useMemoryAdvancedSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-advanced'
import { BasicTextarea, Button, DoubleCheckButton, FieldCheckbox, Input, SelectTab } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type RatingFilter = 'all' | AiriReplyFeedbackRating
type StatusFilter = 'all' | 'active' | 'disabled'
type TimeWindowFilter = 'all' | '7d' | '30d' | '90d'
type SurfaceFilter = 'all' | AiriReplyFeedbackSourceSurface

const { t, locale } = useI18n()

const feedbackStore = useReplyFeedbackStore()
const replyFeedbackReflection = useReplyFeedbackReflectionStore()
const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()

const records = ref<AiriReplyFeedbackRecord[]>([])
const resolvedScope = ref<AiriReplyFeedbackScope>({
  userId: 'local',
  personaCardId: 'default',
})
const learningState = ref<AiriReplyFeedbackMemoryState>({
  userId: 'local',
  personaCardId: 'default',
  summary: null,
  status: 'empty',
  pending: false,
  stale: false,
})
const isLoading = ref(false)
const loadError = ref('')

const ratingFilter = ref<RatingFilter>('all')
const statusFilter = ref<StatusFilter>('all')
const timeWindowFilter = ref<TimeWindowFilter>('all')
const surfaceFilter = ref<SurfaceFilter>('all')
const searchQuery = ref('')

const editingFeedbackId = ref<string>()
const noteDraftById = ref<Record<string, string>>({})
const pendingById = ref<Record<string, boolean>>({})
const actionErrorById = ref<Record<string, string>>({})

const settingsPanelClass = ['airi-surface-panel', 'rounded-xl p-4']
const settingsCardClass = ['airi-card', 'p-3']
const settingsLabelClass = ['airi-text-muted', 'text-xs font-medium']
const settingsHeadingClass = ['airi-text', 'text-lg font-medium']
const settingsMutedClass = ['airi-text-muted', 'text-sm']
const settingsBodyClass = ['airi-text', 'text-sm leading-5']

let latestLoadRequestId = 0
let latestLearningRequestId = 0

const learningEnabled = computed({
  get: () => memoryAdvancedSettings.settings.enableReplyFeedbackLearning,
  set: (value) => {
    memoryAdvancedSettings.settings.enableReplyFeedbackLearning = value
  },
})

const learningStatusLabel = computed(() => {
  return learningEnabled.value
    ? t('settings.pages.reply-feedback.learning.enabled')
    : t('settings.pages.reply-feedback.learning.disabled')
})

const learningSummary = computed<AiriReplyFeedbackMemorySummary | null>(() => learningState.value.summary)

const learningStateLabel = computed(() => {
  return t(`settings.pages.reply-feedback.learning.state.${learningState.value.status}`)
})

const learningStateBadgeClass = computed(() => {
  switch (learningState.value.status) {
    case 'ready':
      return ['airi-status-success']
    case 'refreshing':
      return ['airi-status-info']
    case 'stale':
      return ['airi-status-warning']
    default:
      return ['airi-status-neutral']
  }
})

const learningStateMetaLabel = computed(() => {
  if (learningState.value.pendingUpdatedAt) {
    return t('settings.pages.reply-feedback.learning.pending-since', {
      date: formatDateTime(learningState.value.pendingUpdatedAt),
    })
  }

  if (learningSummary.value?.generatedAt) {
    return t('settings.pages.reply-feedback.learning.last-generated', {
      date: formatDateTime(learningSummary.value.generatedAt),
    })
  }

  return ''
})

const learningSummaryGroups = computed(() => {
  const summary = learningSummary.value
  if (!summary)
    return []

  return [
    {
      key: 'preferred-styles',
      title: t('settings.pages.reply-feedback.learning.preferred-styles'),
      items: summary.preferredStyles || [],
    },
    {
      key: 'avoid-patterns',
      title: t('settings.pages.reply-feedback.learning.avoid-patterns'),
      items: summary.avoidPatterns || [],
    },
    {
      key: 'answering-biases',
      title: t('settings.pages.reply-feedback.learning.answering-biases'),
      items: summary.answeringBiases || [],
    },
    {
      key: 'emotional-cues',
      title: t('settings.pages.reply-feedback.learning.emotional-cues'),
      items: summary.emotionalCues || [],
    },
  ].filter(group => group.items.length)
})

const reflectionScopeKey = computed(() => buildScopeKey(resolvedScope.value))

const reflectionProcessing = computed(() => {
  return replyFeedbackReflection.processingScopeKeys.includes(reflectionScopeKey.value)
})

const ratingOptions = computed(() => [
  { label: t('settings.pages.reply-feedback.filters.options.all'), value: 'all' },
  { label: t('settings.pages.reply-feedback.filters.options.up'), value: 'up' },
  { label: t('settings.pages.reply-feedback.filters.options.down'), value: 'down' },
])

const statusOptions = computed(() => [
  { label: t('settings.pages.reply-feedback.filters.options.all'), value: 'all' },
  { label: t('settings.pages.reply-feedback.filters.options.active'), value: 'active' },
  { label: t('settings.pages.reply-feedback.filters.options.disabled'), value: 'disabled' },
])

const timeWindowOptions = computed(() => [
  { label: t('settings.pages.reply-feedback.filters.options.all'), value: 'all' },
  { label: t('settings.pages.reply-feedback.filters.options.days-7'), value: '7d' },
  { label: t('settings.pages.reply-feedback.filters.options.days-30'), value: '30d' },
  { label: t('settings.pages.reply-feedback.filters.options.days-90'), value: '90d' },
])

const surfaceOptions = computed(() => [
  { label: t('settings.pages.reply-feedback.filters.options.all'), value: 'all' },
  { label: t('settings.pages.reply-feedback.filters.options.main-chat'), value: 'main-chat' },
  { label: t('settings.pages.reply-feedback.filters.options.quick-chat-expanded'), value: 'quick-chat-expanded' },
  { label: t('settings.pages.reply-feedback.filters.options.quick-chat-collapsed-bubble'), value: 'quick-chat-collapsed-bubble' },
])

const stats = computed(() => {
  const total = records.value.length
  const disabled = records.value.filter(record => Boolean(record.disabledAt)).length
  const liked = records.value.filter(record => record.rating === 'up').length
  const disliked = records.value.filter(record => record.rating === 'down').length

  return {
    total,
    active: total - disabled,
    disabled,
    liked,
    disliked,
  }
})

const filteredRecords = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const now = Date.now()
  const timeWindowDays = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  } as const

  return records.value.filter((record) => {
    if (ratingFilter.value !== 'all' && record.rating !== ratingFilter.value)
      return false

    if (statusFilter.value === 'active' && record.disabledAt)
      return false

    if (statusFilter.value === 'disabled' && !record.disabledAt)
      return false

    if (surfaceFilter.value !== 'all' && record.sourceSurface !== surfaceFilter.value)
      return false

    if (timeWindowFilter.value !== 'all') {
      const windowDays = timeWindowDays[timeWindowFilter.value]
      const cutoff = now - (windowDays * 24 * 60 * 60 * 1000)
      if (record.updatedAt < cutoff)
        return false
    }

    if (!query)
      return true

    const haystack = [
      record.userMessagePreview,
      record.assistantReplyPreview,
      record.userNote || '',
    ].join('\n').toLowerCase()

    return haystack.includes(query)
  })
})

const resultSummary = computed(() => {
  return t('settings.pages.reply-feedback.results.summary', {
    visible: filteredRecords.value.length,
    total: records.value.length,
  })
})

const dateFormatter = computed(() => {
  return new Intl.DateTimeFormat(locale.value || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
})

function formatDateTime(value?: number) {
  if (!value)
    return ''

  return dateFormatter.value.format(value)
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`
}

function surfaceLabel(surface: AiriReplyFeedbackSourceSurface) {
  return t(`settings.pages.reply-feedback.filters.options.${surface}`)
}

function buildScopeKey(scope: AiriReplyFeedbackScope) {
  return `${scope.userId}::${scope.personaCardId}`
}

function createEmptyLearningState(scope: AiriReplyFeedbackScope): AiriReplyFeedbackMemoryState {
  return {
    ...scope,
    summary: null,
    status: 'empty',
    pending: false,
    stale: false,
  }
}

function normalizeNote(value?: string) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function getNoteDraft(record: AiriReplyFeedbackRecord) {
  return noteDraftById.value[record.id] ?? record.userNote ?? ''
}

function hasNoteChanges(record: AiriReplyFeedbackRecord) {
  return normalizeNote(getNoteDraft(record)) !== normalizeNote(record.userNote)
}

function isPending(feedbackId: string) {
  return Boolean(pendingById.value[feedbackId])
}

function setPending(feedbackId: string, pending: boolean) {
  if (pending) {
    pendingById.value = {
      ...pendingById.value,
      [feedbackId]: true,
    }
    return
  }

  const next = { ...pendingById.value }
  delete next[feedbackId]
  pendingById.value = next
}

function setActionError(feedbackId: string, message?: string) {
  const next = { ...actionErrorById.value }
  if (message)
    next[feedbackId] = message
  else
    delete next[feedbackId]
  actionErrorById.value = next
}

function replaceLocalRecord(nextRecord: AiriReplyFeedbackRecord) {
  records.value = records.value.map(record => record.id === nextRecord.id ? nextRecord : record)
}

function removeLocalRecord(feedbackId: string) {
  records.value = records.value.filter(record => record.id !== feedbackId)
}

function cleanupTransientState(nextRecords: AiriReplyFeedbackRecord[]) {
  const recordIds = new Set(nextRecords.map(record => record.id))

  noteDraftById.value = Object.fromEntries(
    Object.entries(noteDraftById.value).filter(([feedbackId]) => recordIds.has(feedbackId)),
  )
  pendingById.value = Object.fromEntries(
    Object.entries(pendingById.value).filter(([feedbackId]) => recordIds.has(feedbackId)),
  )
  actionErrorById.value = Object.fromEntries(
    Object.entries(actionErrorById.value).filter(([feedbackId]) => recordIds.has(feedbackId)),
  )

  if (editingFeedbackId.value && !recordIds.has(editingFeedbackId.value))
    editingFeedbackId.value = undefined
}

function startEditing(record: AiriReplyFeedbackRecord) {
  editingFeedbackId.value = record.id
  noteDraftById.value = {
    ...noteDraftById.value,
    [record.id]: record.userNote ?? '',
  }
  setActionError(record.id)
}

function cancelEditing(record: AiriReplyFeedbackRecord) {
  editingFeedbackId.value = editingFeedbackId.value === record.id ? undefined : editingFeedbackId.value
  noteDraftById.value = {
    ...noteDraftById.value,
    [record.id]: record.userNote ?? '',
  }
  setActionError(record.id)
}

async function loadRecords() {
  const requestId = ++latestLoadRequestId
  isLoading.value = true
  loadError.value = ''
  let nextScope = resolvedScope.value

  try {
    nextScope = await feedbackStore.resolveCurrentScope()
    const [nextRecords, nextLearningState] = await Promise.all([
      feedbackStore.listFeedbackRecords(),
      replyFeedbackReflection.loadPersistedSummaryState(nextScope, {
        warmIfMissing: true,
        waitForPending: false,
      }).catch((error) => {
        console.warn('[ReplyFeedback] Failed to load learning summary:', error)
        return createEmptyLearningState(nextScope)
      }),
    ])
    if (requestId !== latestLoadRequestId)
      return

    resolvedScope.value = nextScope
    learningState.value = nextLearningState
    records.value = [...nextRecords].sort((left, right) => right.updatedAt - left.updatedAt)
    cleanupTransientState(records.value)
  }
  catch (error) {
    if (requestId !== latestLoadRequestId)
      return

    learningState.value = createEmptyLearningState(nextScope)
    loadError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    if (requestId === latestLoadRequestId)
      isLoading.value = false
  }
}

async function refreshLearningState(scope: AiriReplyFeedbackScope, options?: { waitForPending?: boolean }) {
  const requestId = ++latestLearningRequestId

  try {
    const nextLearningState = await replyFeedbackReflection.loadPersistedSummaryState(scope, {
      warmIfMissing: true,
      waitForPending: options?.waitForPending ?? false,
    })
    if (requestId !== latestLearningRequestId)
      return

    learningState.value = nextLearningState
  }
  catch (error) {
    if (requestId !== latestLearningRequestId)
      return

    console.warn('[ReplyFeedback] Failed to refresh learning state:', error)
    learningState.value = createEmptyLearningState(scope)
  }
}

async function saveNote(record: AiriReplyFeedbackRecord) {
  const feedbackId = record.id
  setPending(feedbackId, true)
  setActionError(feedbackId)

  try {
    const nextRecord = await feedbackStore.updateFeedbackRecord(feedbackId, {
      userNote: normalizeNote(getNoteDraft(record)),
    })
    if (!nextRecord)
      return

    replaceLocalRecord(nextRecord)
    noteDraftById.value = {
      ...noteDraftById.value,
      [feedbackId]: nextRecord.userNote ?? '',
    }
    editingFeedbackId.value = editingFeedbackId.value === feedbackId ? undefined : editingFeedbackId.value
  }
  catch (error) {
    setActionError(feedbackId, error instanceof Error ? error.message : String(error))
  }
  finally {
    setPending(feedbackId, false)
  }
}

async function toggleRecordDisabled(record: AiriReplyFeedbackRecord) {
  const feedbackId = record.id
  setPending(feedbackId, true)
  setActionError(feedbackId)

  try {
    const nextRecord = await feedbackStore.updateFeedbackRecord(feedbackId, {
      disabledAt: record.disabledAt ? undefined : Date.now(),
    })
    if (!nextRecord)
      return

    replaceLocalRecord(nextRecord)
  }
  catch (error) {
    setActionError(feedbackId, error instanceof Error ? error.message : String(error))
  }
  finally {
    setPending(feedbackId, false)
  }
}

async function deleteRecord(record: AiriReplyFeedbackRecord) {
  const feedbackId = record.id
  setPending(feedbackId, true)
  setActionError(feedbackId)

  try {
    const deletedRecord = await feedbackStore.deleteFeedbackRecord(feedbackId)
    if (!deletedRecord)
      return

    removeLocalRecord(feedbackId)
    cleanupTransientState(records.value)
  }
  catch (error) {
    setActionError(feedbackId, error instanceof Error ? error.message : String(error))
  }
  finally {
    setPending(feedbackId, false)
  }
}

watch(
  [
    () => feedbackStore.currentScope.userId,
    () => feedbackStore.currentScope.personaCardId,
    () => feedbackStore.recordsVersion,
  ],
  () => {
    void loadRecords()
  },
  { immediate: true },
)

watch(
  () => reflectionProcessing.value,
  (isProcessing, wasProcessing) => {
    if (isProcessing === wasProcessing)
      return

    void refreshLearningState(resolvedScope.value, {
      waitForPending: false,
    })
  },
)
</script>

<template>
  <div :class="['flex', 'flex-col', 'gap-4', 'pb-4']">
    <div :class="['grid', 'gap-4', 'lg:grid-cols-[minmax(0,1fr)_20rem]']">
      <section :class="[settingsPanelClass, 'flex flex-col gap-4']">
        <div :class="['flex', 'items-center', 'gap-2']">
          <div :class="['size-5', 'shrink-0', 'text-primary-500', 'i-solar:chat-round-like-bold-duotone']" />
          <div :class="settingsHeadingClass">
            {{ t('settings.pages.reply-feedback.scope.title') }}
          </div>
        </div>

        <div :class="['grid', 'gap-3', 'sm:grid-cols-2']">
          <div :class="['flex', 'flex-col', 'gap-1']">
            <div :class="settingsLabelClass">
              {{ t('settings.pages.reply-feedback.scope.user') }}
            </div>
            <div :class="['airi-input-muted', 'px-3 py-2 font-mono']">
              {{ resolvedScope.userId }}
            </div>
          </div>

          <div :class="['flex', 'flex-col', 'gap-1']">
            <div :class="settingsLabelClass">
              {{ t('settings.pages.reply-feedback.scope.persona') }}
            </div>
            <div :class="['airi-input-muted', 'px-3 py-2 font-mono']">
              {{ resolvedScope.personaCardId }}
            </div>
          </div>
        </div>
      </section>

      <section :class="[settingsPanelClass, 'grid grid-cols-2 gap-2']">
        <div :class="[settingsCardClass, 'flex flex-col gap-1']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.stats.total') }}
          </div>
          <div :class="['airi-text', 'text-2xl font-semibold']">
            {{ stats.total }}
          </div>
        </div>

        <div :class="[settingsCardClass, 'flex flex-col gap-1']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.stats.active') }}
          </div>
          <div :class="['airi-text', 'text-2xl font-semibold']">
            {{ stats.active }}
          </div>
        </div>

        <div :class="[settingsCardClass, 'flex flex-col gap-1']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.stats.disabled') }}
          </div>
          <div :class="['airi-text', 'text-2xl font-semibold']">
            {{ stats.disabled }}
          </div>
        </div>

        <div :class="[settingsCardClass, 'flex flex-col gap-1']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.stats.liked') }}
          </div>
          <div :class="['text-2xl', 'font-semibold', 'text-emerald-700', 'dark:text-emerald-300']">
            {{ stats.liked }}
          </div>
        </div>

        <div :class="[settingsCardClass, 'col-span-2 flex flex-col gap-1']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.stats.disliked') }}
          </div>
          <div :class="['text-2xl', 'font-semibold', 'text-rose-700', 'dark:text-rose-300']">
            {{ stats.disliked }}
          </div>
        </div>
      </section>
    </div>

    <section :class="[settingsPanelClass, 'flex flex-col gap-4']">
      <div :class="['flex', 'flex-col', 'gap-4', 'xl:flex-row', 'xl:items-start', 'xl:justify-between']">
        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="['flex', 'items-center', 'gap-2']">
            <div :class="['size-5', 'shrink-0', 'text-primary-500', 'i-solar:chat-round-like-bold-duotone']" />
            <div :class="settingsHeadingClass">
              {{ t('settings.pages.reply-feedback.learning.title') }}
            </div>
          </div>

          <p :class="settingsMutedClass">
            {{ t('settings.pages.reply-feedback.learning.description') }}
          </p>
        </div>

        <div :class="[settingsCardClass, 'w-full max-w-sm']">
          <FieldCheckbox
            v-model="learningEnabled"
            :label="t('settings.pages.reply-feedback.learning.toggle')"
            :description="learningStatusLabel"
          />
        </div>
      </div>

      <p :class="settingsMutedClass">
        {{ t('settings.pages.reply-feedback.learning.priority-note') }}
      </p>

      <div :class="['flex', 'flex-wrap', 'items-center', 'gap-2']">
        <span
          :class="[
            'inline-flex', 'items-center', 'rounded-md', 'px-2.5', 'py-1', 'text-xs', 'font-medium',
            learningStateBadgeClass,
          ]"
        >
          {{ learningStateLabel }}
        </span>

        <span
          v-if="learningStateMetaLabel"
          :class="['airi-text-muted', 'text-xs']"
        >
          {{ learningStateMetaLabel }}
        </span>
      </div>

      <div
        v-if="learningSummary"
        :class="['grid', 'gap-4', 'lg:grid-cols-[minmax(0,1fr)_16rem]']"
      >
        <div :class="['flex', 'flex-col', 'gap-3']">
          <div
            v-if="learningSummaryGroups.length"
            :class="['grid', 'gap-3', 'md:grid-cols-2']"
          >
            <div
              v-for="group in learningSummaryGroups"
              :key="group.key"
              :class="[settingsCardClass, 'flex flex-col gap-2']"
            >
              <div :class="settingsLabelClass">
                {{ group.title }}
              </div>

              <ul :class="['flex', 'flex-col', 'gap-2']">
                <li
                  v-for="item in group.items"
                  :key="item"
                  :class="settingsBodyClass"
                >
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>

          <div :class="[settingsCardClass, 'flex flex-col gap-2']">
            <div :class="settingsLabelClass">
              {{ t('settings.pages.reply-feedback.learning.principles') }}
            </div>

            <ul :class="['flex', 'flex-col', 'gap-2']">
              <li
                v-for="principle in learningSummary.principles"
                :key="principle"
                :class="settingsBodyClass"
              >
                {{ principle }}
              </li>
            </ul>
          </div>
        </div>

        <div :class="['grid', 'gap-2', 'sm:grid-cols-2', 'lg:grid-cols-1']">
          <div :class="[settingsCardClass, 'flex flex-col gap-1']">
            <div :class="settingsLabelClass">
              {{ t('settings.pages.reply-feedback.learning.samples') }}
            </div>
            <div :class="['airi-text', 'text-2xl font-semibold']">
              {{ learningSummary.recordCount }}
            </div>
          </div>

          <div :class="[settingsCardClass, 'flex flex-col gap-1']">
            <div :class="settingsLabelClass">
              {{ t('settings.pages.reply-feedback.learning.confidence') }}
            </div>
            <div :class="['airi-text', 'text-2xl font-semibold']">
              {{ formatConfidence(learningSummary.confidence) }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-else
        :class="['airi-status-neutral', 'rounded-lg border-dashed px-4 py-3 text-sm']"
      >
        {{ t('settings.pages.reply-feedback.learning.empty') }}
      </div>
    </section>

    <section :class="[settingsPanelClass, 'flex flex-col gap-4']">
      <div :class="['flex', 'items-center', 'gap-2']">
        <div :class="['size-5', 'shrink-0', 'airi-text-muted', 'i-solar:filter-bold-duotone']" />
        <div :class="settingsHeadingClass">
          {{ t('settings.pages.reply-feedback.filters.title') }}
        </div>
      </div>

      <Input
        v-model="searchQuery"
        variant="primary-dimmed"
        :placeholder="t('settings.pages.reply-feedback.filters.search-placeholder')"
      />

      <div :class="['grid', 'gap-4', 'xl:grid-cols-2']">
        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.filters.rating') }}
          </div>
          <SelectTab v-model="ratingFilter" size="sm" :options="ratingOptions" />
        </div>

        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.filters.status') }}
          </div>
          <SelectTab v-model="statusFilter" size="sm" :options="statusOptions" />
        </div>

        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.filters.window') }}
          </div>
          <SelectTab v-model="timeWindowFilter" size="sm" :options="timeWindowOptions" />
        </div>

        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.filters.surface') }}
          </div>
          <SelectTab v-model="surfaceFilter" size="sm" :options="surfaceOptions" />
        </div>
      </div>
    </section>

    <div :class="['flex', 'items-center', 'justify-between', 'gap-3', 'flex-wrap']">
      <div :class="['flex', 'flex-col', 'gap-1']">
        <div :class="settingsHeadingClass">
          {{ t('settings.pages.reply-feedback.results.title') }}
        </div>
        <div :class="settingsMutedClass">
          {{ resultSummary }}
        </div>
      </div>

      <div
        v-if="isLoading"
        :class="settingsMutedClass"
      >
        {{ t('settings.pages.reply-feedback.results.loading') }}
      </div>
    </div>

    <div
      v-if="loadError"
      :class="['airi-status-danger', 'rounded-xl px-4 py-3 text-sm']"
    >
      {{ loadError }}
    </div>

    <div
      v-if="!filteredRecords.length"
      :class="['airi-status-neutral', 'rounded-xl border-dashed px-4 py-8 text-center']"
    >
      <div :class="['airi-text', 'text-base font-medium']">
        {{ t('settings.pages.reply-feedback.empty.title') }}
      </div>
      <p :class="['airi-text-muted', 'mt-2 text-sm']">
        {{
          records.length
            ? t('settings.pages.reply-feedback.empty.no-results')
            : t('settings.pages.reply-feedback.empty.no-feedback')
        }}
      </p>
    </div>

    <div
      v-for="record in filteredRecords"
      :key="record.id"
      :class="[
        'flex flex-col gap-4 rounded-xl p-4',
        record.disabledAt
          ? 'airi-status-warning'
          : 'airi-surface-panel',
      ]"
    >
      <div :class="['flex', 'flex-col', 'gap-3', 'xl:flex-row', 'xl:items-start', 'xl:justify-between']">
        <div :class="['flex', 'flex-wrap', 'gap-2']">
          <span
            :class="[
              'inline-flex', 'items-center', 'gap-1.5', 'rounded-md', 'px-2.5', 'py-1', 'text-xs', 'font-medium',
              record.rating === 'up'
                ? 'airi-status-success'
                : 'airi-status-danger',
            ]"
          >
            <span :class="['size-4', record.rating === 'up' ? 'i-solar:like-bold-duotone' : 'i-solar:dislike-bold-duotone']" />
            {{ t(`settings.pages.reply-feedback.record.rating.${record.rating}`) }}
          </span>

          <span :class="['airi-status-neutral', 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium']">
            <span :class="['size-4', 'i-solar:chat-round-bold-duotone']" />
            {{ surfaceLabel(record.sourceSurface) }}
          </span>

          <span
            :class="[
              'inline-flex', 'items-center', 'gap-1.5', 'rounded-md', 'px-2.5', 'py-1', 'text-xs', 'font-medium',
              record.disabledAt
                ? 'airi-status-warning'
                : 'airi-status-success',
            ]"
          >
            <span :class="['size-4', record.disabledAt ? 'i-solar:pause-circle-bold-duotone' : 'i-solar:check-circle-bold-duotone']" />
            {{ record.disabledAt ? t('settings.pages.reply-feedback.record.status.disabled') : t('settings.pages.reply-feedback.record.status.active') }}
          </span>
        </div>

        <div :class="['airi-text-muted', 'grid gap-2 text-xs sm:grid-cols-2 xl:text-right']">
          <div>
            {{ t('settings.pages.reply-feedback.record.created-at') }}:
            <span :class="['airi-text', 'font-medium']">{{ formatDateTime(record.createdAt) }}</span>
          </div>
          <div>
            {{ t('settings.pages.reply-feedback.record.updated-at') }}:
            <span :class="['airi-text', 'font-medium']">{{ formatDateTime(record.updatedAt) }}</span>
          </div>
          <div>
            {{ t('settings.pages.reply-feedback.record.session') }}:
            <span :class="['airi-text', 'font-mono']">{{ record.sessionId }}</span>
          </div>
          <div v-if="record.disabledAt">
            {{ t('settings.pages.reply-feedback.record.disabled-at') }}:
            <span :class="['airi-text', 'font-medium']">{{ formatDateTime(record.disabledAt) }}</span>
          </div>
        </div>
      </div>

      <div :class="['grid', 'gap-3', 'xl:grid-cols-2']">
        <div :class="[settingsCardClass, 'flex flex-col gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.record.user-message') }}
          </div>
          <div :class="['airi-text', 'break-words whitespace-pre-wrap text-sm leading-5']">
            {{ record.userMessagePreview || '—' }}
          </div>
        </div>

        <div :class="[settingsCardClass, 'flex flex-col gap-2']">
          <div :class="settingsLabelClass">
            {{ t('settings.pages.reply-feedback.record.assistant-reply') }}
          </div>
          <div :class="['airi-text', 'break-words whitespace-pre-wrap text-sm leading-5']">
            {{ record.assistantReplyPreview || '—' }}
          </div>
        </div>
      </div>

      <div :class="['flex', 'flex-col', 'gap-2']">
        <div :class="settingsLabelClass">
          {{ t('settings.pages.reply-feedback.record.note') }}
        </div>

        <template v-if="editingFeedbackId === record.id">
          <BasicTextarea
            v-model="noteDraftById[record.id]"
            default-height="6rem"
            :disabled="isPending(record.id)"
            :placeholder="t('settings.pages.reply-feedback.record.note-placeholder')"
            :class="[
              'airi-input',
              'px-3 py-2 text-sm leading-5',
            ]"
          />
        </template>
        <template v-else>
          <div
            :class="[
              'airi-status-neutral',
              'rounded-lg border-dashed px-3 py-2.5 text-sm leading-5',
              record.userNote ? 'airi-text' : 'airi-text-muted',
            ]"
          >
            {{ record.userNote || t('settings.pages.reply-feedback.record.note-empty') }}
          </div>
        </template>
      </div>

      <div :class="['flex', 'flex-wrap', 'items-center', 'justify-end', 'gap-2']">
        <template v-if="editingFeedbackId === record.id">
          <Button
            size="sm"
            variant="primary"
            :loading="isPending(record.id)"
            :disabled="!hasNoteChanges(record)"
            @click="saveNote(record)"
          >
            {{ t('settings.pages.reply-feedback.actions.save') }}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            :disabled="isPending(record.id)"
            @click="cancelEditing(record)"
          >
            {{ t('settings.pages.reply-feedback.actions.cancel') }}
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            variant="secondary-muted"
            :disabled="isPending(record.id)"
            @click="startEditing(record)"
          >
            {{ t('settings.pages.reply-feedback.actions.edit') }}
          </Button>
        </template>

        <Button
          size="sm"
          :variant="record.disabledAt ? 'secondary' : 'caution'"
          :loading="isPending(record.id)"
          @click="toggleRecordDisabled(record)"
        >
          {{ record.disabledAt ? t('settings.pages.reply-feedback.actions.enable') : t('settings.pages.reply-feedback.actions.disable') }}
        </Button>

        <DoubleCheckButton
          size="sm"
          variant="danger"
          :disabled="isPending(record.id)"
          :loading="isPending(record.id)"
          @confirm="deleteRecord(record)"
        >
          {{ t('settings.pages.reply-feedback.actions.delete') }}
          <template #confirm>
            {{ t('settings.pages.reply-feedback.actions.confirm-delete') }}
          </template>
          <template #cancel>
            {{ t('settings.pages.reply-feedback.actions.cancel') }}
          </template>
        </DoubleCheckButton>
      </div>

      <p
        v-if="actionErrorById[record.id]"
        :class="['airi-status-danger', 'rounded-lg px-3 py-2 text-sm']"
      >
        {{ actionErrorById[record.id] }}
      </p>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.reply-feedback.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.reply-feedback.description
  icon: i-solar:chat-round-like-bold-duotone
  settingsEntry: true
  order: 5.5
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
