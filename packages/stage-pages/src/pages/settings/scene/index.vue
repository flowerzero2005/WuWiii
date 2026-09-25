<script setup lang="ts">
import type { WorkbenchWorkStylePresetId } from '@proj-airi/stage-ui/stores/settings/workbench'

import {
  useWorkbenchSceneSettingsStore,
  WORKBENCH_WORK_STYLE_PRESETS,
} from '@proj-airi/stage-ui/stores/settings/workbench'
import { Button, FieldCheckbox, FieldRange, FieldTextArea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const workbenchSceneSettings = useWorkbenchSceneSettingsStore()
const workStylePresets = WORKBENCH_WORK_STYLE_PRESETS
const {
  activeWorkStylePresetId,
  companionWarmth,
  conciseReports,
  foldInternalDetails,
  isDefaultScene,
  promptSection,
  sceneDescription,
} = storeToRefs(workbenchSceneSettings)
const { t } = useI18n()
const displayHardRules = computed(() => [
  t('settings.pages.scene.workbench.hard-rules.rule-1'),
  t('settings.pages.scene.workbench.hard-rules.rule-2'),
  t('settings.pages.scene.workbench.hard-rules.rule-3'),
  t('settings.pages.scene.workbench.hard-rules.rule-4'),
  t('settings.pages.scene.workbench.hard-rules.rule-5'),
  t('settings.pages.scene.workbench.hard-rules.rule-6'),
])
const scenePanelClass = ['airi-card p-4']

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function applyPreset(presetId: WorkbenchWorkStylePresetId) {
  workbenchSceneSettings.applyWorkStylePreset(presetId)
}
</script>

<template>
  <div data-airi-runtime-route="/settings/scene" :class="['flex flex-col gap-4 pb-4']">
    <section
      :class="scenePanelClass"
    >
      <div :class="['grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]']">
        <div :class="['flex flex-col gap-1 md:max-w-[680px]']">
          <div :class="['flex items-center gap-2 text-lg font-medium']">
            <span :class="['i-solar:case-round-bold-duotone size-5 text-[var(--airi-accent-strong)]']" />
            <span>{{ t('settings.pages.scene.workbench.title') }}</span>
          </div>
          <p :class="['text-sm airi-text-muted']">
            {{ t('settings.pages.scene.workbench.description') }}
          </p>
        </div>
        <Button
          :disabled="isDefaultScene"
          variant="secondary"
          @click="workbenchSceneSettings.resetState()"
        >
          {{ t('settings.pages.scene.workbench.actions.restore-default') }}
        </Button>
      </div>
    </section>

    <section
      :class="scenePanelClass"
    >
      <div :class="['flex flex-col gap-5']">
        <div :class="['flex flex-col gap-1']">
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.scene.workbench.presets.title') }}
          </div>
          <p :class="['text-xs airi-text-muted']">
            {{ t('settings.pages.scene.workbench.presets.description') }}
          </p>
        </div>

        <div :class="['grid gap-2 md:grid-cols-2']">
          <Button
            v-for="preset in workStylePresets"
            :key="preset.id"
            :class="['h-full']"
            :toggled="activeWorkStylePresetId === preset.id"
            block
            variant="secondary-muted"
            @click="applyPreset(preset.id)"
          >
            <span
              :class="[
                'i-solar:stars-minimalistic-bold-duotone shrink-0 text-[var(--airi-accent-strong)]',
                'size-4',
              ]"
            />
            <span :class="['flex min-w-0 flex-col items-start gap-0.5 text-left']">
              <span :class="['text-sm font-medium']">
                {{ t(`settings.pages.scene.workbench.presets.${preset.id}.label`) }}
              </span>
              <span :class="['text-xs airi-text-muted font-normal leading-4']">
                {{ t(`settings.pages.scene.workbench.presets.${preset.id}.description`) }}
              </span>
            </span>
          </Button>
        </div>

        <div :class="['flex flex-col gap-1']">
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.scene.workbench.controls.title') }}
          </div>
          <p :class="['text-xs airi-text-muted']">
            {{ t('settings.pages.scene.workbench.controls.description') }}
          </p>
        </div>

        <div :class="['grid gap-4 md:grid-cols-2']">
          <FieldCheckbox
            v-model="conciseReports"
            :label="t('settings.pages.scene.workbench.fields.concise-reports.label')"
            :description="t('settings.pages.scene.workbench.fields.concise-reports.description')"
          />
          <FieldCheckbox
            v-model="foldInternalDetails"
            :label="t('settings.pages.scene.workbench.fields.fold-internal-details.label')"
            :description="t('settings.pages.scene.workbench.fields.fold-internal-details.description')"
          />
        </div>

        <FieldRange
          v-model="companionWarmth"
          :label="t('settings.pages.scene.workbench.fields.companion-warmth.label')"
          :description="t('settings.pages.scene.workbench.fields.companion-warmth.description')"
          :format-value="formatPercent"
          :min="0"
          :max="1"
          :step="0.05"
        />
      </div>
    </section>

    <section
      :class="scenePanelClass"
    >
      <div :class="['flex flex-col gap-3']">
        <div>
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.scene.workbench.hard-rules.title') }}
          </div>
          <p :class="['mt-1 text-xs airi-text-muted']">
            {{ t('settings.pages.scene.workbench.hard-rules.description') }}
          </p>
        </div>

        <ul :class="['grid gap-2']">
          <li
            v-for="rule in displayHardRules"
            :key="rule"
            :class="[
              'grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md bg-[var(--airi-surface-control-muted)] px-3 py-2 text-sm text-[var(--airi-text-muted)]',
            ]"
          >
            <span :class="['i-solar:shield-check-bold-duotone mt-0.5 size-4 text-emerald-500']" />
            <span>{{ rule }}</span>
          </li>
        </ul>
      </div>
    </section>

    <details
      :class="scenePanelClass"
    >
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.pages.scene.workbench.advanced.title') }}
      </summary>
      <p :class="['mt-2 text-xs airi-text-muted']">
        {{ t('settings.pages.scene.workbench.advanced.description') }}
      </p>
      <div :class="['mt-4']">
        <FieldTextArea
          v-model="sceneDescription"
          :required="false"
          :rows="7"
          textarea-class="font-mono leading-5"
          :label="t('settings.pages.scene.workbench.fields.scene-description.label')"
          :description="t('settings.pages.scene.workbench.fields.scene-description.description')"
          :placeholder="t('settings.pages.scene.workbench.fields.scene-description.placeholder')"
        />
      </div>
    </details>

    <details
      :class="scenePanelClass"
    >
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.pages.scene.workbench.prompt-preview.title') }}
      </summary>
      <p :class="['mt-2 text-xs airi-text-muted']">
        {{ t('settings.pages.scene.workbench.prompt-preview.description') }}
      </p>
      <pre
        :class="[
          'mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg',
          'border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-field)] p-3 text-xs leading-5 text-[var(--airi-text)]',
        ]"
      >{{ promptSection }}</pre>
    </details>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.scene.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.scene.description
  icon: i-solar:case-round-bold-duotone
  settingsEntry: true
  productAudience: advanced
  order: 3
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
