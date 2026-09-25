<script setup lang="ts">
import BasicTextarea from './basic-text-area.vue'

const modelValue = defineModel<string>({ default: '' })
</script>

<template>
  <BasicTextarea
    v-model="modelValue"
    :class="[
      'airi-input',
      'cursor-disabled:not-allowed',
      'text-nowrap',
    ]"
  />
</template>
