<script setup lang="ts">
import { useI18n } from 'vue-i18n'

interface WorkbenchTaskCardListCommandRun {
  canResume: boolean
  commandText: string
  durationLabel: string
  exitCodeLabel: string
  id: string
  outputTruncated: boolean
  showDiagnostics: boolean
  statusClass: string
  statusLabel: string
  stderrSummary?: string
  stdoutSummary?: string
}

interface WorkbenchTaskCardListEntry {
  applyProposalLabel: string
  commandRun?: WorkbenchTaskCardListCommandRun
  discardProposalLabel: string
  id: string
  kindLabel: string
  latestStepPreview: string
  selected: boolean
  selectionLabel: string
  showLatestStep: boolean
  showProposalActions: boolean
  signalClass: string
  signalIcon?: string
  signalLabel: string
  stepCountLabel: string
  summaryPreview: string
  title: string
  workspaceLabel?: string
}

const props = withDefaults(defineProps<{
  commandActionDisabled?: boolean
  entries: WorkbenchTaskCardListEntry[]
  proposalActionDisabled?: boolean
  taskActionDisabled?: boolean
}>(), {
  commandActionDisabled: false,
  proposalActionDisabled: false,
  taskActionDisabled: false,
})

const emit = defineEmits<{
  applyProposals: [taskCardId: string]
  continueTaskCard: [taskCardId: string]
  deleteTaskCard: [taskCardId: string]
  discardProposals: [taskCardId: string]
  rerunCommand: [commandRunId: string]
  selectTaskCard: [taskCardId: string]
}>()

const { t } = useI18n()
</script>

