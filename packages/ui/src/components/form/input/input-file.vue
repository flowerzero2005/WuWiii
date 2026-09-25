<script setup lang="ts">
import BasicInputFile from './basic-input-file.vue'

defineProps<{
  accept?: string
  multiple?: boolean
}>()
</script>

<template>
  <BasicInputFile
    :class="[
      'min-h-[120px] flex flex-col cursor-pointer items-center justify-center rounded-xl p-6',
      'border-dashed border-2',
      'transition-all duration-300',
      'opacity-95',
      'hover:scale-100 hover:opacity-100 hover:shadow-md hover:dark:shadow-lg',
    ]"
    :is-not-dragging-classes="[
      'border-[var(--airi-border-subtle)] hover:border-[var(--airi-border-accent)]',
      'bg-[var(--airi-surface-card)] hover:bg-[var(--airi-surface-control-hover)]',
    ]"
    :is-dragging-classes="[
      'border-[var(--airi-border-accent)] hover:border-[var(--airi-border-accent)]',
      'bg-[var(--airi-accent-surface)]',
    ]"
    :accept="accept"
    :multiple="multiple"
  >
    <template #default="{ isDragging }">
      <slot :is-dragging="isDragging">
        <div
          class="flex flex-col items-center"
          :class="[
            isDragging ? 'text-[var(--airi-accent-text)]' : 'text-[var(--airi-text-muted)]',
          ]"
        >
          <div i-solar:upload-square-line-duotone mb-2 text-5xl />
          <p font-medium text="center lg">
            Upload
          </p>
          <p v-if="isDragging" text="center" text-sm>
            Release to upload
          </p>
          <p v-else text="center" text-sm>
            Click or drag and drop a file here
          </p>
        </div>
      </slot>
    </template>
  </BasicInputFile>
</template>
