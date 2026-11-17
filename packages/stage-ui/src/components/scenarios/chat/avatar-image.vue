<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useDisplayModelsStore } from '../../../stores/display-models'
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
const displayModelsStore = useDisplayModelsStore()
const failedSources = ref<string[]>([])
const modelPreview = computed(() => displayModelsStore.displayModels.find(model => model.id === props.modelId)?.previewImage)
const imageSource = computed(() => [props.src, modelPreview.value].find(source => source && !failedSources.value.includes(source)))
const imageStyle = computed(() => props.modelId
  ? createAvatarFramingStyle(framingStore.getFraming(props.modelId))
  : {
      height: '100%',
      inset: '0',
      objectFit: 'cover' as const,
      position: 'absolute' as const,
      width: '100%',
    })

watch([() => props.src, () => props.modelId, modelPreview], () => {
  failedSources.value = []
})

function handleError() {
  const source = imageSource.value
  if (source)
    failedSources.value = [...failedSources.value, source]
  if (!imageSource.value)
    emit('error')
}
</script>

<template>
  <span :class="['relative block overflow-hidden']">
    <img
      v-if="imageSource"
      :src="imageSource"
      :alt="alt ?? ''"
      :style="imageStyle"
      draggable="false"
      @error="handleError"
    >
    <slot v-else />
  </span>
</template>
