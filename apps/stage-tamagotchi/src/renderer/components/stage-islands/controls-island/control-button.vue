<script setup lang="ts">
const props = defineProps<{ buttonStyle?: string }>()
</script>

<template>
  <button
    :class="[
      'border-2 border-solid border-[var(--airi-border-subtle)]',
      'airi-overlay-control-muted',
      'w-fit flex items-center self-end justify-center p-2',
      'rounded-xl backdrop-blur-md',
      'transition-all hover:transition-none transition-duration-300 transition-ease-out',
      props.buttonStyle,
    ]"
  >
    <slot />
  </button>
</template>
