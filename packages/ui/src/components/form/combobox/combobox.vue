<script setup lang="ts" generic="T extends AcceptableValue">
import type { AcceptableValue } from 'reka-ui'

import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'

const props = defineProps<{
  options: { groupLabel: string, children?: { label: string, value: T }[] }[]
  placeholder?: string
  emptyLabel?: string
}>()

const modelValue = defineModel<T>({ required: false })

function toDisplayValue(value: T): string {
  const option = props.options.flatMap(group => group.children).find(option => option?.value === value)
  return option ? option.label : props.placeholder || ''
}
</script>

<template>
  <ComboboxRoot v-model="modelValue" :class="['relative', 'w-full']">
    <ComboboxAnchor
      :class="[
        'airi-input',
        'inline-flex h-10 items-center justify-between gap-[5px] rounded-xl px-3 leading-none',
        'data-[placeholder]:text-[var(--airi-text-soft)]',
        'focus-within:border-[var(--airi-border-accent)]',
      ]"
    >
      <ComboboxInput
        :class="[
          '!bg-transparent outline-none h-full selection:bg-grass5 placeholder-stone-400 w-full',
          'text-[var(--airi-text)]',
          'transition-colors duration-200 ease-in-out',
        ]"
        :placeholder="props.placeholder"
        :display-value="(val) => toDisplayValue(val)"
      />
      <ComboboxTrigger>
        <div
          i-solar:alt-arrow-down-linear
          :class="[
            'h-4 w-4',
            'text-[var(--airi-text)]',
            'transition-colors duration-200 ease-in-out',
          ]"
        />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        side="bottom"
        align="start"
        :side-offset="4"
        :avoid-collisions="true"
        :class="[
          // NOTICE: DialogContent/DialogOverlay use z-[9999], and DrawerContent uses z-[1000].
          // ComboboxContent must render above these layers so that dropdowns inside
          // Dialog/Drawer are not hidden behind the overlay or dismissed unexpectedly.
          // Read more at: https://github.com/moeru-ai/airi/issues/1136
          'z-[10010]',
          'airi-surface-panel',
          'w-full min-w-[160px] overflow-hidden rounded-xl border-2 will-change-[opacity,transform]',
          'data-[side=top]:animate-slideDownAndFade data-[side=right]:animate-slideLeftAndFade data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade',
        ]"
        :style="{ width: 'var(--reka-combobox-trigger-width)' }"
      >
        <ComboboxViewport :class="['p-[2px]', 'max-h-50dvh', 'overflow-y-auto']">
          <ComboboxEmpty
            :class="[
              'font-medium py-2 px-2',
              'text-xs text-[var(--airi-text)]',
              'transition-colors duration-200 ease-in-out',
            ]"
          >
            {{ props.emptyLabel || 'No options' }}
          </ComboboxEmpty>

          <template
            v-for="(group, index) in options"
            :key="group.groupLabel"
          >
            <ComboboxGroup :class="['overflow-x-hidden']">
              <ComboboxSeparator
                v-if="index !== 0"
                :class="['m-[5px]', 'h-[1px]', 'bg-[var(--airi-border-subtle)]']"
              />

              <ComboboxLabel
                :class="[
                  'px-[25px] text-xs leading-[25px]',
                  'text-[var(--airi-text-muted)]',
                  'transition-colors duration-200 ease-in-out',
                ]"
              >
                {{ group.groupLabel }}
              </ComboboxLabel>

              <ComboboxItem
                v-for="option in group.children"
                :key="option.label"
                :text-value="option.label"
                :value="option.value"
                :class="[
                  'leading-normal rounded-lg flex items-center h-8 pr-[0.5rem] pl-[1.5rem] relative select-none data-[disabled]:pointer-events-none data-[highlighted]:outline-none',
                  'data-[highlighted]:bg-[var(--airi-surface-control-hover)]',
                  'text-sm text-[var(--airi-text)] data-[disabled]:text-[var(--airi-text-soft)]',
                  'transition-colors duration-200 ease-in-out',
                  'cursor-pointer',
                ]"
              >
                <ComboboxItemIndicator
                  :class="['absolute', 'left-0', 'w-[25px]', 'inline-flex', 'items-center', 'justify-center', 'opacity-30']"
                >
                  <div i-solar:alt-arrow-right-outline />
                </ComboboxItemIndicator>
                <span :class="['line-clamp-1', 'overflow-hidden', 'text-ellipsis', 'whitespace-nowrap']">
                  {{ option.label }}
                </span>
              </ComboboxItem>
            </ComboboxGroup>
          </template>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
