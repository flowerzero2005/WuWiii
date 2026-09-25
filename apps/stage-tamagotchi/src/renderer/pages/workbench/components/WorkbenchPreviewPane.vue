<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { getWorkbenchBrowserPreviewKind } from '../../../modules/workbench-file-editor'

const props = defineProps<{
  title: string
  url?: string
}>()

const { t } = useI18n()
const refreshKey = ref(0)
const mediaLoadFailed = ref(false)

const safeUrl = computed(() => {
  const url = props.url?.trim()
  if (!url)
    return undefined

  return url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')
    ? url
    : undefined
})
const previewKind = computed(() => safeUrl.value ? getWorkbenchBrowserPreviewKind(safeUrl.value) : undefined)

watch(safeUrl, () => {
  mediaLoadFailed.value = false
})

function refresh() {
  mediaLoadFailed.value = false
  refreshKey.value += 1
}

function openExternal() {
  if (!safeUrl.value)
    return

  window.open(safeUrl.value, '_blank', 'noopener')
}
</script>

<template>
  <section :class="['flex h-full min-h-80 flex-col gap-2']">
    <div :class="['flex items-center justify-between gap-2']">
      <div :class="['min-w-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase airi-text-muted']">
        <span :class="['i-solar:monitor-smartphone-bold-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ props.title }}</span>
      </div>
      <div :class="['shrink-0 inline-flex items-center gap-1']">
        <button
          :class="[
            'size-7 rounded-md airi-control-muted',
            'grid place-items-center disabled:cursor-not-allowed disabled:opacity-50',
          ]"
          :disabled="!safeUrl"
          :title="t('tamagotchi.stage.workbench.actions.refresh-preview')"
          @click="refresh"
        >
          <span :class="['i-lucide:refresh-cw size-3.5']" />
        </button>
        <button
          :class="[
            'size-7 rounded-md airi-control-muted',
            'grid place-items-center disabled:cursor-not-allowed disabled:opacity-50',
          ]"
          :disabled="!safeUrl"
          :title="t('tamagotchi.stage.workbench.actions.open-preview-external')"
          @click="openExternal"
        >
          <span :class="['i-lucide:external-link size-3.5']" />
        </button>
      </div>
    </div>

    <div
      v-if="!safeUrl"
      :class="[
        'grid min-h-72 flex-1 place-items-center rounded-md border border-dashed airi-border-subtle px-4 py-8',
        'airi-text-muted',
      ]"
    >
      <div :class="['max-w-sm text-center']">
        <div :class="['mx-auto mb-3 grid size-10 place-items-center rounded-md bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300']">
          <span :class="['i-solar:monitor-smartphone-bold-duotone size-5']" />
        </div>
        <div :class="['text-sm font-semibold airi-text']">
          {{ t('tamagotchi.stage.workbench.static-preview.empty-title') }}
        </div>
        <div :class="['mt-1 text-xs leading-5']">
          {{ t('tamagotchi.stage.workbench.static-preview.empty-description') }}
        </div>
      </div>
    </div>

    <div
      v-else-if="mediaLoadFailed"
      :class="['grid min-h-72 flex-1 place-items-center rounded-md border border-dashed airi-border-subtle px-4 py-8 airi-text-muted']"
    >
      <div :class="['max-w-sm text-center']">
        <span :class="['i-solar:file-corrupted-bold-duotone mx-auto mb-3 block size-8']" />
        <div :class="['text-sm font-semibold airi-text']">
          {{ t('tamagotchi.stage.workbench.static-preview.load-failed-title') }}
        </div>
        <div :class="['mt-1 text-xs leading-5']">
          {{ t('tamagotchi.stage.workbench.static-preview.load-failed-description') }}
        </div>
      </div>
    </div>

    <img
      v-else-if="previewKind === 'image'"
      :key="`${safeUrl}:${refreshKey}`"
      :alt="props.title"
      :class="['min-h-0 flex-1 object-contain rounded-md border airi-border-subtle bg-white']"
      :src="safeUrl"
      @error="mediaLoadFailed = true"
    >

    <div
      v-else-if="previewKind === 'audio'"
      :class="['grid min-h-72 flex-1 place-items-center rounded-md border airi-border-subtle bg-neutral-50 px-5 dark:bg-neutral-900']"
    >
      <audio
        :key="`${safeUrl}:${refreshKey}`"
        :class="['w-full max-w-xl']"
        :src="safeUrl"
        controls
        @error="mediaLoadFailed = true"
      />
    </div>

    <video
      v-else-if="previewKind === 'video'"
      :key="`${safeUrl}:${refreshKey}`"
      :class="['min-h-0 flex-1 rounded-md border airi-border-subtle bg-black object-contain']"
      :src="safeUrl"
      controls
      @error="mediaLoadFailed = true"
    />

    <iframe
      v-else
      :key="`${safeUrl}:${refreshKey}`"
      :class="['min-h-72 flex-1 rounded-md border airi-border-subtle bg-white']"
      :src="safeUrl"
      sandbox="allow-scripts allow-forms allow-pointer-lock"
      @error="mediaLoadFailed = true"
    />
  </section>
</template>