<template>
  <div :class="['space-y-2']">
    <div
      v-for="entry in props.entries"
      :key="entry.id"
      :class="[
        'w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors',
        entry.selected
          ? 'airi-status-info shadow-sm ring-1 ring-sky-200/70 dark:ring-sky-900/60'
          : 'airi-card airi-card-hover',
      ]"
      role="button"
      tabindex="0"
      @click="emit('selectTaskCard', entry.id)"
      @dblclick="emit('continueTaskCard', entry.id)"
      @keydown.enter.prevent="emit('selectTaskCard', entry.id)"
      @keydown.space.prevent="emit('selectTaskCard', entry.id)"
    >
      <div :class="['flex min-w-0 items-start gap-2']">
        <div
          :class="[
            'mt-1 grid size-3 shrink-0 place-items-center rounded-full',
            entry.signalClass,
          ]"
          :title="entry.signalLabel"
        >
          <span v-if="entry.signalIcon" :class="[entry.signalIcon, 'size-2.5']" />
        </div>
        <div :class="['min-w-0 flex-1']">
          <div :class="['flex min-w-0 items-center gap-2']">
            <span :class="['min-w-0 flex-1 truncate text-sm font-semibold']">{{ entry.title }}</span>
            <span
              v-if="entry.commandRun"
              :class="[
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
                entry.commandRun.statusClass,
              ]"
            >
              {{ entry.commandRun.statusLabel }}
            </span>
            <button
              v-if="entry.commandRun?.canResume"
              :class="[
                'grid size-6 shrink-0 place-items-center rounded-md airi-focus text-neutral-500',
                'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
                'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
              ]"
              :title="t('tamagotchi.stage.workbench.actions.resume-from-card')"
              :disabled="props.commandActionDisabled"
              type="button"
              @click.stop="emit('rerunCommand', entry.commandRun.id)"
            >
              <span :class="['i-solar:restart-bold-duotone size-3.5']" />
            </button>
            <button
              :class="[
                'grid size-6 shrink-0 place-items-center rounded-md airi-focus text-neutral-500',
                'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
                'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
              ]"
              :title="t('tamagotchi.stage.workbench.actions.continue-task-card')"
              :disabled="props.taskActionDisabled"
              type="button"
              @click.stop="emit('continueTaskCard', entry.id)"
            >
              <span :class="['i-solar:alt-arrow-right-linear size-3.5']" />
            </button>
            <button
              v-if="entry.showProposalActions"
              :class="[
                'h-6 shrink-0 rounded-md airi-status-success px-2 text-[11px] font-medium',
                'inline-flex items-center gap-1 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50',
                'dark:hover:bg-emerald-900/70',
              ]"
              :disabled="props.proposalActionDisabled"
              type="button"
              @click.stop="emit('applyProposals', entry.id)"
            >
              <span :class="['i-solar:check-circle-bold-duotone size-3.5']" />
              <span>{{ entry.applyProposalLabel }}</span>
            </button>
            <button
              v-if="entry.showProposalActions"
              :class="[
                'h-6 shrink-0 airi-control-muted rounded-md px-2 text-[11px] font-medium text-neutral-700',
                'inline-flex items-center gap-1 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50',
                'dark:text-neutral-200 dark:hover:bg-neutral-800',
              ]"
              :disabled="props.proposalActionDisabled"
              type="button"
              @click.stop="emit('discardProposals', entry.id)"
            >
              <span :class="['i-solar:close-circle-bold-duotone size-3.5']" />
              <span>{{ entry.discardProposalLabel }}</span>
            </button>
            <button
              :class="[
                'grid size-6 shrink-0 place-items-center rounded-md airi-focus text-neutral-500',
                'hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40',
                'dark:text-neutral-400 dark:hover:bg-red-950/50 dark:hover:text-red-300',
              ]"
              :title="t('tamagotchi.stage.workbench.actions.delete-task-card')"
              :disabled="props.taskActionDisabled"
              type="button"
              @click.stop="emit('deleteTaskCard', entry.id)"
            >
              <span :class="['i-solar:trash-bin-trash-bold-duotone size-3.5']" />
            </button>
          </div>
          <div
            v-if="entry.commandRun?.showDiagnostics"
            :class="['mt-1 rounded-md airi-status-neutral px-2 py-1.5 font-mono text-[11px]']"
          >
            <div :class="['truncate']">
              {{ entry.commandRun.commandText }}
            </div>
            <div :class="['mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[10px] text-neutral-500 dark:text-neutral-400']">
              <span>{{ t('tamagotchi.stage.workbench.command.labels.duration') }}: {{ entry.commandRun.durationLabel }}</span>
              <span>{{ t('tamagotchi.stage.workbench.command.labels.exit-code') }}: {{ entry.commandRun.exitCodeLabel }}</span>
              <span v-if="entry.commandRun.outputTruncated">{{ t('tamagotchi.stage.workbench.command.values.truncated') }}</span>
            </div>
          </div>
          <p
            v-if="entry.summaryPreview"
            :class="['mt-1 line-clamp-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300']"
          >
            {{ entry.summaryPreview }}
          </p>
          <div
            v-if="entry.showLatestStep"
            :class="['mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400']"
          >
            <span :class="['i-solar:bolt-circle-bold-duotone size-3.5 shrink-0']" />
            <span :class="['shrink-0']">
              {{ t('tamagotchi.stage.workbench.labels.latest-step') }}
            </span>
            <span :class="['truncate text-neutral-700 dark:text-neutral-200']">
              {{ entry.latestStepPreview }}
            </span>
          </div>
          <div v-if="entry.commandRun?.stderrSummary" :class="['mt-1 line-clamp-1 text-[11px] text-red-600 dark:text-red-300']">
            {{ t('tamagotchi.stage.workbench.command.labels.stderr') }}: {{ entry.commandRun.stderrSummary }}
          </div>
          <div
            v-else-if="entry.commandRun?.stdoutSummary && entry.commandRun.showDiagnostics"
            :class="['mt-1 line-clamp-1 text-[11px] text-neutral-500 dark:text-neutral-400']"
          >
            {{ t('tamagotchi.stage.workbench.command.labels.stdout') }}: {{ entry.commandRun.stdoutSummary }}
          </div>
          <div :class="['mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] text-neutral-500 dark:text-neutral-400']">
            <div :class="['min-w-0 flex items-center gap-2']">
              <span>{{ entry.kindLabel }}</span>
              <span>·</span>
              <span>{{ entry.stepCountLabel }}</span>
              <template v-if="entry.workspaceLabel">
                <span>·</span>
                <span :class="['min-w-0 truncate']">{{ entry.workspaceLabel }}</span>
              </template>
            </div>
            <span :class="['inline-flex shrink-0 items-center gap-1 font-medium text-neutral-600 dark:text-neutral-300']">
              <span>{{ entry.selectionLabel }}</span>
              <span :class="['i-solar:alt-arrow-right-linear size-3']" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
