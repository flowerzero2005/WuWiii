<script setup lang="ts">
import { Input, TransitionVertical } from '@proj-airi/ui'
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  id: string
  name: string
  value: string
  title: string
  description?: string
  deprecated?: boolean
  showExpandCollapse?: boolean
  expandCollapseThreshold?: number
  customInputValue?: string
  customInputPlaceholder?: string
  showCustomInput?: boolean
}>(), {
  deprecated: false,
  showExpandCollapse: true,
  expandCollapseThreshold: 100,
  customInputValue: '',
  customInputPlaceholder: '',
  showCustomInput: false,
})

const modelValue = defineModel<string>({ required: true })

// Track if description is expanded
const isExpanded = ref(false)

// Toggle description expansion
function toggleExpansion() {
  isExpanded.value = !isExpanded.value
}

function selectCard(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : undefined
  if (target?.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]'))
    return

  modelValue.value = props.value
}
</script>

<template>
  <div
    :key="id"
    class="form_radio-card-detail relative flex cursor-pointer items-start border-2 rounded-xl border-solid p-3 pr-[20px]"
    transition="all duration-200 ease-in-out"
    :class="[
      modelValue === value
        ? 'bg-[var(--airi-accent-surface)] border-[var(--airi-border-accent)] hover:border-[var(--airi-border-accent)]'
        : 'bg-[var(--airi-surface-card)] border-[var(--airi-border-subtle)] hover:border-[var(--airi-border-accent)]',
      modelValue === value
        ? 'form_radio-card-detail-active'
        : '',
      deprecated ? 'opacity-60' : '',
    ]"
    @click="selectCard"
  >
    <input
      :id="`radio-card-detail-${id}`"
      v-model="modelValue"
      :aria-describedby="description ? `radio-card-detail-description-${id}` : undefined"
      :aria-labelledby="`radio-card-detail-title-${id}`"
      :checked="modelValue === value"
      type="radio"
      :name="name"
      :value="value"
      class="sr-only"
    >
    <div class="relative mr-3 mt-0.5 flex-shrink-0">
      <div
        class="size-5 border-2 rounded-full transition-colors duration-200"
        :class="[
          modelValue === value
            ? 'border-[var(--airi-accent-strong)]'
            : 'border-[var(--airi-border-strong)]',
        ]"
      >
        <div
          class="absolute left-1/2 top-1/2 size-3 rounded-full transition-opacity duration-200 -translate-x-1/2 -translate-y-1/2"
          :class="[
            modelValue === value
              ? 'opacity-100 bg-[var(--airi-accent-strong)]'
              : 'opacity-0',
          ]"
        />
      </div>
    </div>
    <div class="w-full flex flex-col gap-2">
      <div class="flex items-center">
        <span
          :id="`radio-card-detail-title-${id}`"
          class="line-clamp-1 font-normal"
          :class="[
            modelValue === value
              ? 'text-[var(--airi-text)]'
              : 'text-[var(--airi-text-muted)]',
          ]"
        >
          {{ title }}
        </span>
      </div>

      <!-- Truncated description with expand/collapse functionality -->
      <div v-if="description" class="relative">
        <!-- Description with ellipsis (limited to 2 lines) -->
        <TransitionVertical>
          <div
            v-if="!isExpanded || !showExpandCollapse"
            :id="`radio-card-detail-description-${id}`"
            class="line-clamp-2 cursor-pointer text-xs"
            :class="[
              modelValue === value
                ? 'text-[var(--airi-text-muted)]'
                : 'text-[var(--airi-text-soft)]',
            ]"
            :title="description"
          >
            {{ description }}
          </div>

          <!-- Expanded description -->
          <div
            v-else
            :id="`radio-card-detail-description-${id}`"
            class="cursor-pointer text-xs"
            :class="[
              modelValue === value
                ? 'text-[var(--airi-text-muted)]'
                : 'text-[var(--airi-text-soft)]',
            ]"
          >
            {{ description }}
          </div>
        </TransitionVertical>

        <!-- Expand/collapse button for long descriptions -->
        <button
          v-if="showExpandCollapse && description.length > expandCollapseThreshold"
          type="button"
          class="mt-0.5 inline-flex items-center text-xs text-[var(--airi-accent-text)] transition-colors hover:text-[var(--airi-accent-strong)]"
          @click.prevent="toggleExpansion"
        >
          <span>{{ isExpanded ? 'Show less' : 'Show more' }}</span>
          <div
            :class="{ 'rotate-180': isExpanded }"
            class="transition-transform duration-200"
          >
            <div i-solar:alt-arrow-down-linear ml-0.5 text-xs />
          </div>
        </button>
      </div>

      <!-- Custom model input field -->
      <div v-if="showCustomInput && modelValue === value" class="mt-2">
        <Input
          v-model="modelValue"
          type="text"
          class="airi-input w-full"
          :placeholder="customInputPlaceholder"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.form_radio-card-detail {
  position: relative;
  overflow: hidden;
}

.form_radio-card-detail::before {
  pointer-events: none;
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

.form_radio-card-detail:hover::before,
.form_radio-card-detail._hover::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 1;
}

.form_radio-card-detail-active::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 85%;
  opacity: 0.5;
}
</style>
