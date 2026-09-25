<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface WorkbenchChangeReviewItem {
  applying: boolean
  canApply: boolean
  conflictSummary?: string
  createdAtLabel: string
  detailFacts: string[]
  discarding: boolean
  hasActions: boolean
  id: string
  metaLabel: string
  operation?: 'write-text' | 'delete-file'
  path: string
  preview?: string
  previewLabel: string
  previewOpen: boolean
  staleSummary?: string
  statusClass: string[]
  statusLabel: string
  summary: string
}

const props = withDefaults(defineProps<{
  applying?: boolean
  busy?: boolean
  discarding?: boolean
  items: WorkbenchChangeReviewItem[]
  pendingCount: number
}>(), {
  applying: false,
  busy: false,
  discarding: false,
})

const emit = defineEmits<{
  applyAll: []
  applyAndPreview: []
  applyItem: [id: string]
  discardAll: []
  discardItem: [id: string]
  openChanges: []
}>()

const { t } = useI18n()

function isHtmlPath(path: string) {
  return path.replace(/\\/g, '/').toLowerCase().endsWith('.html')
}

const canApplyAndPreview = computed(() => props.items.some(item => item.canApply && item.operation !== 'delete-file' && isHtmlPath(item.path)))
</script>

<template>
  <div
    :class="[
      'rounded-md airi-surface-glass px-3 py-2.5',
    ]"
  >
    <div :class="['flex min-w-0 items-start justify-between gap-3']">
      <div :class="['min-w-0 flex items-start gap-2']">
        <span :class="['i-solar:branching-paths-up-bold-duotone mt-0.5 size-4 shrink-0 text-[var(--airi-accent-strong)]']" />
        <div :class="['min-w-0']">
          <div :class="['text-xs font-semibold airi-text']">
            {{ t('tamagotchi.stage.workbench.changes.review-title') }}
          </div>
          <p :class="['mt-1 line-clamp-2 text-[11px] leading-5 airi-text-muted']">
            {{ t('tamagotchi.stage.workbench.changes.review-summary', { count: props.items.length }) }}
          </p>
        </div>
      </div>
      <div :class="['flex shrink-0 flex-wrap justify-end gap-1.5']">
        <button
          :class="[
            'h-7 shrink-0 rounded-md px-2 text-[11px] font-medium',
            'inline-flex items-center gap-1.5 airi-control-muted',
          ]"
          type="button"
          @click="emit('openChanges')"
        >
          <span :class="['i-solar:alt-arrow-right-linear size-3.5']" />
          <span>{{ t('tamagotchi.stage.workbench.changes.review-and-confirm') }}</span>
        </button>
        <button
          v-if="props.pendingCount > 0"
          :class="[
            'h-7 shrink-0 rounded-md px-2 text-[11px] font-medium',
            'inline-flex items-center gap-1.5 airi-control-primary',
          ]"
          :disabled="props.busy"
          type="button"
          @click="emit('applyAll')"
        >
          <span :class="['i-solar:check-circle-bold-duotone size-3.5']" />
          <span>{{ props.applying ? t('tamagotchi.stage.workbench.changes.applying') : t('tamagotchi.stage.workbench.changes.apply-all') }}</span>
        </button>
        <button
          v-if="canApplyAndPreview"
          :class="[
            'h-7 shrink-0 rounded-md px-2 text-[11px] font-medium',
            'inline-flex items-center gap-1.5 airi-control-primary',
          ]"
          :disabled="props.busy"
          type="button"
          @click="emit('applyAndPreview')"
        >
          <span :class="['i-solar:monitor-smartphone-bold-duotone size-3.5']" />
          <span>{{ props.applying ? t('tamagotchi.stage.workbench.changes.applying') : t('tamagotchi.stage.workbench.changes.apply-and-preview') }}</span>
        </button>
        <button
          v-if="props.pendingCount > 1"
          :class="[
            'h-7 shrink-0 rounded-md px-2 text-[11px] font-medium',
            'inline-flex items-center gap-1.5 airi-control-muted',
          ]"
          :disabled="props.busy"
          type="button"
          @click="emit('discardAll')"
        >
          <span :class="['i-solar:close-circle-bold-duotone size-3.5']" />
          <span>{{ props.discarding ? t('tamagotchi.stage.workbench.changes.discarding') : t('tamagotchi.stage.workbench.changes.discard-all') }}</span>
        </button>
      </div>
    </div>

    <div :class="['mt-3 divide-y divide-[var(--airi-border-subtle)]']">
      <div
        v-for="item in props.items"
        :key="item.id"
        :class="['py-2 first:pt-0 last:pb-0']"
      >
        <div :class="['flex min-w-0 items-start justify-between gap-2']">
          <div :class="['min-w-0']">
            <div :class="['flex min-w-0 items-center gap-2']">
              <div :class="['truncate font-mono text-[11px] font-semibold']">
                {{ item.path }}
              </div>
              <span
                :class="[
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  item.statusClass,
                ]"
              >
                {{ item.statusLabel }}
              </span>
            </div>
            <div :class="['mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] airi-text-muted']">
              <span>{{ item.metaLabel }}</span>
              <span>{{ item.createdAtLabel }}</span>
            </div>
            <p :class="['mt-1 line-clamp-2 text-[11px] leading-5 airi-text-muted']">
              {{ item.summary }}
            </p>
            <div
              v-if="item.conflictSummary"
              :class="['mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100']"
            >
              {{ item.conflictSummary }}
            </div>
            <div
              v-else-if="item.staleSummary"
              :class="['mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100']"
            >
              {{ item.staleSummary }}
            </div>
            <div :class="['mt-2 flex flex-wrap gap-1 text-[10px] opacity-75']">
              <span
                v-for="fact in item.detailFacts"
                :key="fact"
                :class="['rounded bg-[var(--airi-surface-control-muted)] px-1.5 py-0.5 font-mono']"
              >
                {{ fact }}
              </span>
            </div>
          </div>
          <div
            v-if="item.hasActions"
            :class="['flex shrink-0 flex-wrap justify-end gap-1.5']"
          >
            <button
              v-if="item.canApply"
              :class="[
                'h-7 rounded-md px-2 text-[11px] font-medium',
                'inline-flex items-center gap-1.5 airi-control-primary',
              ]"
              :disabled="props.busy"
              type="button"
              @click="emit('applyItem', item.id)"
            >
              <span :class="['i-solar:check-circle-bold-duotone size-3.5']" />
              <span>{{ item.applying ? t('tamagotchi.stage.workbench.changes.applying') : t('tamagotchi.stage.workbench.changes.apply') }}</span>
            </button>
            <button
              :class="[
                'h-7 rounded-md px-2 text-[11px] font-medium',
                'inline-flex items-center gap-1.5 airi-control-muted',
              ]"
              :disabled="props.busy"
              type="button"
              @click="emit('discardItem', item.id)"
            >
              <span :class="['i-solar:close-circle-bold-duotone size-3.5']" />
              <span>{{ item.discarding ? t('tamagotchi.stage.workbench.changes.discarding') : t('tamagotchi.stage.workbench.changes.discard') }}</span>
            </button>
          </div>
        </div>

        <details
          v-if="item.preview"
          :open="item.previewOpen"
          :class="['mt-2 rounded-md airi-surface-panel']"
        >
          <summary :class="['flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium airi-text-muted']">
            <span :class="['i-solar:document-text-bold-duotone size-3.5']" />
            <span>{{ item.previewLabel }}</span>
          </summary>
          <pre :class="['max-h-48 overflow-auto border-t airi-border-subtle p-2 font-mono text-[11px] leading-5']">{{ item.preview }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>
