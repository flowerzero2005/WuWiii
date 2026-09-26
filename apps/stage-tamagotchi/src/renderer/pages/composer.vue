<script setup lang="ts">
import { BasicTextarea, Button } from '@proj-airi/ui'
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDetachedComposerEditor } from '../composables/use-detached-composer-editor'

const { t } = useI18n()
const key = 'stage.chat.composer'
const editor = useDetachedComposerEditor(t)
const { state, draft, dirty, syncing, closing, error, busy, flush, send, close } = editor
function addImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void editor.addImages(files)
}
onMounted(editor.initialize)
</script>

<template>
  <main :class="['airi-surface-panel flex h-dvh min-h-0 flex-col gap-3 p-4']">
    <header :class="['flex items-center justify-between gap-3']">
      <div>
        <h1 :class="['airi-text m-0 text-base font-semibold']">
          {{ t(`${key}.title`) }}
        </h1><p :class="['airi-text-muted m-0 mt-1 text-xs']">
          {{ t(`${key}.description`) }}
        </p>
      </div>
      <Button size="sm" variant="secondary" :disabled="!!state?.busy || closing" :label="t(`${key}.return`)" @click="close" />
    </header>
    <p v-if="state?.status === 'orphaned'" :class="['airi-text-muted m-0 text-xs']">
      {{ t(`${key}.orphaned`) }}
    </p>
    <p v-if="state?.uncertain" role="alert" :class="['m-0 text-xs text-amber-600']">
      {{ t(`${key}.uncertain`) }}
    </p>
    <BasicTextarea v-model="draft.text" :auto-resize="false" :readonly="!!state?.uncertain" :disabled="!state || !!state.busy || closing" :placeholder="t('stage.message')" :class="['airi-overlay-input min-h-0 flex-1 resize-none rounded-xl p-3']" @keydown.ctrl.enter.prevent="send" />
    <div v-if="draft.images.length" :class="['flex gap-2 overflow-x-auto']">
      <div v-for="(image, index) in draft.images" :key="image.id" :class="['relative shrink-0']">
        <img :src="`data:${image.mimeType};base64,${image.data}`" :alt="t(`${key}.image`)" :class="['size-16 rounded-lg object-cover']"><button type="button" :disabled="busy" :aria-label="t(`${key}.remove-image`)" :class="['airi-overlay-control absolute right-0 top-0 rounded p-1']" @click="draft.images.splice(index, 1)">
          ×
        </button>
      </div>
    </div>
    <footer :class="['flex items-center justify-between gap-3 text-xs']">
      <label v-if="!state?.scope.group" :class="['airi-text-muted cursor-pointer']">{{ t(`${key}.add-image`) }}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple :disabled="busy || !state" :class="['hidden']" @change="addImages"></label>
      <span :class="['airi-text-muted']">{{ syncing || dirty ? t(`${key}.syncing`) : t(`${key}.synced`) }}</span>
      <Button :disabled="!state || state.status !== 'detached' || busy || (!draft.text.trim() && !draft.images.length)" :label="t('stage.actions.send')" @click="send" />
    </footer>
    <p v-if="error" role="alert" :class="['m-0 text-xs text-red-500']">
      {{ error }}<button v-if="dirty && !state?.busy" type="button" :class="['ml-2 underline']" @click="flush().catch(() => undefined)">
        {{ t(`${key}.retry-sync`) }}
      </button>
    </p>
  </main>
</template>
