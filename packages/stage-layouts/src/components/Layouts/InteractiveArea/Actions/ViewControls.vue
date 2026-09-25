<script lang="ts" setup>
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'

const emits = defineEmits<{
  (e: 'reset'): void
}>()

const { stageModelRenderer, stageViewControlsEnabled } = storeToRefs(useSettings())

const mode = defineModel<'x' | 'y' | 'z' | 'scale'>({ required: true })

function modeButtonClass(targetMode: 'x' | 'y' | 'z' | 'scale') {
  return [
    'h-9 w-full rounded-xl px-3 text-sm font-medium',
    'airi-overlay-glass airi-overlay-control',
    mode.value === targetMode
      ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)] ring-2 ring-[var(--airi-accent-focus)]'
      : 'airi-text-muted',
  ]
}

function handleViewControlsToggle(targetMode: 'x' | 'y' | 'z' | 'scale') {
  if (mode.value === targetMode) {
    emits('reset')
    return
  }

  mode.value = targetMode
}
</script>

<template>
  <div w-full flex flex-1 items-center self-end justify-end gap-2>
    <Transition name="fade">
      <div v-if="stageViewControlsEnabled" w-full flex justify-between gap-2>
        <button type="button" :class="modeButtonClass('x')" @click="handleViewControlsToggle('x')">
          X
        </button>
        <button type="button" :class="modeButtonClass('y')" @click="handleViewControlsToggle('y')">
          Y
        </button>
        <button v-if="stageModelRenderer === 'vrm'" type="button" :class="modeButtonClass('z')" @click="handleViewControlsToggle('z')">
          Z
        </button>
        <button type="button" :class="modeButtonClass('scale')" @click="handleViewControlsToggle('scale')">
          Scale
        </button>
      </div>
    </Transition>
    <button
      :class="[
        'w-fit flex items-center self-end justify-center justify-self-end rounded-xl p-2',
        'airi-overlay-glass airi-overlay-control',
      ]"
      title="View"
      @click="stageViewControlsEnabled = !stageViewControlsEnabled"
    >
      <Transition name="fade" mode="out-in">
        <div v-if="!stageViewControlsEnabled" class="i-solar:tuning-outline size-5 airi-text-muted" />
        <div v-else class="i-solar:alt-arrow-right-outline size-5 airi-text-muted" />
      </Transition>
    </button>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}
</style>
