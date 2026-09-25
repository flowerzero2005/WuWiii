<script setup lang="ts">
import type { WorkbenchTaskChecklistItemView } from '../../../modules/workbench-process-events'

import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  countLabel: string
  items: WorkbenchTaskChecklistItemView[]
  open?: boolean
  title: string
}>(), {
  open: true,
})

const { t } = useI18n()

function getItemIcon(item: WorkbenchTaskChecklistItemView) {
  if (item.status === 'completed')
    return 'i-solar:check-circle-bold-duotone'
  if (item.status === 'running')
    return 'i-solar:refresh-bold-duotone animate-spin'
  if (item.status === 'failed')
    return 'i-solar:danger-circle-bold-duotone'
  if (item.status === 'blocked-confirmation')
    return 'i-solar:danger-triangle-bold-duotone'
  if (item.kind === 'command')
    return 'i-ph:terminal-window-duotone'
  if (item.kind === 'file')
    return 'i-solar:file-text-bold-duotone'

  return 'i-solar:checklist-minimalistic-bold-duotone'
}

function getItemStateClass(item: WorkbenchTaskChecklistItemView) {
  switch (item.status) {
    case 'completed':
      return 'airi-status-success'
    case 'running':
      return 'airi-status-info'
    case 'failed':
      return 'airi-status-danger'
    case 'blocked-confirmation':
      return 'airi-status-warning'
    case 'skipped':
      return 'airi-status-neutral'
    default:
      return 'airi-status-neutral'
  }
}

function getStatusLabel(status: WorkbenchTaskChecklistItemView['status']) {
  switch (status) {
    case 'completed':
      return t('tamagotchi.stage.workbench.card.completed')
    case 'running':
      return t('tamagotchi.stage.workbench.labels.running')
    case 'failed':
      return t('tamagotchi.stage.workbench.command.status.failed')
    case 'blocked-confirmation':
      return t('tamagotchi.stage.workbench.card.needs-confirmation')
    case 'skipped':
      return t('tamagotchi.stage.workbench.command.status.cancelled')
    default:
      return t('tamagotchi.stage.workbench.project-run.status.pending')
  }
}
</script>

<template>
  <details
    :open="props.open"
    :class="[
      'rounded-md airi-status-info shadow-sm shadow-sky-100/70 dark:shadow-none',
    ]"
  >
    <summary
      :class="[
        'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2',
        'text-[11px] font-semibold uppercase text-sky-700 hover:text-sky-950',
        'dark:text-sky-200 dark:hover:text-sky-50',
      ]"
    >
      <span :class="['inline-flex min-w-0 items-center gap-1.5']">
        <span :class="['i-solar:checklist-minimalistic-bold-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ props.title }}</span>
      </span>
      <span :class="['shrink-0 text-[11px] font-normal normal-case text-sky-600 dark:text-sky-300']">
        {{ props.countLabel }}
      </span>
    </summary>

    <ol :class="['border-t border-sky-200/80 px-3 py-2 dark:border-sky-900/70']">
      <li
        v-for="(item, index) in props.items"
        :key="item.stepId"
        :class="[
          'grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-2 py-1.5',
          index > 0 ? 'border-t border-sky-100/80 dark:border-sky-900/50' : '',
        ]"
      >
        <span
          :class="[
            getItemIcon(item),
            getItemStateClass(item),
            'mt-0.5 grid size-5 place-items-center rounded-full text-xs',
          ]"
        />
        <span :class="['min-w-0']">
          <span
            :class="[
              'block truncate text-xs font-semibold',
              item.status === 'completed' ? 'text-sky-800/65 line-through dark:text-sky-100/55' : 'text-sky-950 dark:text-sky-50',
            ]"
          >
            {{ item.title }}
          </span>
          <span
            v-if="item.summary"
            :class="['mt-0.5 block line-clamp-2 text-[11px] leading-4 text-sky-700/80 dark:text-sky-200/75']"
          >
            {{ item.summary }}
          </span>
        </span>
        <span
          :class="[
            getItemStateClass(item),
            'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
          ]"
        >
          {{ getStatusLabel(item.status) }}
        </span>
      </li>
    </ol>
  </details>
</template>
