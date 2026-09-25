<script setup lang="ts">
import type { ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'

import type { GroupRoomScriptState, GroupScriptTemplate } from './model'

import { useDownload } from '@proj-airi/stage-ui/composables/download'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { BasicTextarea, Button, DoubleCheckButton, FieldCheckbox, Input } from '@proj-airi/ui'
import { Select } from '@proj-airi/ui/components/form'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import {
  createEmptyGroupScript,
  createRoomScriptFromTemplate,
  decodeGroupScript,
  encodeGroupScript,
  loadGroupScripts,
  parseGroupRoomScriptState,
  parseGroupScript,
  saveGroupScripts,
} from './model'
import { reassignRoomCast } from './page-helpers'

interface PageStatus {
  kind: 'error' | 'info' | 'success'
  key: string
  params?: Record<string, string | number>
}

const INVALID_FILE_NAME_CHARS_PATTERN = /[\\/:*?"<>|]+/g

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const chatSession = useChatSessionStore()
const speechStore = useSpeechStore()
const { groupSessions } = storeToRefs(chatSession)
const {
  activeSpeechModel,
  activeSpeechProvider,
  activeSpeechVoiceId,
  selectedLanguage,
} = storeToRefs(speechStore)

const initialTemplates = loadGroupScripts()
const templates = ref<GroupScriptTemplate[]>(initialTemplates)
const selectedTemplateId = ref(initialTemplates[0]?.id ?? '')
const templateDraft = ref<GroupScriptTemplate>(initialTemplates[0]
  ? cloneTemplate(initialTemplates[0])
  : createTranslatedTemplate())
const requestedRoomId = computed(() => {
  const value = route.query.roomId
  return typeof value === 'string' ? value : ''
})
// Deep-linking from a live room should open the room cast editor directly;
// otherwise users land on the template tab and may mistake the hidden room
// snapshot for an unapplied script.
const activeEditorTab = ref<'template' | 'room'>(requestedRoomId.value ? 'room' : 'template')
const selectedRoomId = ref(requestedRoomId.value)
const roomScriptDraft = ref<GroupRoomScriptState>()
const roomLoading = ref(false)
const roomSaving = ref(false)
const roomTitleDraft = ref('')
const roomTitleSaving = ref(false)
const status = ref<PageStatus>()
const importInput = ref<HTMLInputElement>()
let roomLoadRevision = 0

const selectedRoom = computed(() => groupSessions.value.find(room => room.sessionId === selectedRoomId.value))
const selectedRoomParticipants = computed(() => selectedRoom.value?.participants ?? [])
const roomParticipantOptions = computed(() => selectedRoomParticipants.value.map(participant => ({
  label: participant.displayName,
  value: participant.characterId,
})))
const slotOptions = computed(() => templateDraft.value.slots.map(slot => ({
  label: `${slot.name} · ${slot.slotId}`,
  value: slot.slotId,
})))
const rulesText = computed({
  get: () => templateDraft.value.rules.join('\n'),
  set: (value: string) => {
    templateDraft.value.rules = value
      .split('\n')
      .map(rule => rule.trim())
      .filter(Boolean)
  },
})
const narrationEnabled = computed({
  get: () => roomScriptDraft.value?.narrationSettings.enabled ?? false,
  set: (enabled: boolean) => {
    if (!roomScriptDraft.value)
      return
    roomScriptDraft.value.narrationSettings.enabled = enabled
    if (!enabled)
      roomScriptDraft.value.narrationSettings.speechEnabled = false
  },
})
const narrationSpeechEnabled = computed({
  get: () => roomScriptDraft.value?.narrationSettings.speechEnabled ?? false,
  set: (enabled: boolean) => {
    if (!roomScriptDraft.value)
      return
    // Enabling narrator speech is itself an explicit opt-in to narration.
    // Keeping these flags independent made the voice picker appear to save
    // successfully while the room still reported "narration disabled".
    if (enabled)
      roomScriptDraft.value.narrationSettings.enabled = true
    roomScriptDraft.value.narrationSettings.speechEnabled = enabled
  },
})
const narrationVoiceLabel = computed(() => {
  const speech = roomScriptDraft.value?.narrationSettings.speech
  if (!speech)
    return t('settings.pages.group-scripts.narration.voice-empty')
  return `${speech.providerId} · ${speech.modelId} · ${speech.voiceId}`
})

function createTranslatedTemplate() {
  return createEmptyGroupScript({
    title: t('settings.pages.group-scripts.defaults.template-title'),
    slotName: t('settings.pages.group-scripts.defaults.slot-name', { number: 1 }),
  })
}

function cloneTemplate(template: GroupScriptTemplate) {
  return decodeGroupScript(encodeGroupScript(template))
}

function setStatus(kind: PageStatus['kind'], key: string, params?: PageStatus['params']) {
  status.value = { kind, key, params }
}

function mapTemplateError(error: unknown, fallbackKey: string) {
  const message = error instanceof Error ? error.message : ''
  setStatus('error', message.includes('64 KiB')
    ? 'settings.pages.group-scripts.status.too-large'
    : fallbackKey)
}

function selectTemplate(template: GroupScriptTemplate) {
  selectedTemplateId.value = template.id
  templateDraft.value = cloneTemplate(template)
  status.value = undefined
}

function newTemplate() {
  selectedTemplateId.value = ''
  templateDraft.value = createTranslatedTemplate()
  status.value = undefined
}

function saveTemplate() {
  try {
    const now = Date.now()
    const next = parseGroupScript({
      ...templateDraft.value,
      updatedAt: Math.max(now, templateDraft.value.createdAt),
    })
    const duplicate = templates.value.some(template => template.id === next.id && template.id !== selectedTemplateId.value)
    if (duplicate) {
      setStatus('error', 'settings.pages.group-scripts.status.duplicate-id')
      return
    }

    const index = selectedTemplateId.value
      ? templates.value.findIndex(template => template.id === selectedTemplateId.value)
      : -1
    templates.value = index >= 0
      ? templates.value.map((template, templateIndex) => templateIndex === index ? next : template)
      : [...templates.value, next]
    saveGroupScripts(templates.value)
    selectedTemplateId.value = next.id
    templateDraft.value = cloneTemplate(next)
    setStatus('success', 'settings.pages.group-scripts.status.template-saved')
  }
  catch (error) {
    mapTemplateError(error, 'settings.pages.group-scripts.status.template-invalid')
  }
}

function deleteTemplate() {
  if (!selectedTemplateId.value) {
    newTemplate()
    return
  }

  try {
    templates.value = templates.value.filter(template => template.id !== selectedTemplateId.value)
    saveGroupScripts(templates.value)
    const next = templates.value[0]
    if (next)
      selectTemplate(next)
    else
      newTemplate()
    setStatus('success', 'settings.pages.group-scripts.status.template-deleted')
  }
  catch (error) {
    mapTemplateError(error, 'settings.pages.group-scripts.status.storage-failed')
  }
}

function exportTemplate() {
  try {
    const validated = parseGroupScript(templateDraft.value)
    const fileName = (validated.title || validated.id).replace(INVALID_FILE_NAME_CHARS_PATTERN, '-').trim() || 'group-script'
    useDownload(
      new Blob([encodeGroupScript(validated)], { type: 'application/json' }),
      `${fileName}.json`,
    ).download()
    setStatus('success', 'settings.pages.group-scripts.status.template-exported')
  }
  catch (error) {
    mapTemplateError(error, 'settings.pages.group-scripts.status.template-invalid')
  }
}

function openImport() {
  importInput.value?.click()
}

async function importTemplate(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  try {
    const imported = decodeGroupScript(await file.text())
    const index = templates.value.findIndex(template => template.id === imported.id)
    templates.value = index >= 0
      ? templates.value.map((template, templateIndex) => templateIndex === index ? imported : template)
      : [...templates.value, imported]
    saveGroupScripts(templates.value)
    selectedTemplateId.value = imported.id
    templateDraft.value = cloneTemplate(imported)
    setStatus('success', 'settings.pages.group-scripts.status.template-imported')
  }
  catch (error) {
    mapTemplateError(error, 'settings.pages.group-scripts.status.import-invalid')
  }
  finally {
    input.value = ''
  }
}

function addSlot() {
  if (templateDraft.value.slots.length >= 4)
    return

  let number = templateDraft.value.slots.length + 1
  while (templateDraft.value.slots.some(slot => slot.slotId === `role-${number}`))
    number += 1
  templateDraft.value.slots.push({
    slotId: `role-${number}`,
    name: t('settings.pages.group-scripts.defaults.slot-name', { number }),
    description: '',
  })
}

function removeSlot(index: number) {
  if (templateDraft.value.slots.length <= 1)
    return
  const slotId = templateDraft.value.slots[index]?.slotId
  if (!slotId)
    return
  templateDraft.value.slots.splice(index, 1)
  templateDraft.value.relationships = templateDraft.value.relationships
    .filter(relationship => relationship.fromSlotId !== slotId && relationship.toSlotId !== slotId)
}

function addRelationship() {
  const [from, to] = templateDraft.value.slots
  if (!from || !to)
    return
  templateDraft.value.relationships.push({
    fromSlotId: from.slotId,
    toSlotId: to.slotId,
    description: '',
  })
}

function removeRelationship(index: number) {
  templateDraft.value.relationships.splice(index, 1)
}

async function loadSelectedRoomScript() {
  const sessionId = selectedRoomId.value
  const revision = ++roomLoadRevision
  roomScriptDraft.value = undefined
  if (!sessionId) {
    roomLoading.value = false
    return
  }

  roomLoading.value = true
  try {
    const loaded = await chatSession.resolveGroupRoomScript(sessionId)
    if (revision !== roomLoadRevision || sessionId !== selectedRoomId.value)
      return
    roomScriptDraft.value = loaded ? structuredClone(loaded) : undefined
  }
  catch {
    if (revision === roomLoadRevision)
      setStatus('error', 'settings.pages.group-scripts.status.room-load-failed')
  }
  finally {
    if (revision === roomLoadRevision)
      roomLoading.value = false
  }
}

async function applyTemplateToRoom() {
  const room = selectedRoom.value
  if (!room)
    return setStatus('error', 'settings.pages.group-scripts.status.room-required')

  try {
    roomSaving.value = true
    const next = createRoomScriptFromTemplate({
      template: parseGroupScript(templateDraft.value),
      participantIds: room.participants?.map(participant => participant.characterId) ?? [],
      narrationSettings: roomScriptDraft.value?.narrationSettings,
    })
    const saved = await chatSession.updateGroupRoomScript(room.sessionId, next)
    if (room.sessionId === selectedRoomId.value)
      roomScriptDraft.value = structuredClone(saved)
    setStatus('success', 'settings.pages.group-scripts.status.template-applied', { room: room.title ?? '' })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    setStatus('error', message.includes('slot count')
      ? 'settings.pages.group-scripts.status.slot-count-mismatch'
      : 'settings.pages.group-scripts.status.room-save-failed')
  }
  finally {
    roomSaving.value = false
  }
}

async function saveRoomScript() {
  const room = selectedRoom.value
  const draft = roomScriptDraft.value
  if (!room || !draft)
    return setStatus('error', 'settings.pages.group-scripts.status.apply-first')

  try {
    roomSaving.value = true
    const next = parseGroupRoomScriptState(
      draft,
      room.participants?.map(participant => participant.characterId) ?? [],
    )
    const saved = await chatSession.updateGroupRoomScript(room.sessionId, next)
    if (room.sessionId === selectedRoomId.value)
      roomScriptDraft.value = structuredClone(saved)
    setStatus('success', 'settings.pages.group-scripts.status.room-saved')
  }
  catch (error) {
    // Validation errors are actionable cast problems; storage/concurrency
    // failures should not be mislabeled as a bad role assignment.
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    const isBindingError = message.includes('binding')
      || message.includes('participant')
      || message.includes('slot')
    setStatus('error', isBindingError
      ? 'settings.pages.group-scripts.status.bindings-invalid'
      : 'settings.pages.group-scripts.status.room-save-failed')
  }
  finally {
    roomSaving.value = false
  }
}

async function saveRoomTitle() {
  const room = selectedRoom.value
  const title = roomTitleDraft.value.trim()
  if (!room || !title || roomTitleSaving.value)
    return

  try {
    roomTitleSaving.value = true
    const renamed = await chatSession.renameGroupSession(room.sessionId, title)
    setStatus(renamed ? 'success' : 'error', renamed
      ? 'settings.pages.group-scripts.status.room-renamed'
      : 'settings.pages.group-scripts.status.room-rename-failed')
  }
  catch {
    setStatus('error', 'settings.pages.group-scripts.status.room-rename-failed')
  }
  finally {
    roomTitleSaving.value = false
  }
}

async function clearRoomScript() {
  const room = selectedRoom.value
  if (!room)
    return
  try {
    roomSaving.value = true
    await chatSession.clearGroupRoomScript(room.sessionId)
    if (room.sessionId === selectedRoomId.value)
      roomScriptDraft.value = undefined
    setStatus('success', 'settings.pages.group-scripts.status.room-cleared')
  }
  catch {
    setStatus('error', 'settings.pages.group-scripts.status.room-save-failed')
  }
  finally {
    roomSaving.value = false
  }
}

function setRoleBinding(slotId: string, characterId: string | number | undefined) {
  if (!roomScriptDraft.value || typeof characterId !== 'string')
    return
  roomScriptDraft.value.roleBindings = reassignRoomCast(
    roomScriptDraft.value.roleBindings,
    slotId,
    characterId,
  )
}

function captureNarrationVoice() {
  if (!roomScriptDraft.value)
    return
  const providerId = activeSpeechProvider.value
  const modelId = activeSpeechModel.value
  const voiceId = activeSpeechVoiceId.value
  if (!providerId || providerId === 'speech-noop' || !modelId || !voiceId) {
    setStatus('error', 'settings.pages.group-scripts.status.voice-unavailable')
    return
  }

  roomScriptDraft.value.narrationSettings.speech = {
    providerId,
    modelId,
    voiceId,
    language: selectedLanguage.value || undefined,
  }
  // Selecting a narrator voice is an intentional enable action.  Previously
  // the voice could be captured while the parent narration switch remained
  // off, so the saved room immediately displayed "narration disabled".
  roomScriptDraft.value.narrationSettings.enabled = true
  roomScriptDraft.value.narrationSettings.speechEnabled = true
  setStatus('info', 'settings.pages.group-scripts.status.voice-captured')
}

function clearNarrationVoice() {
  if (roomScriptDraft.value)
    roomScriptDraft.value.narrationSettings.speech = undefined
}

function roomLabel(room: ChatSessionMeta) {
  return room.title?.trim()
    || room.participants?.map(participant => participant.displayName).join(' · ')
    || t('settings.pages.group-scripts.rooms.untitled')
}

watch(groupSessions, (rooms) => {
  const preferredRoomId = requestedRoomId.value && rooms.some(room => room.sessionId === requestedRoomId.value)
    ? requestedRoomId.value
    : selectedRoomId.value && rooms.some(room => room.sessionId === selectedRoomId.value)
      ? selectedRoomId.value
      : rooms[0]?.sessionId ?? ''
  if (preferredRoomId !== selectedRoomId.value)
    selectedRoomId.value = preferredRoomId
}, { immediate: true })

// The settings window may already be open when another room invokes the
// deep-link. React to query changes as well as the initial mount so the editor
// follows the room that requested it instead of retaining a previous cast.
watch(requestedRoomId, (roomId) => {
  if (!roomId || !groupSessions.value.some(room => room.sessionId === roomId))
    return
  activeEditorTab.value = 'room'
  if (selectedRoomId.value !== roomId)
    selectedRoomId.value = roomId
})

watch(selectedRoomId, () => {
  status.value = undefined
  void loadSelectedRoomScript()
})

watch(
  () => selectedRoom.value?.title,
  title => roomTitleDraft.value = title?.trim() ?? '',
  { immediate: true },
)

// A room can be edited from the chat surface while this page stays open. If
// its cast changes, the existing draft no longer satisfies the one-to-one
// binding contract; reload it before the next narration save instead of
// surfacing a misleading "settings failed" error.
watch(
  () => selectedRoom.value?.participants?.map(participant => participant.characterId).join('\u0000') ?? '',
  (next, previous) => {
    if (next !== previous && selectedRoomId.value)
      void loadSelectedRoomScript()
  },
)

// Keep this editor coherent when the narration toggle is changed from the
// main chat or quick-chat window. Do not interrupt an in-flight local save;
// its response is already applied to the draft below.
watch(
  () => selectedRoom.value?.roomScriptRevision,
  (next, previous) => {
    if (next !== previous && selectedRoomId.value && !roomSaving.value)
      void loadSelectedRoomScript()
  },
)

onMounted(async () => {
  try {
    await chatSession.initialize()
    // The room list is hydrated by initialize().  A route can mount while the
    // list is still empty, so the selected-room watcher may have returned
    // early; explicitly resolve the persisted snapshot once initialization
    // completes to avoid showing a false "no script" state after re-entry.
    if (selectedRoomId.value)
      await loadSelectedRoomScript()
  }
  catch {
    setStatus('error', 'settings.pages.group-scripts.status.rooms-load-failed')
  }
})
</script>

<template>
  <div
    data-airi-runtime-route="/settings/group-scenarios"
    :class="['mx-auto w-full max-w-[88rem] pb-8', 'flex flex-col gap-4']"
  >
    <section :class="['airi-surface-panel overflow-hidden rounded-2xl', 'border border-[var(--airi-border-subtle)]']">
      <div :class="['relative px-5 py-5 sm:px-6', 'flex flex-col gap-3']">
        <div :class="['pointer-events-none absolute inset-y-0 left-0 w-1', 'bg-[var(--airi-accent-strong)] opacity-70']" />
        <div :class="['flex items-start justify-between gap-4']">
          <div>
            <p :class="['m-0 text-[11px] font-semibold tracking-[0.16em] uppercase', 'text-[var(--airi-text-soft)]']">
              {{ t('settings.pages.group-scripts.eyebrow') }}
            </p>
            <h1 :class="['airi-text m-0 mt-1 text-xl font-semibold sm:text-2xl']">
              {{ t('settings.pages.group-scripts.title') }}
            </h1>
            <p :class="['airi-text-muted m-0 mt-2 max-w-3xl text-sm leading-6']">
              {{ t('settings.pages.group-scripts.description') }}
            </p>
          </div>
          <div :class="['i-solar:clapperboard-play-bold-duotone size-9 shrink-0', 'text-[var(--airi-accent-text)]']" />
        </div>
        <div :class="['airi-callout rounded-xl px-3 py-2', 'flex items-start gap-2 text-xs leading-5']">
          <div :class="['i-solar:shield-check-bold-duotone mt-0.5 size-4 shrink-0']" />
          <span>{{ t('settings.pages.group-scripts.local-note') }}</span>
        </div>
      </div>
    </section>

    <p
      v-if="status"
      role="status"
      :class="[
        'm-0 rounded-xl px-4 py-3 text-sm',
        status.kind === 'error'
          ? 'airi-status-danger'
          : status.kind === 'success'
            ? 'airi-status-success'
            : 'airi-callout',
      ]"
    >
      {{ t(status.key, status.params ?? {}) }}
    </p>

    <div :class="['grid items-start gap-4', 'xl:grid-cols-[18rem_minmax(0,1fr)]']">
      <aside :class="['flex flex-col gap-4 xl:sticky xl:top-3']">
        <section :class="['airi-surface-panel rounded-xl p-4', 'flex flex-col gap-3']">
          <div :class="['flex items-center gap-2']">
            <div :class="['i-solar:users-group-rounded-bold-duotone size-5']" />
            <h2 :class="['airi-text m-0 text-sm font-semibold']">
              {{ t('settings.pages.group-scripts.rooms.title') }}
            </h2>
          </div>
          <p v-if="!groupSessions.length" :class="['airi-text-muted m-0 text-xs leading-5']">
            {{ t('settings.pages.group-scripts.rooms.empty') }}
          </p>
          <div v-else :class="['flex flex-col gap-1.5']">
            <button
              v-for="room in groupSessions"
              :key="room.sessionId"
              type="button"
              :aria-pressed="selectedRoomId === room.sessionId"
              :class="[
                'w-full rounded-lg px-3 py-2 text-left outline-none transition-colors',
                'focus:ring-2 focus:ring-[var(--airi-accent-focus)]',
                selectedRoomId === room.sessionId
                  ? 'airi-overlay-control-primary'
                  : 'airi-overlay-control-muted',
              ]"
              @click="selectedRoomId = room.sessionId"
            >
              <span :class="['block truncate text-sm font-medium']">{{ roomLabel(room) }}</span>
              <span :class="['mt-0.5 block truncate text-[11px] opacity-75']">
                {{ t('settings.pages.group-scripts.rooms.member-count', { count: room.participants?.length ?? 0 }) }}
              </span>
            </button>
          </div>
        </section>

        <section :class="['airi-surface-panel rounded-xl p-4', 'flex flex-col gap-3']">
          <div :class="['flex items-center justify-between gap-2']">
            <div :class="['flex items-center gap-2']">
              <div :class="['i-solar:folder-with-files-bold-duotone size-5']" />
              <h2 :class="['airi-text m-0 text-sm font-semibold']">
                {{ t('settings.pages.group-scripts.library.title') }}
              </h2>
            </div>
            <Button size="sm" variant="secondary-muted" icon="i-solar:add-circle-bold" :label="t('settings.pages.group-scripts.actions.new')" @click="newTemplate" />
          </div>
          <p v-if="!templates.length" :class="['airi-text-muted m-0 text-xs leading-5']">
            {{ t('settings.pages.group-scripts.library.empty') }}
          </p>
          <div v-else :class="['flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1']">
            <button
              v-for="template in templates"
              :key="template.id"
              type="button"
              :aria-pressed="selectedTemplateId === template.id"
              :class="[
                'w-full rounded-lg px-3 py-2 text-left outline-none transition-colors',
                'focus:ring-2 focus:ring-[var(--airi-accent-focus)]',
                selectedTemplateId === template.id
                  ? 'airi-overlay-control-primary'
                  : 'airi-overlay-control-muted',
              ]"
              @click="selectTemplate(template)"
            >
              <span :class="['block truncate text-sm font-medium']">{{ template.title }}</span>
              <span :class="['mt-0.5 block truncate text-[11px] opacity-75']">{{ template.id }}</span>
            </button>
          </div>
        </section>
      </aside>

      <main :class="['min-w-0 flex flex-col gap-4']">
        <nav
          :class="['airi-surface-panel rounded-xl p-1.5', 'flex flex-wrap gap-1.5']"
          role="tablist"
          :aria-label="t('settings.pages.group-scripts.tabs.label')"
        >
          <button
            v-for="tab in (['template', 'room'] as const)"
            :key="tab"
            type="button"
            role="tab"
            :aria-selected="activeEditorTab === tab"
            :class="[
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors sm:flex-none sm:px-5',
              'focus:ring-2 focus:ring-[var(--airi-accent-focus)]',
              activeEditorTab === tab ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
            ]"
            @click="activeEditorTab = tab"
          >
            <span :class="tab === 'template' ? 'i-solar:document-text-bold-duotone' : 'i-solar:users-group-rounded-bold-duotone'" class="size-4" aria-hidden="true" />
            {{ t(`settings.pages.group-scripts.tabs.${tab}`) }}
          </button>
        </nav>

        <section v-show="activeEditorTab === 'template'" :class="['airi-surface-panel rounded-xl p-4 sm:p-5', 'flex flex-col gap-4']">
          <div :class="['flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between']">
            <div>
              <h2 :class="['airi-text m-0 flex items-center gap-2 text-lg font-semibold']">
                <span :class="['i-solar:document-text-bold-duotone size-5 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                <span>{{ t('settings.pages.group-scripts.editor.title') }}</span>
              </h2>
              <p :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
                {{ t('settings.pages.group-scripts.editor.description') }}
              </p>
            </div>
            <div :class="['flex flex-wrap gap-2']">
              <Button size="sm" variant="secondary" icon="i-solar:upload-bold" :label="t('settings.pages.group-scripts.actions.import')" @click="openImport" />
              <Button size="sm" variant="secondary" icon="i-solar:download-bold" :label="t('settings.pages.group-scripts.actions.export')" @click="exportTemplate" />
              <Button size="sm" icon="i-solar:diskette-bold" :label="t('settings.pages.group-scripts.actions.save-template')" @click="saveTemplate" />
              <input ref="importInput" type="file" accept="application/json,.json" :class="['hidden']" @change="importTemplate">
            </div>
          </div>

          <details open :class="['group-script-fold rounded-xl border border-[var(--airi-border-subtle)] p-3 sm:p-4']">
            <summary :class="['flex cursor-pointer list-none items-center justify-between gap-3', 'airi-text text-sm font-semibold']">
              <span :class="['flex items-center gap-2']">
                <span :class="['i-solar:document-text-bold-duotone size-4 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                {{ t('settings.pages.group-scripts.sections.basic') }}
              </span>
              <span :class="['i-solar:alt-arrow-down-linear size-4 transition-transform group-open:rotate-180']" aria-hidden="true" />
            </summary>
            <div :class="['mt-3 flex flex-col gap-3']">
              <div :class="['grid gap-3 md:grid-cols-2']">
                <label :class="['flex flex-col gap-1.5']">
                  <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.title') }}</span>
                  <Input v-model="templateDraft.title" class="group-script-control" />
                </label>
                <label :class="['flex flex-col gap-1.5']">
                  <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.id') }}</span>
                  <Input v-model="templateDraft.id" class="group-script-control" />
                </label>
              </div>
              <label :class="['flex flex-col gap-1.5']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.summary') }}</span>
                <BasicTextarea v-model="templateDraft.summary" class="group-script-control" :rows="2" />
              </label>
            </div>
          </details>

          <details open :class="['group-script-fold rounded-xl border border-[var(--airi-border-subtle)] p-3 sm:p-4']">
            <summary :class="['flex cursor-pointer list-none items-center justify-between gap-3', 'airi-text text-sm font-semibold']">
              <span :class="['flex items-center gap-2']">
                <span :class="['i-solar:map-point-wave-bold-duotone size-4 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                {{ t('settings.pages.group-scripts.sections.scene') }}
              </span>
              <span :class="['i-solar:alt-arrow-down-linear size-4 transition-transform group-open:rotate-180']" aria-hidden="true" />
            </summary>
            <div :class="['mt-3 grid gap-3 lg:grid-cols-2']">
              <label :class="['flex flex-col gap-1.5 lg:col-span-2']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.background') }}</span>
                <BasicTextarea v-model="templateDraft.background" class="group-script-control" :rows="4" />
              </label>
              <label :class="['flex flex-col gap-1.5']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.premise') }}</span>
                <BasicTextarea v-model="templateDraft.premise" class="group-script-control" :rows="4" />
              </label>
              <label :class="['flex flex-col gap-1.5']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.current-scene') }}</span>
                <BasicTextarea v-model="templateDraft.currentScene" class="group-script-control" :rows="4" />
              </label>
              <label :class="['flex flex-col gap-1.5']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.rules') }}</span>
                <BasicTextarea v-model="rulesText" class="group-script-control" :rows="4" :placeholder="t('settings.pages.group-scripts.fields.rules-placeholder')" />
              </label>
              <label :class="['flex flex-col gap-1.5']">
                <span :class="['airi-text-muted text-xs font-medium']">{{ t('settings.pages.group-scripts.fields.mention-guidance') }}</span>
                <BasicTextarea v-model="templateDraft.mentionGuidance" class="group-script-control" :rows="4" />
              </label>
            </div>
          </details>
        </section>

        <section v-show="activeEditorTab === 'template'" :class="['airi-surface-panel rounded-xl p-4 sm:p-5', 'flex flex-col gap-4']">
          <div :class="['flex items-start justify-between gap-3']">
            <div>
              <h2 :class="['airi-text m-0 flex items-center gap-2 text-base font-semibold']">
                <span :class="['i-solar:user-id-bold-duotone size-5 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                <span>{{ t('settings.pages.group-scripts.slots.title') }}</span>
              </h2>
              <p :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
                {{ t('settings.pages.group-scripts.slots.description') }}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary-muted"
              icon="i-solar:add-circle-bold"
              :disabled="templateDraft.slots.length >= 4"
              :label="t('settings.pages.group-scripts.actions.add-slot')"
              @click="addSlot"
            />
          </div>

          <div :class="['grid gap-3 lg:grid-cols-2']">
            <article
              v-for="(slot, index) in templateDraft.slots"
              :key="`${slot.slotId}-${index}`"
              :class="['airi-card rounded-xl p-3', 'flex flex-col gap-3']"
            >
              <div :class="['flex items-center justify-between gap-2']">
                <span :class="['airi-text text-xs font-semibold']">
                  {{ t('settings.pages.group-scripts.slots.role-number', { number: index + 1 }) }}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="i-solar:trash-bin-trash-bold"
                  :disabled="templateDraft.slots.length <= 1"
                  :label="t('settings.pages.group-scripts.actions.remove')"
                  @click="removeSlot(index)"
                />
              </div>
              <div :class="['grid gap-2 sm:grid-cols-2']">
                <label :class="['flex flex-col gap-1']">
                  <span :class="['airi-text-muted text-[11px]']">{{ t('settings.pages.group-scripts.fields.slot-name') }}</span>
                  <Input v-model="slot.name" class="group-script-control" />
                </label>
                <label :class="['flex flex-col gap-1']">
                  <span :class="['airi-text-muted text-[11px]']">{{ t('settings.pages.group-scripts.fields.slot-id') }}</span>
                  <Input v-model="slot.slotId" class="group-script-control" />
                </label>
              </div>
              <label :class="['flex flex-col gap-1']">
                <span :class="['airi-text-muted text-[11px]']">{{ t('settings.pages.group-scripts.fields.slot-description') }}</span>
                <BasicTextarea v-model="slot.description" class="group-script-control" :rows="3" />
              </label>
            </article>
          </div>

          <div :class="['border-t border-[var(--airi-border-subtle)] pt-4', 'flex flex-col gap-3']">
            <div :class="['flex items-start justify-between gap-3']">
              <div>
                <h3 :class="['airi-text m-0 flex items-center gap-2 text-sm font-semibold']">
                  <span :class="['i-solar:link-round-angle-bold-duotone size-4 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                  <span>{{ t('settings.pages.group-scripts.relationships.title') }}</span>
                </h3>
                <p :class="['airi-text-muted m-0 mt-1 text-xs']">
                  {{ t('settings.pages.group-scripts.relationships.description') }}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary-muted"
                icon="i-solar:add-circle-bold"
                :disabled="templateDraft.slots.length < 2"
                :label="t('settings.pages.group-scripts.actions.add-relationship')"
                @click="addRelationship"
              />
            </div>
            <p v-if="!templateDraft.relationships.length" :class="['airi-text-muted m-0 text-xs']">
              {{ t('settings.pages.group-scripts.relationships.empty') }}
            </p>
            <div
              v-for="(relationship, index) in templateDraft.relationships"
              :key="index"
              :class="['airi-card rounded-xl p-3', 'grid items-end gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_2fr_auto]']"
            >
              <Select v-model="relationship.fromSlotId" class="group-script-control" :options="slotOptions" />
              <div :class="['i-solar:arrow-right-linear mx-auto size-4']" />
              <Select v-model="relationship.toSlotId" class="group-script-control" :options="slotOptions" />
              <Input v-model="relationship.description" class="group-script-control" :placeholder="t('settings.pages.group-scripts.fields.relationship-description')" />
              <Button size="sm" variant="ghost" :label="t('settings.pages.group-scripts.actions.remove')" @click="removeRelationship(index)" />
            </div>
          </div>

          <label :class="['border-t border-[var(--airi-border-subtle)] pt-4', 'flex flex-col gap-1.5']">
            <span :class="['airi-text flex items-center gap-2 text-sm font-semibold']">
              <span :class="['i-solar:pallete-2-bold-duotone size-4 text-[var(--airi-accent-text)]']" aria-hidden="true" />
              <span>{{ t('settings.pages.group-scripts.narration.template-style') }}</span>
            </span>
            <span :class="['airi-text-muted text-xs']">{{ t('settings.pages.group-scripts.narration.template-style-description') }}</span>
            <BasicTextarea v-model="templateDraft.narrationStyleDefault" class="group-script-control" :rows="3" />
          </label>

          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <DoubleCheckButton variant="danger" size="sm" @confirm="deleteTemplate">
              {{ t('settings.pages.group-scripts.actions.delete-template') }}
              <template #confirm>
                {{ t('settings.pages.group-scripts.actions.confirm-delete-template') }}
              </template>
              <template #cancel>
                {{ t('settings.pages.group-scripts.actions.cancel') }}
              </template>
            </DoubleCheckButton>
            <Button icon="i-solar:checklist-minimalistic-bold-duotone" :label="t('settings.pages.group-scripts.actions.apply-to-room')" :disabled="!selectedRoom || roomSaving" :loading="roomSaving" @click="applyTemplateToRoom" />
          </div>
        </section>

        <section v-show="activeEditorTab === 'room'" :class="['airi-surface-panel rounded-xl p-4 sm:p-5', 'flex flex-col gap-4']">
          <div>
            <p :class="['m-0 text-[11px] font-semibold tracking-[0.14em] uppercase', 'text-[var(--airi-text-soft)]']">
              {{ t('settings.pages.group-scripts.cast.eyebrow') }}
            </p>
            <h2 :class="['airi-text m-0 mt-1 flex items-center gap-2 text-lg font-semibold']">
              <span :class="['i-solar:users-group-rounded-bold-duotone size-5 text-[var(--airi-accent-text)]']" aria-hidden="true" />
              <span>{{ selectedRoom ? roomLabel(selectedRoom) : t('settings.pages.group-scripts.cast.title') }}</span>
            </h2>
            <p :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
              {{ t('settings.pages.group-scripts.cast.description') }}
            </p>
            <label v-if="selectedRoom" :class="['mt-3 flex flex-col gap-1.5']">
              <span :class="['airi-text text-sm font-medium']">
                {{ t('settings.pages.group-scripts.fields.room-name') }}
              </span>
              <div :class="['flex flex-col gap-2 sm:flex-row sm:items-center']">
                <Input
                  v-model="roomTitleDraft"
                  class="group-script-control min-w-0 flex-1"
                  maxlength="80"
                  :disabled="roomTitleSaving"
                  @keydown.enter.prevent="saveRoomTitle"
                />
                <Button
                  size="sm"
                  icon="i-solar:diskette-bold"
                  :label="t('settings.pages.group-scripts.actions.save-room-name')"
                  :disabled="!roomTitleDraft.trim() || roomTitleDraft.trim() === selectedRoom.title?.trim()"
                  :loading="roomTitleSaving"
                  @click="saveRoomTitle"
                />
              </div>
            </label>
            <div :class="['mt-3 rounded-lg border border-[var(--airi-border-subtle)] px-3 py-2', 'flex items-center gap-2 text-xs']">
              <span :class="roomScriptDraft?.narrationSettings.enabled ? 'i-solar:volume-loud-bold-duotone text-[var(--airi-accent-text)]' : 'i-solar:volume-cross-bold-duotone text-[var(--airi-text-soft)]'" class="size-4 shrink-0" aria-hidden="true" />
              <span v-if="!roomScriptDraft" class="airi-text-muted">
                {{ t('settings.pages.group-scripts.narration.room-status-unconfigured') }}
              </span>
              <span v-else class="airi-text">
                {{ roomScriptDraft.narrationSettings.enabled ? t('settings.pages.group-scripts.narration.room-status-enabled') : t('settings.pages.group-scripts.narration.room-status-disabled') }}
              </span>
            </div>
          </div>

          <div v-if="roomLoading" :class="['airi-card rounded-xl p-5 text-center text-sm']">
            {{ t('settings.pages.group-scripts.rooms.loading') }}
          </div>
          <div v-else-if="!selectedRoom" :class="['airi-card rounded-xl p-5 text-center text-sm']">
            {{ t('settings.pages.group-scripts.cast.no-room') }}
          </div>
          <div v-else-if="!roomScriptDraft" :class="['airi-card rounded-xl p-5 text-center', 'flex flex-col items-center gap-2']">
            <div :class="['i-solar:clipboard-remove-bold-duotone size-7']" />
            <p :class="['airi-text m-0 text-sm font-medium']">
              {{ t('settings.pages.group-scripts.cast.no-script') }}
            </p>
            <p :class="['airi-text-muted m-0 text-xs']">
              {{ t('settings.pages.group-scripts.cast.no-script-description') }}
            </p>
            <Button
              size="sm"
              icon="i-solar:checklist-minimalistic-bold-duotone"
              :label="t('settings.pages.group-scripts.actions.apply-to-room')"
              :disabled="roomSaving"
              :loading="roomSaving"
              @click="applyTemplateToRoom"
            />
          </div>
          <template v-else>
            <div :class="['relative flex flex-col gap-3 pl-5']">
              <div :class="['pointer-events-none absolute bottom-4 left-2 top-4 w-px', 'bg-[var(--airi-border-accent)]']" />
              <article
                v-for="slot in roomScriptDraft.templateSnapshot.slots"
                :key="slot.slotId"
                :class="['airi-card relative rounded-xl p-3', 'grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center']"
              >
                <div :class="['absolute -left-[1.05rem] top-1/2 size-2.5 -translate-y-1/2 rounded-full', 'border-2 border-[var(--airi-border-accent)] bg-[var(--airi-surface-panel)]']" />
                <div :class="['min-w-0']">
                  <p :class="['airi-text m-0 truncate text-sm font-semibold']">
                    {{ slot.name }}
                  </p>
                  <p :class="['airi-text-muted m-0 mt-0.5 truncate text-[11px]']">
                    {{ slot.slotId }}
                  </p>
                  <p v-if="slot.description" :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
                    {{ slot.description }}
                  </p>
                </div>
                <div :class="['i-solar:arrow-right-down-linear mx-auto hidden size-5 md:block']" />
                <Select
                  class="group-script-control"
                  :model-value="roomScriptDraft.roleBindings[slot.slotId]"
                  :options="roomParticipantOptions"
                  :placeholder="t('settings.pages.group-scripts.cast.choose-member')"
                  @update:model-value="setRoleBinding(slot.slotId, $event)"
                />
              </article>
            </div>

            <div :class="['border-t border-[var(--airi-border-subtle)] pt-4', 'flex flex-col gap-3']">
              <div>
                <h3 :class="['airi-text m-0 flex items-center gap-2 text-base font-semibold']">
                  <span :class="['i-solar:soundwave-bold-duotone size-5 text-[var(--airi-accent-text)]']" aria-hidden="true" />
                  <span>{{ t('settings.pages.group-scripts.narration.room-title') }}</span>
                </h3>
                <p :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
                  {{ t('settings.pages.group-scripts.narration.room-description') }}
                </p>
              </div>
              <FieldCheckbox
                v-model="narrationEnabled"
                :label="t('settings.pages.group-scripts.narration.enabled')"
                :description="t('settings.pages.group-scripts.narration.enabled-description')"
              />
              <fieldset :disabled="!narrationEnabled" :class="['m-0 min-w-0 border-0 p-0', !narrationEnabled ? 'pointer-events-none opacity-50' : '']">
                <div :class="['flex flex-col gap-3']">
                  <label :class="['flex flex-col gap-1.5']">
                    <span :class="['airi-text text-sm font-medium']">{{ t('settings.pages.group-scripts.narration.room-style') }}</span>
                    <BasicTextarea v-model="roomScriptDraft.narrationSettings.styleDescription" class="group-script-control" :rows="3" />
                  </label>
                  <FieldCheckbox
                    v-model="narrationSpeechEnabled"
                    :label="t('settings.pages.group-scripts.narration.speech-enabled')"
                    :description="t('settings.pages.group-scripts.narration.speech-enabled-description')"
                  />
                  <fieldset :disabled="!narrationSpeechEnabled" :class="['m-0 min-w-0 border-0 p-0', !narrationSpeechEnabled ? 'pointer-events-none opacity-50' : '']">
                    <div :class="['airi-card rounded-xl p-3', 'flex flex-col gap-3']">
                      <div :class="['min-w-0']">
                        <p :class="['airi-text m-0 text-sm font-medium']">
                          {{ t('settings.pages.group-scripts.narration.voice') }}
                        </p>
                        <p :class="['airi-text-muted m-0 mt-1 break-all text-xs']">
                          {{ narrationVoiceLabel }}
                        </p>
                      </div>
                      <div :class="['flex flex-wrap gap-2']">
                        <Button size="sm" variant="secondary" icon="i-solar:soundwave-bold-duotone" :label="t('settings.pages.group-scripts.actions.use-current-voice')" @click="captureNarrationVoice" />
                        <Button size="sm" variant="ghost" icon="i-solar:trash-bin-trash-bold" :label="t('settings.pages.group-scripts.actions.clear-voice')" @click="clearNarrationVoice" />
                        <Button size="sm" variant="ghost" icon="i-solar:settings-minimalistic-bold-duotone" :label="t('settings.pages.group-scripts.actions.open-speech-settings')" @click="router.push('/settings/speech')" />
                      </div>
                    </div>
                  </fieldset>
                </div>
              </fieldset>
            </div>

            <div :class="['flex flex-wrap items-center justify-between gap-2']">
              <DoubleCheckButton variant="danger" size="sm" :disabled="roomSaving" @confirm="clearRoomScript">
                {{ t('settings.pages.group-scripts.actions.clear-room') }}
                <template #confirm>
                  {{ t('settings.pages.group-scripts.actions.confirm-clear-room') }}
                </template>
                <template #cancel>
                  {{ t('settings.pages.group-scripts.actions.cancel') }}
                </template>
              </DoubleCheckButton>
              <Button icon="i-solar:diskette-bold" :loading="roomSaving" :label="t('settings.pages.group-scripts.actions.save-room')" @click="saveRoomScript" />
            </div>
          </template>
        </section>
      </main>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.group-scripts.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.group-scripts.description
  icon: i-solar:clapperboard-play-bold-duotone
  settingsEntry: true
  order: 5.25
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>

<style scoped>
.group-script-control {
  border: 1px solid color-mix(in srgb, var(--airi-border-accent) 72%, var(--airi-border-subtle));
  background: color-mix(in srgb, var(--airi-surface-panel) 88%, transparent);
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.group-script-control:hover {
  border-color: var(--airi-accent-text);
}

.group-script-control:focus,
.group-script-control:focus-within {
  border-color: var(--airi-accent-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--airi-accent-strong) 18%, transparent);
  outline: none;
}

.group-script-fold > summary::-webkit-details-marker {
  display: none;
}

.group-script-fold > summary::marker {
  display: none;
}
</style>
