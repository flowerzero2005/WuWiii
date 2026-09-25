<script setup lang="ts">
import type { BackgroundOption } from './types'

import { useMediaQuery, useResizeObserver, useScreenSafeArea } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, VisuallyHidden } from 'reka-ui'
import { DrawerContent, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot } from 'vaul-vue'
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import BackgroundPicker from './background-picker.vue'

const props = defineProps<{
  options: BackgroundOption[]
}>()
const emit = defineEmits<{
  (e: 'apply', payload: { option: BackgroundOption, color?: string }): void
  (e: 'remove', option: BackgroundOption): void
}>()
const showDialog = defineModel({ type: Boolean, default: false, required: false })
const selected = defineModel<BackgroundOption | undefined>('selected', { default: undefined })

const isDesktop = useMediaQuery('(min-width: 768px)')
const screenSafeArea = useScreenSafeArea()
const { t } = useI18n()

useResizeObserver(document.documentElement, () => screenSafeArea.update())
onMounted(() => screenSafeArea.update())
</script>

<template>
  <DialogRoot v-if="isDesktop" :open="showDialog" @update:open="value => showDialog = value">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] max-h-[85vh] max-w-5xl w-[92dvw]',
          'airi-surface-panel flex flex-col rounded-2xl p-6 shadow-xl outline-none backdrop-blur-md',
          'transform overflow-hidden -translate-x-1/2 -translate-y-1/2',
          'data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow',
        ]"
      >
        <VisuallyHidden>
          <DialogTitle>{{ t('settings.pages.system.sections.section.background.picker.title') }}</DialogTitle>
        </VisuallyHidden>
        <BackgroundPicker
          v-model="selected"
          :options="props.options"
          allow-upload
          class="min-h-0 flex-1"
          @apply="payload => { emit('apply', payload); showDialog = false }"
          @import="payload => emit('apply', payload)"
          @remove="option => emit('remove', option)"
        />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <DrawerRoot v-else :open="showDialog" should-scale-background @update:open="value => showDialog = value">
    <DrawerPortal>
      <DrawerOverlay class="fixed inset-0" />
      <DrawerContent
        :class="[
          'fixed bottom-0 left-0 right-0 z-1000 mt-20 h-full max-h-[85%]',
          'airi-surface-panel flex flex-col rounded-t-2xl px-4 pt-4 outline-none backdrop-blur-md',
        ]"
        :style="{ paddingBottom: `${Math.max(Number.parseFloat(screenSafeArea.bottom.value.replace('px', '')), 24)}px` }"
      >
        <DrawerHandle />
        <BackgroundPicker
          v-model="selected"
          :options="props.options"
          allow-upload
          class="min-h-0 flex-1"
          @apply="payload => { emit('apply', payload); showDialog = false }"
          @import="payload => emit('apply', payload)"
          @remove="option => emit('remove', option)"
        />
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
