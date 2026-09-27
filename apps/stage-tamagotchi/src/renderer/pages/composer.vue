<script setup lang="ts">
import type { ComposerToolbarAction, ComposerToolbarState } from '../../shared/detached-composer-toolbar'

import { useVisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useVisionStore, VISION_MAX_IMAGES } from '@proj-airi/stage-ui/stores/modules/vision'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { BasicTextarea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import DetachedComposerToolbar from '../components/detached-composer-toolbar.vue'

import { validateComposerDraft } from '../../shared/detached-composer'
import { useDetachedComposerEditor } from '../composables/use-detached-composer-editor'
import { getVisionScreenCaptureErrorKey } from '../modules/vision-screen-capture'

const { t } = useI18n()
const key = 'stage.chat.composer'
const editor = useDetachedComposerEditor(t)
const { state, draft, dirty, closing, error, busy, dragOverReturnTarget, flush, send: submitDraft, close } = editor
const discardConfirmation = ref(false)
const visionStore = useVisionStore()
const { enabled: visionEnabled, provider: visionProvider } = storeToRefs(visionStore)
const { user: authUser } = storeToRefs(useAuthStore())
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const officialPricingStore = useOfficialPricingStore()
const { error: visionPricingError } = storeToRefs(officialPricingStore)
officialPricingStore.start()
const imageInputRef = ref<HTMLInputElement>()
const expandedImage = ref<string>()
const toolbarPending = ref<{ action: ComposerToolbarAction, requestId?: string }>()
const toolbarState = ref<ComposerToolbarState>()
const toolbarError = ref('')
const screenCapture = useVisionScreenCapture()
const screenPickerOpen = ref(false)
const screenSources = ref<ReturnType<NonNullable<typeof screenCapture>['listSources']> extends Promise<infer Sources> ? Sources : never>([])
const selectedScreenSourceId = ref('')
const screenCaptureLoading = ref(false)
const screenCaptureError = ref('')
let screenPickerRevision = 0
const visionQuote = computed(() => officialCapabilityConsentStore.getQuote('vision'))
const visionConsentPending = computed(() => draft.value.images.length > 0 && visionProvider.value === 'official-cloud' && !!visionQuote.value
  && officialCapabilityConsentStore.needsConsent(authUser.value?.id, 'vision', visionQuote.value))
const visionQuoteLoading = computed(() => draft.value.images.length > 0 && visionProvider.value === 'official-cloud' && !visionQuote.value && !visionPricingError.value)
const visionQuoteUnavailable = computed(() => draft.value.images.length > 0 && visionProvider.value === 'official-cloud' && !visionQuote.value && !!visionPricingError.value)

function addImages(event: Event) {
  if (!visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void editor.addImages(files)
}

function addPastedImages(files: File[]) {
  if (!visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  void editor.addImages(files)
}

function openImagePicker() {
  if (!visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  imageInputRef.value?.click()
}

const selectedScreenSource = computed(() => screenSources.value.find(source => source.id === selectedScreenSourceId.value))

function closeScreenPicker() {
  screenPickerRevision += 1
  screenPickerOpen.value = false
  screenSources.value = []
  selectedScreenSourceId.value = ''
  screenCaptureLoading.value = false
}

function screenCaptureFailure(cause: unknown) {
  return t(`stage.chat.vision.${getVisionScreenCaptureErrorKey(cause)}`)
}

async function refreshScreenSources(revision: number) {
  if (!screenCapture)
    return
  screenCaptureLoading.value = true
  try {
    const sources = await screenCapture.listSources()
    if (revision !== screenPickerRevision)
      return
    screenSources.value = sources
    if (!sources.some(source => source.id === selectedScreenSourceId.value))
      selectedScreenSourceId.value = ''
  }
  catch (cause) {
    if (revision === screenPickerRevision)
      screenCaptureError.value = screenCaptureFailure(cause)
  }
  finally {
    if (revision === screenPickerRevision)
      screenCaptureLoading.value = false
  }
}

async function openScreenPicker() {
  if (!visionEnabled.value || !screenCapture || !state.value || state.value.scope.group || busy.value)
    return
  closeScreenPicker()
  const revision = screenPickerRevision
  screenPickerOpen.value = true
  screenCaptureError.value = ''
  await refreshScreenSources(revision)
}

async function attachSelectedScreen() {
  if (!screenCapture || !selectedScreenSource.value || !state.value || busy.value)
    return
  if (draft.value.images.length >= VISION_MAX_IMAGES) {
    screenCaptureError.value = t('stage.chat.vision.image-limit', { count: VISION_MAX_IMAGES })
    return
  }
  const revision = screenPickerRevision
  screenCaptureLoading.value = true
  try {
    const image = await screenCapture.capture(selectedScreenSource.value.id)
    if (revision !== screenPickerRevision || !state.value || state.value.scope.group)
      return
    draft.value = validateComposerDraft({
      text: draft.value.text,
      images: [...draft.value.images, { id: crypto.randomUUID(), mimeType: image.mimeType, data: image.data }],
    }, false)
    closeScreenPicker()
  }
  catch (cause) {
    if (revision === screenPickerRevision) {
      // A source can vanish between listing and capture. Keep the picker open,
      // clear the stale selection, and ask the user to choose from a fresh list.
      selectedScreenSourceId.value = ''
      screenCaptureError.value = screenCaptureFailure(cause)
      await refreshScreenSources(revision)
    }
  }
  finally {
    if (revision === screenPickerRevision)
      screenCaptureLoading.value = false
  }
}

function applySourceActionStatus(status: { error?: string, requestId: string, state?: ComposerToolbarState }) {
  if (status.state)
    toolbarState.value = status.state
  if (toolbarPending.value?.requestId !== status.requestId)
    return
  toolbarPending.value = undefined
  toolbarError.value = status.error ?? ''
  if (status.error)
    toast.error(status.error)
}

async function handleToolbarAction(action: ComposerToolbarAction) {
  if (toolbarPending.value || busy.value)
    return
  if (action === 'open-image-picker') {
    openImagePicker()
    return
  }
  if (action === 'capture-screen') {
    await openScreenPicker()
    return
  }
  const sourceAction = {
    'toggle-speech-output': 'toggle-speech-output',
    'toggle-dictation': 'toggle-microphone',
    'toggle-voice-call': 'toggle-voice-call',
    'toggle-web-search': 'toggle-web-search',
    'toggle-inner-voice': 'toggle-inner-voice',
    'toggle-floating-replies': 'toggle-floating-replies',
    'interrupt': 'interrupt',
    'open-settings': 'open-speech-settings',
  } as const
  toolbarError.value = ''
  toolbarPending.value = { action }
  const requestId = await editor.requestAction(sourceAction[action])
  if (!toolbarPending.value || toolbarPending.value.action !== action)
    return
  if (!requestId) {
    toolbarPending.value = undefined
    toolbarError.value = t(`${key}.sync-failed`)
    return
  }
  toolbarPending.value.requestId = requestId
  for (const status of Object.values(editor.actionState.value)) {
    if (status?.requestId === requestId) {
      applySourceActionStatus(status)
    }
  }
}

watch(editor.actionState, (statuses) => {
  for (const status of Object.values(statuses)) {
    if (status) {
      applySourceActionStatus(status)
    }
  }
}, { deep: true })

watch(editor.actionError, (errors) => {
  const pending = toolbarPending.value
  if (!pending?.requestId)
    return
  const message = Object.entries(errors).find(([key, value]) => key.endsWith(`:${pending.requestId}`) && value)?.[1]
  if (!message)
    return
  toolbarPending.value = undefined
  toolbarError.value = message
  toast.error(message)
}, { deep: true })

async function send() {
  if (draft.value.images.length && !visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  await submitDraft()
}

function refreshToolbarState() {
  void editor.requestAction('get-toolbar-state')
}

onMounted(async () => {
  await editor.initialize()
  refreshToolbarState()
  window.addEventListener('focus', refreshToolbarState)
})
onUnmounted(() => {
  window.removeEventListener('focus', refreshToolbarState)
  closeScreenPicker()
  officialPricingStore.stop()
})
</script>

<template>
  <main class="composer-page min-h-0 flex flex-col h-dvh">
    <header class="composer-drag-rail flex shrink-0 items-center justify-between gap-2 px-3">
      <div
        :title="t(`${key}.drag-return`)"
        :class="['[-webkit-app-region:no-drag] flex min-w-0 touch-none select-none items-center gap-2 cursor-grab', editor.dragging.value ? 'opacity-60' : '']"
        @pointerdown="editor.startDrag"
      >
        <span class="composer-grab i-lucide:grip-horizontal size-4 shrink-0" />
        <span class="composer-drag-label truncate text-[11px]">{{ t(`${key}.drag-return`) }}</span>
      </div>
      <button
        type="button"
        :disabled="!!state?.busy || closing"
        :title="t(`${key}.return`)"
        :aria-label="t(`${key}.return`)"
        class="[-webkit-app-region:no-drag] grid size-7 shrink-0 place-items-center rounded-full airi-overlay-control-muted disabled:cursor-not-allowed disabled:opacity-50"
        @click="close"
      >
        <span class="i-lucide:arrow-down-to-line size-3.5" />
      </button>
    </header>

    <p
      v-if="editor.dragging.value"
      :class="['composer-drag-status absolute left-1/2 top-8 z-10 m-0 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] shadow-sm', dragOverReturnTarget ? 'text-[var(--airi-accent-text)]' : 'airi-text-muted']"
    >
      {{ t(dragOverReturnTarget ? `${key}.return-ready` : `${key}.drag-return`) }}
    </p>

    <p v-if="state?.status === 'orphaned'" class="mx-1 mb-2 mt-0 text-xs airi-text-muted">
      {{ t(`${key}.orphaned`) }}
    </p>
    <p v-if="state?.busy" role="status" class="composer-notice mx-1 mb-2 mt-0 rounded-lg px-3 py-2 text-xs text-amber-600">
      {{ t(`${key}.wait-send`) }}
    </p>
    <p v-if="state?.uncertain" role="alert" class="composer-notice mx-1 mb-2 mt-0 rounded-lg px-3 py-2 text-xs text-amber-600">
      {{ t(`${key}.uncertain`) }}
      <button type="button" :disabled="closing" class="ml-2 underline" @click="discardConfirmation = true">
        {{ t(`${key}.discard`) }}
      </button>
    </p>
    <div v-if="discardConfirmation" role="alert" class="composer-notice mx-1 mb-2 rounded-lg px-3 py-2 text-xs text-amber-600">
      <p>{{ t(`${key}.discard-confirm`) }}</p>
      <div class="mt-2 flex gap-2">
        <button type="button" :disabled="closing" class="h-8 airi-overlay-control-primary rounded-md px-2.5 text-xs font-medium disabled:opacity-50" @click="editor.discard()">
          {{ t(`${key}.discard`) }}
        </button>
        <button type="button" :disabled="closing" class="h-8 rounded-md airi-overlay-control-muted px-2.5 text-xs font-medium disabled:opacity-50" @click="discardConfirmation = false">
          {{ t(`${key}.cancel-discard`) }}
        </button>
      </div>
    </div>

    <section class="composer-card mx-2 mb-2 min-h-0 flex flex-1 flex-col border rounded-[18px] p-2.5">
      <div v-if="draft.images.length" class="mb-1.5 max-h-12 flex gap-1.5 overflow-x-auto overflow-y-hidden px-0.5 pt-0.5">
        <div v-for="(image, index) in draft.images" :key="image.id" class="relative shrink-0">
          <button type="button" :aria-label="t(`${key}.image`)" class="size-10 cursor-zoom-in rounded-md" @click="expandedImage = `data:${image.mimeType};base64,${image.data}`">
            <img :src="`data:${image.mimeType};base64,${image.data}`" :alt="t(`${key}.image`)" class="size-full rounded-md object-cover">
          </button>
          <button type="button" :disabled="busy" :aria-label="t(`${key}.remove-image`)" class="absolute right-0 top-0 grid size-4 place-items-center rounded-full bg-red-500 text-white shadow-sm disabled:opacity-50" @click="draft.images.splice(index, 1)">
            <span class="i-lucide:x size-2.5" />
          </button>
        </div>
      </div>
      <p v-if="draft.images.length" class="mb-2 px-1 text-xs airi-text-muted">
        {{ t(`${key}.description`) }}
      </p>
      <p v-if="visionConsentPending" class="mb-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        {{ t(`${key}.fee-confirm-in-source`) }}
      </p>
      <p v-else-if="visionQuoteLoading" class="mb-2 px-1 text-xs airi-text-muted">
        {{ t(`${key}.fee-quote-loading`) }}
      </p>
      <p v-else-if="visionQuoteUnavailable" class="mb-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        {{ t(`${key}.fee-quote-unavailable`) }}
      </p>

      <div class="composer-input-area relative min-h-0 flex-1">
        <BasicTextarea
          v-model="draft.text"
          :auto-resize="false"
          :readonly="!!state?.uncertain"
          :disabled="!state || !!state.busy || closing"
          :placeholder="t('stage.chat.composer.placeholder')"
          class="composer-textarea h-full min-h-0 w-full resize-none overflow-y-auto airi-overlay-input rounded-xl py-2.5 pl-3 pr-12 text-sm font-medium"
          @keydown.ctrl.enter.prevent="send"
          @paste-file="addPastedImages"
        />
        <input ref="imageInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden" @change="addImages">
        <button
          type="button"
          :title="t('stage.actions.send')"
          :aria-label="t('stage.actions.send')"
          :disabled="!state || state.status !== 'detached' || busy || (!draft.text.trim() && !draft.images.length)"
          :class="['absolute bottom-2 right-2 grid size-8 place-items-center rounded-lg text-base outline-none transition-all active:scale-95 disabled:cursor-not-allowed', !state || state.status !== 'detached' || busy || (!draft.text.trim() && !draft.images.length) ? 'bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-soft)] opacity-55' : 'airi-overlay-control-primary']"
          @click="send"
        >
          <span class="i-solar:arrow-up-linear size-4" />
        </button>
      </div>

      <footer class="composer-toolbar mt-2 min-h-8 shrink-0 overflow-x-auto px-0.5">
        <DetachedComposerToolbar
          v-if="state?.status === 'detached' && toolbarState"
          :state="toolbarState"
          :pending="toolbarPending?.action"
          @action="handleToolbarAction"
        />
        <span v-if="toolbarError" class="text-red-500" role="alert">{{ toolbarError }}</span>
      </footer>
    </section>

    <button
      v-if="expandedImage"
      type="button"
      class="fixed inset-0 z-100 grid cursor-zoom-out place-items-center bg-black/70 p-6"
      :aria-label="t('stage.actions.cancel')"
      @click="expandedImage = undefined"
    >
      <img :src="expandedImage" :alt="t(`${key}.image`)" class="max-h-full max-w-full rounded-xl object-contain shadow-2xl">
    </button>

    <AlertDialogRoot :open="screenPickerOpen" @update:open="open => !open && closeScreenPicker()">
      <AlertDialogPortal>
        <AlertDialogOverlay class="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm" />
        <AlertDialogContent class="fixed left-1/2 top-1/2 z-101 max-h-[85vh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto border border-[var(--airi-border-subtle)] rounded-xl bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none -translate-x-1/2 -translate-y-1/2">
          <AlertDialogTitle class="text-base text-[var(--airi-text)] font-semibold">
            {{ t('stage.chat.vision.screen-capture') }}
          </AlertDialogTitle>
          <AlertDialogDescription class="mt-2 text-sm text-[var(--airi-text-muted)]">
            {{ t('stage.chat.vision.screen-select') }}
          </AlertDialogDescription>
          <p v-if="screenCaptureError" class="mt-3 text-sm text-red-500" role="alert">
            {{ screenCaptureError }}
          </p>
          <p v-if="screenCaptureLoading" class="mt-3 text-sm text-[var(--airi-text-muted)]" role="status">
            {{ t('stage.chat.vision.screen-loading') }}
          </p>
          <p v-else-if="!screenSources.length && !screenCaptureError" class="mt-3 text-sm text-[var(--airi-text-muted)]">
            {{ t('stage.chat.vision.screen-no-sources') }}
          </p>
          <div class="grid grid-cols-2 mt-3 gap-2">
            <button
              v-for="source in screenSources"
              :key="source.id"
              type="button"
              :aria-pressed="selectedScreenSourceId === source.id"
              :disabled="screenCaptureLoading"
              :class="['min-w-0 rounded-lg border p-2 text-left', selectedScreenSourceId === source.id ? 'border-[var(--airi-accent)] airi-overlay-control-primary' : 'border-[var(--airi-border-subtle)] airi-overlay-control-muted']"
              @click="selectedScreenSourceId = source.id"
            >
              <img v-if="source.previewDataUrl" :src="source.previewDataUrl" :alt="source.name" class="aspect-video w-full object-contain">
              <span class="mt-1 block truncate text-xs">{{ source.name }}</span>
            </button>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <AlertDialogCancel class="h-9 rounded-md airi-overlay-control-muted px-3 text-sm" @click="closeScreenPicker">
              {{ t('stage.actions.cancel') }}
            </AlertDialogCancel>
            <button type="button" :disabled="!selectedScreenSource || screenCaptureLoading" class="h-9 airi-overlay-control-primary rounded-md px-3 text-sm disabled:opacity-50" @click="attachSelectedScreen">
              {{ t('stage.chat.vision.screen-attach') }}
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>

    <p v-if="error" role="alert" class="m-2 text-xs text-red-500">
      {{ error }}<button v-if="dirty && !state?.busy" type="button" class="ml-2 underline" @click="flush().catch(() => undefined)">
        {{ t(`${key}.retry-sync`) }}
      </button>
    </p>
  </main>
</template>

<style scoped>
.composer-page {
  --airi-chat-field-surface: color-mix(in srgb, var(--airi-surface-field-base, var(--airi-surface-field)) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  padding-top: 0.25rem;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--airi-accent) 18%, transparent), transparent 34%),
    radial-gradient(circle at 92% 100%, color-mix(in srgb, var(--airi-accent-soft) 30%, transparent), transparent 40%),
    color-mix(in srgb, var(--airi-surface-base, var(--airi-surface-panel)) 92%, transparent);
}

.composer-drag-rail {
  height: 1.7rem;
  color: var(--airi-text-muted);
}

.composer-grab {
  color: color-mix(in srgb, var(--airi-accent) 58%, var(--airi-text-soft));
}

.composer-drag-label {
  max-width: 15rem;
  letter-spacing: 0.01em;
}

.composer-card {
  position: relative;
  overflow: hidden;
  border-color: var(--airi-border-subtle);
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  box-shadow: 0 16px 36px rgb(15 23 42 / 0.13);
  backdrop-filter: blur(18px) saturate(1.08);
}

.composer-card::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background: linear-gradient(135deg, color-mix(in srgb, var(--airi-accent-soft) 12%, transparent), transparent 34%);
}

.composer-card > * {
  position: relative;
}

.composer-textarea {
  background: var(--airi-chat-field-surface);
}

.composer-input-area :deep(textarea) {
  min-height: 0;
}

.composer-toolbar :deep(.detached-composer-toolbar) {
  flex-wrap: nowrap;
  min-width: max-content;
}

.composer-notice {
  background: color-mix(in srgb, #f59e0b 10%, var(--airi-surface-card-base));
}

.composer-drag-status {
  background: color-mix(in srgb, var(--airi-accent) 12%, var(--airi-surface-card-base));
}

.dark .composer-card {
  box-shadow: 0 16px 36px rgb(0 0 0 / 0.28);
}
</style>
