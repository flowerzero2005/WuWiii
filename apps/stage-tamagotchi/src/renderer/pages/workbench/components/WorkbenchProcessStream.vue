<script setup lang="ts">
import type {
  WorkbenchDetailRef,
  WorkbenchProcessEventView,
} from '../../../modules/workbench-process-events'

import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  countLabel: string
  events: WorkbenchProcessEventView[]
  foldedLabel?: string
  open?: boolean
  title: string
}>(), {
  foldedLabel: '',
  open: false,
})

const emit = defineEmits<{
  focusDetail: [detailRef: WorkbenchDetailRef]
}>()

const { t } = useI18n()

function getEventIcon(event: WorkbenchProcessEventView) {
  if (event.kind === 'command-started' || event.kind === 'command-summary' || event.kind === 'command-output')
    return 'i-ph:terminal-window-duotone'
  if (event.kind === 'diff-created' || event.kind === 'file-preview' || event.kind === 'proposal-applied' || event.kind === 'proposal-discarded')
    return 'i-solar:branching-paths-up-bold-duotone'
  if (event.kind === 'file-read' || event.kind === 'file-opened')
    return 'i-solar:file-text-bold-duotone'
  if (event.kind === 'web-search' || event.kind === 'web-result')
    return 'i-solar:global-bold-duotone'
  if (event.kind === 'confirmation-request')
    return 'i-solar:danger-triangle-bold-duotone'
  if (event.kind === 'error')
    return 'i-solar:danger-circle-bold-duotone'
  if (event.kind === 'recovery')
    return 'i-solar:restart-bold-duotone'

  return 'i-solar:cpu-bolt-bold-duotone'
}

function getStatusClass(status: WorkbenchProcessEventView['status']) {
  switch (status) {
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

function getStatusLabel(status: WorkbenchProcessEventView['status']) {
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

function getRiskClass(risk: WorkbenchProcessEventView['risk']) {
  switch (risk) {
    case 'low':
      return 'airi-status-success'
    case 'normal':
      return 'airi-status-info'
    case 'high':
      return 'airi-status-warning'
    case 'blocked':
      return 'airi-status-danger'
    default:
      return 'airi-status-neutral'
  }
}

function getRiskLabel(risk: WorkbenchProcessEventView['risk']) {
  return risk
    ? t(`tamagotchi.stage.workbench.command.risk.${risk}`)
    : ''
}

function getDetailTabLabel(tab: WorkbenchDetailRef['tab']) {
  switch (tab) {
    case 'summary':
      return t('tamagotchi.stage.workbench.labels.summary')
    case 'changes':
      return t('tamagotchi.stage.workbench.labels.changes')
    case 'context':
      return t('tamagotchi.stage.workbench.labels.context')
    case 'terminal':
      return t('tamagotchi.stage.workbench.labels.terminal')
    case 'search':
      return t('tamagotchi.stage.workbench.labels.search')
    case 'audit':
      return t('tamagotchi.stage.workbench.labels.audit')
  }
}

function getSearchProviderStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return t('tamagotchi.stage.workbench.web-search.provider-status.completed')
    case 'failed':
      return t('tamagotchi.stage.workbench.web-search.provider-status.failed')
    case 'not-run':
      return t('tamagotchi.stage.workbench.web-search.provider-status.not-run')
    case 'unconfigured':
      return t('tamagotchi.stage.workbench.web-search.provider-status.unconfigured')
    default:
      return status
  }
}
</script>

<template>
  <details
    :open="props.open"
    :class="[
      'airi-card rounded-md',
    ]"
  >
    <summary
      :class="[
        'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2',
        'text-[11px] font-semibold uppercase text-neutral-500 hover:text-neutral-800',
        'dark:text-neutral-400 dark:hover:text-neutral-100',
      ]"
    >
      <span :class="['inline-flex min-w-0 items-center gap-1.5']">
        <span :class="['i-solar:bolt-circle-bold-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ props.title }}</span>
      </span>
      <span :class="['shrink-0 text-[11px] font-normal normal-case text-neutral-500 dark:text-neutral-400']">
        {{ props.countLabel }}
      </span>
    </summary>

    <div :class="['space-y-0 border-t border-neutral-200 p-3 dark:border-neutral-800']">
      <div
        v-if="props.foldedLabel"
        :class="[
          'mb-3 rounded-md border border-dashed border-neutral-200 px-3 py-2 text-[11px]',
          'text-neutral-500 dark:border-neutral-800 dark:text-neutral-400',
        ]"
      >
        {{ props.foldedLabel }}
      </div>

      <div
        v-for="(event, index) in props.events"
        :key="event.eventId"
        :class="['relative pb-3 pl-8 last:pb-0']"
      >
        <div
          v-if="index < props.events.length - 1"
          :class="['absolute bottom-0 left-3 top-7 w-px bg-neutral-200 dark:bg-neutral-800']"
        />
        <span
          :class="[
            getEventIcon(event),
            getStatusClass(event.status),
            'absolute left-0 top-0 grid size-6 place-items-center rounded-full text-sm',
          ]"
        />

        <div :class="['min-w-0 airi-card rounded-md px-2.5 py-2.5']">
          <div :class="['flex min-w-0 items-start justify-between gap-2']">
            <div :class="['min-w-0']">
              <div :class="['truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100']">
                {{ event.title }}
              </div>
              <div :class="['mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500 dark:text-neutral-400']">
                <span>{{ event.kind }}</span>
                <span>{{ getDetailTabLabel(event.detailRef.tab) }}</span>
                <span v-if="event.searchQuery" :class="['max-w-full truncate']" :title="event.searchQuery">
                  {{ t('tamagotchi.stage.workbench.web-search.labels.query') }}: {{ event.searchQuery }}
                </span>
                <span v-if="event.searchSourceCount != null">
                  {{ t('tamagotchi.stage.workbench.web-search.labels.sources') }}: {{ event.searchSourceCount }}
                </span>
                <span v-if="event.searchProviderStatus">
                  {{ t('tamagotchi.stage.workbench.web-search.labels.provider') }}: {{ getSearchProviderStatusLabel(event.searchProviderStatus) }}
                </span>
                <span
                  v-if="event.risk"
                  :class="[
                    getRiskClass(event.risk),
                    'rounded px-1.5 py-0.5 uppercase',
                  ]"
                  :title="event.riskReason"
                >
                  {{ t('tamagotchi.stage.workbench.command.labels.risk') }}: {{ getRiskLabel(event.risk) }}
                </span>
              </div>
            </div>
            <span
              :class="[
                getStatusClass(event.status),
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
              ]"
            >
              {{ getStatusLabel(event.status) }}
            </span>
          </div>

          <p
            v-if="event.summary"
            :class="['mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-neutral-700 dark:text-neutral-200']"
          >
            {{ event.summary }}
          </p>

          <button
            :class="[
              'mt-2 inline-flex h-7 max-w-full items-center gap-1.5 airi-control-muted rounded-md px-2',
              'text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
              'dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            type="button"
            @click="emit('focusDetail', event.detailRef)"
          >
            <span :class="['i-solar:alt-arrow-right-linear size-3.5 shrink-0']" />
            <span :class="['truncate']">{{ t('tamagotchi.stage.workbench.labels.details') }} · {{ getDetailTabLabel(event.detailRef.tab) }}</span>
          </button>
        </div>
      </div>
    </div>
  </details>
</template>
