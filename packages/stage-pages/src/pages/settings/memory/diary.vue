<script setup lang="ts">
import type { NotebookEntry } from '@proj-airi/stage-ui/stores/character/notebook'

import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const WHITESPACE_RE = /\s+/g

const { t } = useI18n()
const notebook = useCharacterNotebookStore()
const editingId = ref<string>()
const editTitle = ref('')
const editText = ref('')
// 历史日记默认收起，只显示日期 + 标题 + 简略预览；点击展开全文。
const expandedId = ref<string>()
const pendingDeleteId = ref<string>()
const isPersisting = ref(false)
let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined

const drafts = computed(() => notebook.diaryDrafts.filter(draft => draft.status === 'draft'))
const diaries = computed(() => notebook.partitionDiary)

function formatPeriod(start: number, end: number) {
  const format = (value: number) => new Date(value).toLocaleDateString()
  return start === end ? format(start) : `${format(start)} - ${format(end)}`
}

function beginEdit(draft: typeof drafts.value[number]) {
  editingId.value = draft.id
  editTitle.value = draft.title
  editText.value = draft.text
}

function cancelEdit() {
  editingId.value = undefined
}

function saveEdit() {
  if (!editingId.value || !editText.value.trim())
    return
  notebook.updateDiaryDraft(editingId.value, {
    title: editTitle.value.trim() || t('settings.pages.memory.diary.untitled'),
    text: editText.value.trim(),
  })
  cancelEdit()
}

function toggleExpanded(id: string) {
  pendingDeleteId.value = undefined
  expandedId.value = expandedId.value === id ? undefined : id
}

function entryDay(entry: NotebookEntry) {
  const periodStart = Number(entry.metadata?.periodStart)
  if (Number.isFinite(periodStart) && periodStart > 0)
    return new Date(periodStart).toLocaleDateString()
  return new Date(entry.createdAt).toLocaleDateString()
}

