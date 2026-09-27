<script setup lang="ts">
import { DIRECT_CONVERSATION_PREVIEW_VERSION, useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  characterId: string
  characterName: string
  busy?: boolean
}>()
const emit = defineEmits<{
  create: [characterId: string]
  select: [sessionId: string]
  delete: [sessionId: string]
}>()
const { t, locale } = useI18n()
const sessions = useChatSessionStore()
const query = ref('')
const editingId = ref('')
const editingTitle = ref('')
const deletingId = ref('')
const error = ref('')
const saving = ref(false)
const starringIds = ref(new Set<string>())
const conversations = computed(() => sessions.directSessions.filter(session => session.characterId === props.characterId))
const filteredConversations = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return conversations.value.filter(session => !search
    || `${session.title ?? ''} ${session.lastMessagePreview ?? ''}`.toLocaleLowerCase().includes(search))
})
const actionClass = [
  'grid size-7 shrink-0 place-items-center rounded-md text-[var(--airi-text-muted)]',
  'hover:bg-[var(--airi-surface-control-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)] disabled:opacity-40',
]
watch(() => props.characterId, () => {
  query.value = ''
  editingId.value = ''
  deletingId.value = ''
  error.value = ''
})
watch(() => JSON.stringify(conversations.value
  .filter(session => session.lastMessagePreviewVersion !== DIRECT_CONVERSATION_PREVIEW_VERSION)
  .slice(0, 8).map(session => session.sessionId)), async (signature) => {
  const sessionIds = JSON.parse(signature) as string[]
  if (!sessionIds.length)
    return
  try {
    await sessions.ensureDirectSessionPreviews(sessionIds)
  }
  catch {
    error.value = t('stage.chat.conversations.action-failed')
  }
}, { immediate: true })

