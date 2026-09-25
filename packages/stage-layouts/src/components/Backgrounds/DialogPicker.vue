<script setup lang="ts">
import { BackgroundPickerDialog } from '@proj-airi/stage-ui/components'
import { storeToRefs } from 'pinia'

import { useBackgroundStore } from '../../stores/background'

const props = withDefaults(defineProps<{
  mode?: 'active' | 'dark' | 'light'
}>(), {
  mode: 'active',
})
const show = defineModel<boolean>({ default: false })
const backgroundStore = useBackgroundStore()
const { darkSelectedOption, lightSelectedOption, options, selectedOption } = storeToRefs(backgroundStore)
</script>

<template>
  <BackgroundPickerDialog
    v-model="show"
    :selected="props.mode === 'dark' ? darkSelectedOption : props.mode === 'light' ? lightSelectedOption : selectedOption"
    :options="options"
    @apply="props.mode === 'dark' ? backgroundStore.applyDarkPickerSelection($event) : props.mode === 'light' ? backgroundStore.applyLightPickerSelection($event) : backgroundStore.applyPickerSelection($event)"
    @remove="option => backgroundStore.removeOption(option.id)"
  />
</template>
