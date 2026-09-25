<script setup lang="ts">
import { Collapsible } from '@proj-airi/ui'
import { ref } from 'vue'

const props = defineProps<{
  title?: string
  initialVisible?: boolean
}>()

const visible = ref(props.initialVisible || false)

function toggleVisible() {
  visible.value = !visible.value
}
</script>

<template>
  <Collapsible w-full>
    <template #trigger="slotProps">
      <button
        :class="[
          'flex w-full items-center gap-1.5 outline-none transition-all duration-250 ease-in-out',
          '[&_.provider-icon]:grayscale-100 [&_.provider-icon]:hover:grayscale-0',
        ]"
        @click="() => slotProps.setVisible(!slotProps.visible) && toggleVisible()"
      >
        <h2 :class="['text-lg airi-text font-semibold md:text-2xl']">
          <span>{{ title || 'Advanced' }}</span>
        </h2>
        <div transform transition="transform duration-250" :class="{ 'rotate-180': slotProps.visible }">
          <div i-solar:alt-arrow-down-linear />
        </div>
      </button>
    </template>
    <div mt-4 space-y-2>
      <slot />
    </div>
  </Collapsible>
</template>
