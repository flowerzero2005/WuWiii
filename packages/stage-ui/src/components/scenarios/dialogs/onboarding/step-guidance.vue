<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'

import { OnboardingContextKey } from './utils'

type GuidanceSection = 'personalize' | 'voice' | 'tools' | 'data'

const props = defineProps<{ section: GuidanceSection }>()
const { t } = useI18n()
const context = inject(OnboardingContextKey)!

const itemsBySection: Record<GuidanceSection, Array<{ id: string, icon: string }>> = {
  personalize: [
    { id: 'character', icon: 'i-solar:emoji-funny-square-bold-duotone' },
    { id: 'theme', icon: 'i-solar:pallete-2-bold-duotone' },
  ],
  voice: [
    { id: 'speech', icon: 'i-solar:volume-loud-bold-duotone' },
    { id: 'microphone', icon: 'i-solar:microphone-3-bold-duotone' },
    { id: 'permission', icon: 'i-solar:shield-check-bold-duotone' },
  ],
  tools: [
    { id: 'quick-chat', icon: 'i-solar:chat-round-line-bold-duotone' },
    { id: 'butler', icon: 'i-solar:alarm-play-bold-duotone' },
    { id: 'workbench', icon: 'i-solar:case-round-bold-duotone' },
  ],
  data: [
    { id: 'storage', icon: 'i-solar:database-bold-duotone' },
    { id: 'diagnostics', icon: 'i-solar:chart-square-bold-duotone' },
    { id: 'cleanup', icon: 'i-solar:trash-bin-minimalistic-bold-duotone' },
  ],
}

const items = computed(() => itemsBySection[props.section])

function contentKey(suffix: string) {
  return `settings.dialogs.onboarding.steps.${props.section}.${suffix}`
}
</script>

<template>
  <div :class="['h-full', 'flex flex-col gap-4']">
    <div :class="['flex shrink-0 items-start gap-2']">
      <button
        type="button"
        :class="['h-8 w-8 shrink-0', 'flex items-center justify-center rounded-lg', 'hover:bg-[var(--airi-surface-control-muted)]']"
        :aria-label="t('settings.dialogs.onboarding.back')"
        @click="context.handlePreviousStep"
      >
        <div :class="['i-solar:alt-arrow-left-line-duotone h-5 w-5']" />
      </button>
      <div :class="['min-w-0 flex-1']">
        <h2 :class="['text-xl text-[var(--airi-text)] font-semibold md:text-2xl']">
          {{ t(contentKey('title')) }}
        </h2>
        <p :class="['mt-1 text-sm text-[var(--airi-text-muted)]']">
          {{ t(contentKey('description')) }}
        </p>
      </div>
    </div>

    <div :class="['min-h-0 flex-1 overflow-y-auto', 'grid grid-cols-1 gap-3']">
      <div
        v-for="item in items"
        :key="item.id"
        :class="['rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-4', 'flex items-start gap-3']"
      >
        <div :class="[item.icon, 'mt-0.5 shrink-0 text-xl text-[var(--airi-accent-text)]']" />
        <div :class="['min-w-0 flex-1']">
          <h3 :class="['text-sm text-[var(--airi-text)] font-semibold']">
            {{ t(contentKey(`items.${item.id}.title`)) }}
          </h3>
          <p :class="['mt-1 text-sm text-[var(--airi-text-muted)]']">
            {{ t(contentKey(`items.${item.id}.description`)) }}
          </p>
          <div :class="['mt-2 flex items-center gap-1 text-xs text-[var(--airi-text-soft)]']">
            <div :class="['i-solar:map-point-wave-bold-duotone shrink-0']" />
            <span>{{ t(contentKey(`items.${item.id}.location`)) }}</span>
          </div>
        </div>
      </div>
    </div>

    <Button :label="t('settings.dialogs.onboarding.next')" @click="context.handleNextStep()" />
  </div>
</template>
