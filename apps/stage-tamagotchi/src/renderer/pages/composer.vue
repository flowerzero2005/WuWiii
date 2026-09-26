<script setup lang="ts">
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { BasicTextarea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useDetachedComposerEditor } from '../composables/use-detached-composer-editor'

const { t } = useI18n()
const key = 'stage.chat.composer'
const editor = useDetachedComposerEditor(t)
const { state, draft, dirty, syncing, closing, error, busy, dragOverReturnTarget, flush, send: submitDraft, close } = editor
const discardConfirmation = ref(false)
const visionStore = useVisionStore()
const { enabled: visionEnabled, provider: visionProvider } = storeToRefs(visionStore)
const { user: authUser } = storeToRefs(useAuthStore())
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const officialPricingStore = useOfficialPricingStore()
const { error: visionPricingError } = storeToRefs(officialPricingStore)
officialPricingStore.start()
const imageInputRef = ref<HTMLInputElement>()
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

async function send() {
  if (draft.value.images.length && !visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  await submitDraft()
}

onMounted(editor.initialize)
onUnmounted(() => officialPricingStore.stop())
</script>

<template>
  <main class="composer-page min-h-0 flex flex-col p-3 h-dvh">
    <header class="composer-header flex shrink-0 items-center justify-between gap-3 border rounded-xl px-3 py-2">
      <div
        :title="t(`${key}.drag-return`)"
        :class="['[-webkit-app-region:no-drag] flex min-w-0 touch-none select-none items-center gap-2 cursor-grab', editor.dragging.value ? 'opacity-60' : '']"
        @pointerdown="editor.startDrag"
      >
        <span class="i-lucide:grab size-4 shrink-0 text-[var(--airi-text-soft)]" />
        <div class="min-w-0">
          <h1 class="m-0 truncate text-sm airi-text font-semibold">
            {{ t(`${key}.title`) }}
          </h1>
          <p class="m-0 truncate text-xs airi-text-muted">
            {{ t(`${key}.description`) }}
          </p>
        </div>
      </div>
      <button
        type="button"
        :disabled="!!state?.busy || closing"
        class="[-webkit-app-region:no-drag] h-8 shrink-0 rounded-md airi-overlay-control-muted px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        @click="close"
      >
        {{ t(`${key}.return`) }}
      </button>
    </header>

    <p
      v-if="editor.dragging.value"
      :class="['composer-drag-status mx-1 mb-2 mt-0 rounded-lg px-3 py-2 text-xs', dragOverReturnTarget ? 'text-[var(--airi-accent-text)]' : 'airi-text-muted']"
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

    <section class="composer-card mt-3 min-h-0 flex flex-1 flex-col border rounded-xl p-3">
      <div v-if="draft.images.length" class="mb-2 max-h-18 flex gap-2 overflow-x-auto overflow-y-hidden px-1 pt-1">
        <div v-for="(image, index) in draft.images" :key="image.id" class="relative shrink-0">
          <img :src="`data:${image.mimeType};base64,${image.data}`" :alt="t(`${key}.image`)" class="size-15 rounded-md object-cover">
          <button type="button" :disabled="busy" :aria-label="t(`${key}.remove-image`)" class="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-red-500 text-white shadow-sm disabled:opacity-50" @click="draft.images.splice(index, 1)">
            <span class="i-lucide:x size-3" />
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

      <div class="relative min-h-36 flex-1">
        <BasicTextarea
          v-model="draft.text"
          :auto-resize="false"
          :readonly="!!state?.uncertain"
          :disabled="!state || !!state.busy || closing"
          :placeholder="t('stage.chat.composer.placeholder')"
          class="composer-textarea h-full min-h-36 w-full resize-y overflow-y-auto airi-overlay-input rounded-lg py-3 pl-3 pr-20 font-medium"
          @keydown.ctrl.enter.prevent="send"
          @paste-file="addPastedImages"
        />
        <button
          v-if="!state?.scope.group"
          type="button"
          :title="t(`${key}.add-image`)"
          :aria-label="t(`${key}.add-image`)"
          :disabled="busy || !state"
          :class="['absolute bottom-2 right-11 grid size-8 place-items-center rounded-md airi-overlay-control-muted transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50']"
          @click="openImagePicker"
        >
          <span class="i-lucide:plus size-4" />
        </button>
        <input ref="imageInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden" @change="addImages">
        <button
          type="button"
          :title="t('stage.actions.send')"
          :aria-label="t('stage.actions.send')"
          :disabled="!state || state.status !== 'detached' || busy || (!draft.text.trim() && !draft.images.length)"
          :class="['absolute bottom-2 right-2 grid size-8 place-items-center rounded-md text-base outline-none transition-all active:scale-95 disabled:cursor-not-allowed', !state || state.status !== 'detached' || busy || (!draft.text.trim() && !draft.images.length) ? 'bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-soft)] opacity-55' : 'airi-overlay-control-primary']"
          @click="send"
        >
          <span class="i-solar:arrow-up-linear size-4" />
        </button>
      </div>

      <footer class="mt-2 min-h-4 flex items-center justify-end px-1 text-xs">
        <span class="airi-text-muted">{{ syncing || dirty ? t(`${key}.syncing`) : t(`${key}.synced`) }}</span>
      </footer>
    </section>

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
}

.composer-header {
  border-color: var(--airi-border-subtle);
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  backdrop-filter: blur(18px) saturate(1.08);
}

.composer-card {
  position: relative;
  overflow: hidden;
  border-color: var(--airi-border-subtle);
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  box-shadow: 0 18px 44px rgb(15 23 42 / 0.08);
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

.composer-notice {
  background: color-mix(in srgb, #f59e0b 10%, var(--airi-surface-card-base));
}

.composer-drag-status {
  background: color-mix(in srgb, var(--airi-accent) 12%, var(--airi-surface-card-base));
}

.dark .composer-card {
  box-shadow: 0 18px 44px rgb(0 0 0 / 0.18);
}
</style>
