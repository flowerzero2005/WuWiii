<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { createAvatarFramingStyle, useAvatarFramingSettingsStore } from '../../../stores/settings/avatar-framing'

const props = defineProps<{
  alt?: string
  modelId?: string
  src?: string | null
}>()

const emit = defineEmits<{
  (event: 'error'): void
}>()

const framingStore = useAvatarFramingSettingsStore()
const imageFailed = ref(false)
const imageStyle = computed(() => props.modelId
  ? createAvatarFramingStyle(framingStore.getFraming(props.modelId))
  : {
      height: '100%',
      inset: '0',
      objectFit: 'cover' as const,
      position: 'absolute' as const,
      width: '100%',
    })

watch(() => props.src, () => {
  imageFailed.value = false
})

function handleError() {
  imageFailed.value = true
  emit('error')
}
</script>

<template>
  <span :class="['relative block overflow-hidden']">
    <img
      v-if="src && !imageFailed"
      :src="src"
      :alt="alt ?? ''"
      :style="imageStyle"
      draggable="false"
      @error="handleError"
    >
    <slot v-else />
  </span>
</template>
