<script setup lang="ts">
import type { WorkbenchAuditEntry } from '../../../modules/workbench-audit-entries'
import type { WorkbenchDetailRef } from '../../../modules/workbench-process-events'

import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  countLabel: string
  entries: WorkbenchAuditEntry[]
  focusedAuditId?: string
  foldedLabel?: string
  open?: boolean
  title: string
}>(), {
  open: false,
  foldedLabel: '',
})

const emit = defineEmits<{
  focusDetail: [detailRef: WorkbenchDetailRef]
}>()

const { t } = useI18n()

function formatAuditTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getEntryIcon(entry: WorkbenchAuditEntry) {
  switch (entry.kind) {
    case 'planner-decision':
      return 'i-solar:map-arrow-right-bold-duotone'
    case 'file-read':
    case 'file-proposal':
    case 'file-apply':
      return 'i-solar:file-text-bold-duotone'
    case 'command':
      return 'i-ph:terminal-window-duotone'
    case 'web-search':
      return 'i-solar:global-bold-duotone'
    case 'confirmation':
      return 'i-solar:danger-triangle-bold-duotone'
    case 'error':
      return 'i-solar:danger-circle-bold-duotone'
    case 'recovery':
      return 'i-solar:restart-bold-duotone'
  }
}

function getStatusClass(status: WorkbenchAuditEntry['status']) {
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

function getStatusLabel(status: WorkbenchAuditEntry['status']) {
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

function getEntryKindLabel(entry: WorkbenchAuditEntry) {
  return t(`tamagotchi.stage.workbench.audit.kind.${entry.kind}`)
}

function getDetailLabel(key: string) {
  return t(`tamagotchi.stage.workbench.audit.detail.${key}`)
}

function getSourceLabel(source: WorkbenchAuditEntry['source']) {
  return t(`tamagotchi.stage.workbench.audit.source.${source}`)
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
</script>

<template>
  <details
    :open="props.open"
    :class="[
      'rounded-md airi-surface-panel',
    ]"
  >
    <summary
      :class="[
        'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2',
        'text-[11px] font-semibold uppercase airi-text-muted hover:text-[var(--airi-text)]',
      ]"
    >
      <span :class="['inline-flex min-w-0 items-center gap-1.5']">
        <span :class="['i-solar:clipboard-text-bold-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ props.title }}</span>
      </span>
      <span :class="['shrink-0 text-[11px] font-normal normal-case airi-text-muted']">
        {{ props.countLabel }}
      </span>
    </summary>

    <div :class="['space-y-2 border-t airi-border-subtle p-3']">
      <div
        v-if="props.foldedLabel"
        :class="[
          'rounded-md border border-dashed airi-border-subtle px-3 py-2 text-[11px]',
          'airi-text-muted',
        ]"
      >
        {{ props.foldedLabel }}
      </div>

      <div
        v-if="props.entries.length === 0"
        :class="['rounded-md border border-dashed airi-border-subtle px-3 py-3 text-xs airi-text-muted']"
      >
        {{ t('tamagotchi.stage.workbench.audit.empty') }}
      </div>

      <article
        v-for="entry in props.entries"
        :key="entry.auditId"
        :class="[
          'rounded-md border px-2.5 py-2.5',
          entry.auditId === props.focusedAuditId
            ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] ring-1 ring-[var(--airi-accent-focus)]'
            : 'airi-card',
        ]"
      >
        <div :class="['flex min-w-0 items-start justify-between gap-2']">
          <div :class="['min-w-0 flex items-start gap-2']">
            <span
              :class="[
                getEntryIcon(entry),
                getStatusClass(entry.status),
                'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm',
              ]"
            />
            <div :class="['min-w-0']">
              <div :class="['truncate text-xs font-semibold airi-text']">
                {{ entry.title }}
              </div>
              <div :class="['mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] airi-text-muted']">
                <span>{{ getEntryKindLabel(entry) }}</span>
                <span>{{ formatAuditTime(entry.createdAt) }}</span>
                <span>{{ getSourceLabel(entry.source) }}</span>
              </div>
            </div>
          </div>
          <span
            :class="[
              getStatusClass(entry.status),
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
            ]"
          >
            {{ getStatusLabel(entry.status) }}
          </span>
        </div>

        <p :class="['mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--airi-text)]']">
          {{ entry.summary }}
        </p>

        <details
          :open="entry.auditId === props.focusedAuditId"
          :class="['mt-2 rounded-md airi-surface-glass']"
        >
          <summary :class="['flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium airi-text-muted']">
            <span :class="['inline-flex min-w-0 items-center gap-1.5']">
              <span :class="['i-solar:code-square-bold-duotone size-3.5 shrink-0']" />
              <span>{{ t('tamagotchi.stage.workbench.audit.developer-details') }}</span>
            </span>
            <span :class="['truncate text-[10px] airi-text-muted']">
              {{ entry.relatedEventId }}
            </span>
          </summary>

          <dl :class="['grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 border-t airi-border-subtle px-2 py-2 text-[11px]']">
            <template
              v-for="detail in entry.details"
              :key="`${entry.auditId}:${detail.key}:${detail.value}`"
            >
              <dt :class="['airi-text-muted']">
                {{ getDetailLabel(detail.key) }}
              </dt>
              <dd :class="['min-w-0 break-words font-mono airi-text']">
                {{ detail.value }}
              </dd>
            </template>
          </dl>
        </details>

        <button
          :class="[
            'mt-2 inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2',
            'airi-control-muted text-[11px] font-medium',
          ]"
          type="button"
          @click="emit('focusDetail', entry.detailRef)"
        >
          <span :class="['i-solar:alt-arrow-right-linear size-3.5 shrink-0']" />
          <span :class="['truncate']">{{ t('tamagotchi.stage.workbench.audit.open-related') }} · {{ getDetailTabLabel(entry.detailRef.tab) }}</span>
        </button>
      </article>
    </div>
  </details>
</template>
