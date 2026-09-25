<script setup lang="ts">
defineProps<{
  id: string
  name: string
  value: string
  title: string
  description?: string
}>()

defineSlots<{
  topRight?: any
  bottomRight?: any
}>()

const modelValue = defineModel<string>({ required: true })
</script>

<template>
  <label
    :key="id"
    class="form_radio-card-simple relative border-2 border-solid"
    transition="all duration-200 ease-in-out"
    :class="[
      modelValue === value
        ? 'bg-[var(--airi-accent-surface)] border-[var(--airi-border-accent)] hover:border-[var(--airi-border-accent)]'
        : 'bg-[var(--airi-surface-card)] border-[var(--airi-border-subtle)] hover:border-[var(--airi-border-accent)]',
      modelValue === value
        ? 'form_radio-card-simple-active'
        : '',
    ]"
    flex="~ col"
    block min-w-50 w-full cursor-pointer items-start rounded-xl p-4 text-left
  >
    <input
      v-model="modelValue"
      :checked="modelValue === value"
      type="radio"
      :name="name"
      :value="value"
      class="absolute opacity-0"
    >
    <div
      class="radio-circle absolute left-2 top-2 size-5 border-2 rounded-full border-solid"
      transition="all duration-200 ease-in-out"
      :class="[
        modelValue === value
          ? 'border-[var(--airi-accent-strong)]'
          : 'border-[var(--airi-border-strong)]',
      ]"
    >
      <div
        class="radio-dot absolute left-1/2 top-1/2 size-3 rounded-full bg-[var(--airi-accent-strong)] -translate-x-1/2 -translate-y-1/2"
        transition="all duration-200 ease-in-out"
        :class="[
          modelValue === value
            ? 'opacity-100'
            : 'opacity-0',
        ]"
      />
    </div>
    <div flex="~ col" min-h-16 w-full items-start justify-center pb-2 pl-5 pr-4 pt-2>
      <span
        class="radio-item-name text-base font-normal"
        :class="[
          modelValue === value
            ? 'text-[var(--airi-text)]'
            : 'text-[var(--airi-text-muted)]',
        ]"
        transition="all duration-200 ease-in-out"
      >
        {{ title }}
      </span>
      <span
        v-if="description"
        class="radio-item-description line-clamp-2 text-xs"
        :class="[
          modelValue === value
            ? 'text-[var(--airi-text-muted)]'
            : 'text-[var(--airi-text-soft)]',
        ]"
        transition="all duration-200 ease-in-out"
        :title="description"
      >
        {{ description }}
      </span>
    </div>
    <div
      class="form_radio-card-simple-dots"
      absolute inset-0 z--1
      style="background-size: 10px 10px; mask-image: linear-gradient(165deg, white 30%, transparent 50%);"
    />

    <div v-if="$slots.topRight" class="absolute right-2 top-2 z-10">
      <slot name="topRight" />
    </div>

    <div v-if="$slots.bottomRight" class="absolute bottom-2 right-2 z-10">
      <slot name="bottomRight" />
    </div>
  </label>
</template>

<style scoped>
.form_radio-card-simple {
  position: relative;
  overflow: hidden;
}

.form_radio-card-simple::before {
  background: linear-gradient(90deg, transparent, transparent);
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 25%;
  height: 100%;
  transition: all 0.35s ease-in-out;
  mask-image: linear-gradient(120deg, white 100%);
  opacity: 0;
}

.form_radio-card-simple:hover::before,
.form_radio-card-simple._hover::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 1;
}

.form_radio-card-simple-active::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 0.5;
}

.form_radio-card-simple-dots {
  background-image: radial-gradient(var(--airi-border-subtle) 1px, transparent 1px);
  transition: background-image 0.2s ease-in-out;
}

.form_radio-card-simple:hover .form_radio-card-simple-dots,
.form_radio-card-simple._hover .form_radio-card-simple-dots,
.form_radio-card-simple-active .form_radio-card-simple-dots {
  background-image: radial-gradient(var(--airi-border-accent) 1px, transparent 1px);
}
</style>
