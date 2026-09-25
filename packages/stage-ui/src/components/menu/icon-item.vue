<script setup lang="ts">
defineProps<{
  title: string
  description: string
  icon?: string
  iconTemplate?: boolean
  to: string
}>()
</script>

<template>
  <RouterLink
    :class="[
      'menu-icon-item',
      'relative min-h-20 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-md p-4 text-left',
      'box-border flex flex-row transition-colors duration-200 ease-out',
      'border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)]',
      'before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r before:bg-[var(--airi-accent-strong)] before:content-[\'\'] before:opacity-0 before:transition-opacity',
      'hover:border-[var(--airi-border-accent)] hover:bg-[var(--airi-surface-control-hover)] hover:before:opacity-80',
      'focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
    ]"
    :to="to"
  >
    <div
      v-if="typeof icon === 'string'"
      :class="['size-10 shrink-0 grid place-items-center rounded-md bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]']"
    >
      <div :class="[icon, 'size-5']" />
    </div>
    <template v-if="iconTemplate">
      <slot name="icon" />
    </template>
    <div :class="['z-1 min-w-0 flex-1']">
      <div :class="['menu-icon-item-title text-base font-medium']">
        {{ title }}
      </div>
      <div
        :class="[
          'menu-icon-item-description',
          'mt-0.5 line-clamp-2 text-sm airi-text-muted',
        ]"
      >
        <span>{{ description }}</span>
      </div>
    </div>
    <div :class="['i-solar:alt-arrow-right-linear size-4 shrink-0 text-[var(--airi-text-soft)]']" />
  </RouterLink>
</template>
