<script setup lang="ts">
withDefaults(defineProps<{
  id: string
  name: string
  value: string
  title: string
  deprecated?: boolean
}>(), {
  deprecated: false,
})

const modelValue = defineModel<string>({ required: true })
</script>

<template>
  <label
    :key="id"
    :class="[
      'form_radio relative flex cursor-pointer items-start rounded-xl p-3 pr-[20px]',
      'transition-all duration-200 ease-in-out',
      'border-2 border-solid',
      modelValue === value
        ? 'bg-[var(--airi-accent-surface)] border-[var(--airi-border-accent)] hover:border-[var(--airi-border-accent)]'
        : 'bg-[var(--airi-surface-card)] border-[var(--airi-border-subtle)] hover:border-[var(--airi-border-accent)]',
      modelValue === value
        ? 'form_radio-active'
        : '',
      deprecated ? 'opacity-60' : '',
    ]"
  >
    <input
      v-model="modelValue"
      :checked="modelValue === value"
      type="radio"
      :name="name"
      :value="value"
      :class="['absolute opacity-0']"
    >
    <div :class="['relative mr-3 mt-0.5 flex-shrink-0']">
      <div
        :class="[
          'size-5 border-2 rounded-full transition-colors duration-200',
          modelValue === value
            ? 'border-[var(--airi-accent-strong)]'
            : 'border-[var(--airi-border-strong)]',
        ]"
      >
        <div
          :class="[
            'absolute left-1/2 top-1/2 size-3 rounded-full transition-opacity duration-200 -translate-x-1/2 -translate-y-1/2',
            modelValue === value
              ? 'opacity-100 bg-[var(--airi-accent-strong)]'
              : 'opacity-0',
          ]"
        />
      </div>
    </div>
    <div :class="['w-full flex flex-col gap-2']">
      <div :class="['flex items-center']">
        <span
          :class="[
            'line-clamp-1 font-medium',
            modelValue === value
              ? 'text-[var(--airi-text)]'
              : 'text-[var(--airi-text-muted)]',
          ]"
        >
          {{ title }}
        </span>
      </div>
    </div>
  </label>
</template>

<style scoped>
.form_radio {
  position: relative;
  overflow: hidden;
}

.form_radio::before {
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

.form_radio:hover::before,
.form_radio._hover::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 1;
}

.form_radio-active::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 0.5;
}
</style>