async function toggleStar(sessionId: string, starred: boolean) {
  if (starringIds.value.has(sessionId))
    return
  starringIds.value.add(sessionId)
  error.value = ''
  try {
    await sessions.setDirectSessionStarred(sessionId, !starred)
  }
  catch {
    error.value = t('stage.chat.conversations.action-failed')
  }
  finally {
    starringIds.value.delete(sessionId)
  }
}
function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
async function saveTitle() {
  if (!editingTitle.value.trim() || saving.value)
    return
  saving.value = true
  error.value = ''
  try {
    await sessions.renameDirectSession(editingId.value, editingTitle.value.trim())
    editingId.value = ''
  }
  catch {
    error.value = t('stage.chat.conversations.action-failed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section :aria-label="t('stage.chat.conversations.with-character', { name: characterName })" :class="['flex min-h-0 flex-col gap-2']">
    <button
      type="button"
      :disabled="busy"
      :class="['flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium', 'airi-overlay-control-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']"
      @click="emit('create', characterId)"
    >
      <span class="i-lucide:plus size-4 shrink-0" aria-hidden="true" />
      <span :class="['min-w-0 break-words whitespace-normal']">{{ t('stage.chat.conversations.new-with-character', { name: characterName }) }}</span>
    </button>
    <p :class="['px-1 text-[11px] text-[var(--airi-text-muted)] leading-4']">
      {{ t('stage.chat.conversations.memory-kept') }}
    </p>
    <input
      v-model="query"
      type="search"
      :aria-label="t('stage.chat.conversations.search')"
      :placeholder="t('stage.chat.conversations.search')"
      :class="['h-9 w-full rounded-md border border-[var(--airi-border-subtle)] bg-transparent px-2 text-xs', 'outline-none focus:border-[var(--airi-accent)]']"
    >
    <p v-if="error" role="alert" :class="['airi-status-danger rounded-md p-2 text-xs']">{{ error }}</p>
    <p v-if="!filteredConversations.length" :class="['px-2 py-6 text-center text-xs text-[var(--airi-text-muted)]']">
      {{ t(query ? 'stage.chat.conversations.no-results' : 'stage.chat.conversations.empty') }}
    </p>
    <div v-for="conversation in filteredConversations" :key="conversation.sessionId" :class="['relative rounded-lg border', conversation.sessionId === sessions.activeSessionId ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)]' : 'border-transparent hover:bg-[var(--airi-surface-control-muted)]']">
      <form v-if="editingId === conversation.sessionId" :class="['flex flex-col gap-2 p-2']" @submit.prevent="saveTitle">
        <input v-model="editingTitle" autofocus maxlength="80" :aria-label="t('stage.chat.conversations.title-label')" :class="['h-8 min-w-0 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card-base)] px-2 text-xs outline-none focus:border-[var(--airi-accent)]']" @keydown.esc="editingId = ''">
        <div :class="['flex justify-end gap-2']">
          <button type="button" :disabled="saving" :class="['rounded px-2 py-1 text-xs airi-overlay-control-muted']" @click="editingId = ''">{{ t('stage.chat.conversations.cancel') }}</button>
          <button type="submit" :disabled="saving || !editingTitle.trim()" :class="['rounded px-2 py-1 text-xs airi-overlay-control-primary disabled:opacity-40']">{{ t('stage.chat.conversations.save') }}</button>
        </div>
      </form>
      <template v-else>
        <button type="button" :disabled="busy" :aria-current="conversation.sessionId === sessions.activeSessionId ? 'true' : undefined" :class="['block w-full rounded-lg px-2 pb-1 pt-2 text-left', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)] disabled:opacity-40']" @click="emit('select', conversation.sessionId)">
          <span :class="['block truncate pr-7 text-sm font-medium']">{{ conversation.title || t('stage.chat.conversations.untitled') }}</span>
          <span :class="['mt-1 block truncate text-xs text-[var(--airi-text-muted)]']">{{ conversation.lastMessagePreviewVersion === DIRECT_CONVERSATION_PREVIEW_VERSION ? conversation.lastMessagePreview || t('stage.chat.conversations.no-messages') : t('stage.chat.conversations.loading-preview') }}</span>
        </button>
        <button
          type="button"
          :disabled="busy || starringIds.has(conversation.sessionId)"
          :aria-pressed="Boolean(conversation.starred)"
          :aria-label="t(conversation.starred ? 'stage.chat.conversations.unstar' : 'stage.chat.conversations.star')"
          :title="t(conversation.starred ? 'stage.chat.conversations.unstar' : 'stage.chat.conversations.star')"
          :class="[actionClass, 'absolute right-1 top-1', conversation.starred && '!text-[var(--airi-accent)]']"
          @click="toggleStar(conversation.sessionId, Boolean(conversation.starred))"
        >
          <span :class="['size-4', conversation.starred ? 'i-solar:star-bold' : 'i-solar:star-linear']" aria-hidden="true" />
        </button>
        <div :class="['flex items-center gap-1 px-2 pb-1']">
          <time :datetime="new Date(conversation.lastMessageAt ?? conversation.updatedAt).toISOString()" :class="['min-w-0 flex-1 text-[10px] text-[var(--airi-text-soft)]']">{{ formatTime(conversation.lastMessageAt ?? conversation.updatedAt) }}</time>
          <button type="button" :disabled="busy" :aria-label="t('stage.chat.conversations.rename')" :title="t('stage.chat.conversations.rename')" :class="actionClass" @click="editingId = conversation.sessionId; editingTitle = conversation.title || ''; deletingId = ''"><span class="i-lucide:pencil size-3.5" aria-hidden="true" /></button>
          <button type="button" :disabled="busy" :aria-label="t('stage.chat.conversations.delete')" :title="t('stage.chat.conversations.delete')" :class="actionClass" @click="deletingId = conversation.sessionId"><span class="i-lucide:trash-2 size-3.5" aria-hidden="true" /></button>
        </div>
      </template>
      <div v-if="deletingId === conversation.sessionId" :class="['border-t border-[var(--airi-border-subtle)] p-2']" role="group" :aria-label="t('stage.chat.conversations.delete')">
        <p :class="['text-xs text-[var(--airi-text)] leading-5']">{{ t('stage.chat.conversations.delete-confirm', { title: conversation.title || t('stage.chat.conversations.untitled') }) }}</p>
        <div :class="['mt-2 flex justify-end gap-2']">
          <button type="button" :disabled="busy" :class="['rounded px-2 py-1 text-xs airi-overlay-control-muted']" @click="deletingId = ''">{{ t('stage.chat.conversations.cancel') }}</button>
          <button type="button" :disabled="busy" :class="['rounded px-2 py-1 text-xs airi-status-danger disabled:opacity-40']" @click="emit('delete', conversation.sessionId); deletingId = ''">{{ t('stage.chat.conversations.delete') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
