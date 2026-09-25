<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import CharacterAvatarImage from './avatar-image.vue'

const props = defineProps<{
  avatarUrl?: string | null
  avatarModelId?: string
  label: string
}>()

const imageFailed = ref(false)
const initial = computed(() => (props.label.trim().slice(0, 1) || '?').toUpperCase())

watch(() => props.avatarUrl, () => {
  imageFailed.value = false
})
</script>

<template>
  <span
    role="img"
    :aria-label="label"
    :title="label"
    :class="[
      'grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border text-xs font-semibold',
      'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] text-[var(--airi-text)]',
    ]"
  >
    <CharacterAvatarImage
      v-if="avatarUrl && !imageFailed"
      :src="avatarUrl"
      :model-id="avatarModelId"
      class="size-full"
      @error="imageFailed = true"
    />
    <span v-else aria-hidden="true">{{ initial }}</span>
  </span>
</template>