function entryPreview(entry: NotebookEntry) {
  const text = entry.text.trim().replace(WHITESPACE_RE, ' ')
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

function entryImportantEvents(entry: NotebookEntry) {
  const value = entry.metadata?.importantEvents
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function persistDiaryAction(action: () => Promise<void>, errorKey: string) {
  if (isPersisting.value)
    return false

  isPersisting.value = true
  try {
    await action()
    return true
  }
  catch (error) {
    console.error('[Diary] Failed to persist diary action:', error)
    toast.error(t(errorKey))
    return false
  }
  finally {
    isPersisting.value = false
  }
}

async function confirmDraft(id: string) {
  await persistDiaryAction(() => notebook.confirmDiaryDraft(id), 'settings.pages.memory.diary.confirm-failed')
}

async function discardDraft(id: string) {
  await persistDiaryAction(() => notebook.discardDiaryDraft(id), 'settings.pages.memory.diary.discard-failed')
}

// 两步删除：第一次点击进入确认态，3 秒内再点才真正删除。
async function requestDelete(entry: NotebookEntry) {
  if (pendingDeleteId.value === entry.id) {
    clearTimeout(pendingDeleteTimer)
    pendingDeleteId.value = undefined
    const removed = await persistDiaryAction(() => notebook.removeDiaryEntry(entry.id), 'settings.pages.memory.diary.delete-failed')
    if (removed && expandedId.value === entry.id)
      expandedId.value = undefined
    return
  }
  pendingDeleteId.value = entry.id
  clearTimeout(pendingDeleteTimer)
  pendingDeleteTimer = setTimeout(() => {
    pendingDeleteId.value = undefined
  }, 3000)
}
</script>

<template>
  <div :class="['mx-auto max-w-4xl space-y-6 p-4 md:p-6']">
    <div>
      <h1 :class="['text-xl font-semibold airi-text']">
        {{ t('settings.pages.memory.diary.title') }}
      </h1>
      <p :class="['mt-1 text-sm airi-text-muted']">
        {{ t('settings.pages.memory.diary.description') }}
      </p>
    </div>

    <section v-if="drafts.length" :class="['space-y-3']">
      <h2 :class="['text-base font-semibold airi-text']">
        {{ t('settings.pages.memory.diary.drafts') }}
      </h2>
      <TransitionGroup name="diary-card" tag="div" :class="['space-y-3']">
        <article v-for="draft in drafts" :key="draft.id" :class="['airi-surface-panel rounded-lg p-4']">
          <template v-if="editingId === draft.id">
            <input v-model="editTitle" :class="['airi-control w-full rounded-md px-3 py-2 text-sm']">
            <textarea v-model="editText" :class="['airi-control mt-3 min-h-32 w-full rounded-md px-3 py-2 text-sm']" />
            <div :class="['mt-3 flex justify-end gap-2']">
              <button :class="['airi-control-muted rounded-md px-3 py-2 text-sm']" @click="cancelEdit">
                {{ t('settings.pages.memory.diary.cancel') }}
              </button>
              <button :class="['airi-status-success rounded-md px-3 py-2 text-sm font-medium']" @click="saveEdit">
                {{ t('settings.pages.memory.diary.save') }}
              </button>
            </div>
          </template>
          <template v-else>
            <h3 :class="['font-medium airi-text']">
              {{ draft.title }}
            </h3>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ formatPeriod(draft.periodStart, draft.periodEnd) }}
            </div>
            <p :class="['mt-2 whitespace-pre-wrap text-sm airi-text-muted']">
              {{ draft.text }}
            </p>
            <div v-if="draft.importantEvents?.length" :class="['mt-3 text-xs airi-text-muted']">
              {{ t('settings.pages.memory.diary.important-events') }}: {{ draft.importantEvents.join(' · ') }}
            </div>
            <div :class="['mt-3 flex justify-end gap-2']">
              <button :class="['airi-control-muted rounded-md px-3 py-2 text-sm']" @click="beginEdit(draft)">
                {{ t('settings.pages.memory.diary.edit') }}
              </button>
              <button :disabled="isPersisting" :class="['airi-status-danger rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60']" @click="discardDraft(draft.id)">
                {{ t('settings.pages.memory.diary.discard') }}
              </button>
              <button :disabled="isPersisting" :class="['airi-status-success rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60']" @click="confirmDraft(draft.id)">
                {{ t('settings.pages.memory.diary.confirm') }}
              </button>
            </div>
          </template>
        </article>
      </TransitionGroup>
    </section>

    <section :class="['space-y-3']">
      <h2 :class="['text-base font-semibold airi-text']">
        {{ t('settings.pages.memory.diary.history') }}
      </h2>
      <div v-if="diaries.length === 0" :class="['airi-surface-panel rounded-lg p-6 text-sm airi-text-muted']">
        {{ t('settings.pages.memory.diary.empty') }}
      </div>
      <TransitionGroup name="diary-card" tag="div" :class="['space-y-2']">
        <article v-for="entry in diaries" :key="entry.id" :class="['airi-surface-panel cursor-pointer rounded-lg p-4 transition-colors hover:bg-black/5 dark:hover:bg-white/5']" @click="toggleExpanded(entry.id)">
          <div :class="['flex items-center gap-3']">
            <span :class="['shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary']">{{ entryDay(entry) }}</span>
            <h3 :class="['min-w-0 flex-1 truncate font-medium airi-text']">
              {{ entry.metadata?.diaryTitle || t('settings.pages.memory.diary.untitled') }}
            </h3>
            <span :class="['i-solar:alt-arrow-down-linear h-4 w-4 shrink-0 text-xs transition-transform duration-200 airi-text-muted', expandedId === entry.id ? 'rotate-180' : '']" />
          </div>
          <p v-if="expandedId !== entry.id" :class="['mt-2 truncate text-xs airi-text-muted']">
            {{ entryPreview(entry) }}
          </p>
          <template v-else>
            <div v-if="entry.metadata?.periodStart" :class="['mt-2 text-xs airi-text-muted']">
              {{ formatPeriod(Number(entry.metadata.periodStart), Number(entry.metadata.periodEnd || entry.metadata.periodStart)) }}
            </div>
            <p :class="['mt-2 whitespace-pre-wrap text-sm airi-text-muted']">
              {{ entry.text }}
            </p>
            <div v-if="entryImportantEvents(entry).length" :class="['mt-3 text-xs airi-text-muted']">
              {{ t('settings.pages.memory.diary.important-events') }}: {{ entryImportantEvents(entry).join(' · ') }}
            </div>
            <div :class="['mt-3 flex justify-end gap-2']" @click.stop>
              <button :class="['airi-control-muted rounded-md px-3 py-2 text-sm']" @click="toggleExpanded(entry.id)">
                {{ t('settings.pages.memory.diary.collapse') }}
              </button>
              <button
                :class="[pendingDeleteId === entry.id ? 'airi-status-danger rounded-md px-3 py-2 text-sm font-medium animate-pulse' : 'airi-control-muted rounded-md px-3 py-2 text-sm']"
                :disabled="isPersisting"
                @click="requestDelete(entry)"
              >
                {{ pendingDeleteId === entry.id ? t('settings.pages.memory.diary.delete-confirm') : t('settings.pages.memory.diary.delete') }}
              </button>
            </div>
          </template>
        </article>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.diary-card-enter-active,
.diary-card-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.diary-card-enter-from,
.diary-card-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.diary.title
  subtitleKey: settings.pages.memory.title
  descriptionKey: settings.pages.memory.diary.description
  icon: i-solar:book-bookmark-bold-duotone
  settingsEntry: true
  order: 6
</route>
