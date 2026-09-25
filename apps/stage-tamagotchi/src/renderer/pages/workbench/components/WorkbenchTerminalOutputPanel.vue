<script setup lang="ts">
import type { WorkbenchTerminalOutputEntry } from '../../../modules/workbench-terminal-output'

import { useI18n } from 'vue-i18n'

const props = defineProps<{
  countLabel: string
  entries: WorkbenchTerminalOutputEntry[]
  focusedEntryId?: string
  nowMs: number
  title: string
}>()

const { t } = useI18n()

function formatDurationMs(durationMs?: number) {
  if (durationMs == null)
    return t('tamagotchi.stage.workbench.command.values.pending')
  if (durationMs < 1000)
    return `${durationMs} ms`

  const seconds = durationMs / 1000
  if (seconds < 60)
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes} m ${remainingSeconds} s`
}

function getDurationLabel(entry: WorkbenchTerminalOutputEntry) {
  if (entry.durationMs != null)
    return formatDurationMs(entry.durationMs)
  if (entry.status === 'running')
    return formatDurationMs(Math.max(0, props.nowMs - entry.startedAt))

  return ''
}

function getStatusClass(status: WorkbenchTerminalOutputEntry['status']) {
  switch (status) {
    case 'running':
      return 'airi-status-info'
    case 'success':
      return 'airi-status-success'
    case 'failed':
      return 'airi-status-danger'
    case 'cancelled':
      return 'airi-status-warning'
    case 'stopped':
    case 'recorded':
    default:
      return 'airi-status-neutral'
  }
}

function getStatusLabel(entry: WorkbenchTerminalOutputEntry) {
  switch (entry.status) {
    case 'running':
      return t('tamagotchi.stage.workbench.command.status.running')
    case 'success':
      return t('tamagotchi.stage.workbench.command.status.success')
    case 'failed':
      return t('tamagotchi.stage.workbench.command.status.failed')
    case 'cancelled':
      return t('tamagotchi.stage.workbench.command.status.cancelled')
    case 'stopped':
      return t('tamagotchi.stage.workbench.project-run.status.stopped')
    case 'recorded':
    default:
      return t('tamagotchi.stage.workbench.card.completed')
  }
}
</script>

<template>
  <section :class="['space-y-2']">
    <div :class="['flex items-center justify-between gap-2']">
      <div :class="['min-w-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase airi-text-muted']">
        <span :class="['i-ph:terminal-window-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ props.title }}</span>
      </div>
      <span :class="['shrink-0 text-[11px] airi-text-muted']">
        {{ props.countLabel }}
      </span>
    </div>

    <div
      v-if="props.entries.length === 0"
      :class="[
        'rounded-md border border-dashed airi-border-subtle px-3 py-2 text-xs leading-5',
        'airi-text-muted',
      ]"
    >
      {{ t('tamagotchi.stage.workbench.command.terminal.empty') }}
    </div>

    <div
      v-for="entry in props.entries"
      :key="entry.id"
      :class="[
        'rounded-md border px-2.5 py-2.5',
        entry.id === props.focusedEntryId
          ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] ring-1 ring-[var(--airi-accent-focus)]'
          : 'airi-card',
      ]"
    >
      <div :class="['flex min-w-0 items-start justify-between gap-2']">
        <div :class="['min-w-0']">
          <div :class="['truncate text-xs font-semibold airi-text']">
            {{ entry.title }}
          </div>
          <div :class="['mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] airi-text-muted']">
            <span>{{ entry.commandText }}</span>
            <span v-if="entry.cwd" :class="['max-w-full truncate']">{{ t('tamagotchi.stage.workbench.labels.cwd') }}: {{ entry.cwd }}</span>
            <span v-if="getDurationLabel(entry)">
              {{ t('tamagotchi.stage.workbench.command.labels.duration') }}: {{ getDurationLabel(entry) }}
            </span>
            <span v-if="entry.exitCode != null">
              {{ t('tamagotchi.stage.workbench.command.labels.exit-code') }}: {{ entry.exitCode }}
            </span>
            <span v-if="entry.url" :class="['max-w-full truncate']">{{ entry.url }}</span>
          </div>
        </div>
        <span
          :class="[
            getStatusClass(entry.status),
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
          ]"
        >
          {{ getStatusLabel(entry) }}
        </span>
      </div>

      <p
        v-if="entry.output.summary"
        :class="[
          'mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs leading-5',
          entry.output.emphasis === 'error'
            ? 'text-red-700 dark:text-red-300'
            : 'text-[var(--airi-text)]',
        ]"
      >
        {{ entry.output.summary }}
      </p>

      <details
        v-if="entry.output.hasRawOutput"
        :open="!entry.output.collapsed"
        :class="['mt-2 rounded-md airi-surface-panel']"
      >
        <summary :class="['flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5']">
          <span :class="['text-[10px] font-semibold uppercase airi-text-muted']">
            {{ t('tamagotchi.stage.workbench.command.labels.raw-output') }}
          </span>
          <span v-if="entry.output.truncated" :class="['text-[10px] uppercase text-amber-600 dark:text-amber-300']">
            {{ t('tamagotchi.stage.workbench.command.values.truncated') }}
          </span>
        </summary>
        <pre :class="['max-h-72 overflow-auto border-t airi-border-subtle bg-neutral-950 p-2.5 text-[11px] leading-5 text-neutral-100']">{{ entry.output.outputPreview }}</pre>
      </details>

      <div
        v-else
        :class="[
          'mt-2 rounded-md border border-dashed airi-border-subtle px-2 py-1.5 text-[11px]',
          'airi-text-muted',
        ]"
      >
        {{ t('tamagotchi.stage.workbench.command.terminal.no-raw-output') }}
      </div>
    </div>
  </section>
</template>
