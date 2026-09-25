<script setup lang="ts">
import { fetchOfficialCapabilityAvailability } from '@proj-airi/stage-ui/libs/official-capabilities'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useMemoryAdvancedSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-advanced'
import { FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const memoryAdvancedStore = useMemoryAdvancedSettingsStore()
const { settings } = storeToRefs(memoryAdvancedStore)
const embeddingAvailability = ref<'checking' | 'available' | 'unavailable'>('checking')
const officialPricingStore = useOfficialPricingStore()
officialPricingStore.start()
onUnmounted(() => officialPricingStore.stop())
const embeddingPoints = computed(() => officialPricingStore.getCapability('embedding')?.pointsPerRequest)

onMounted(async () => {
  try {
    embeddingAvailability.value = await fetchOfficialCapabilityAvailability('airi-embedding')
  }
  catch {
    embeddingAvailability.value = 'unavailable'
  }
})

function updateOfficialCloudEmbedding(enabled: boolean) {
  if (enabled && embeddingAvailability.value !== 'available')
    return
  settings.value.enableOfficialCloudEmbedding = enabled
}
</script>

<template>
  <div :class="['mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 sm:p-6']">
    <header :class="['flex items-start gap-3']">
      <span :class="['i-solar:shield-user-bold-duotone mt-0.5 size-6 shrink-0 text-[var(--airi-accent-text)]']" />
      <div>
        <h2 :class="['text-lg font-semibold']">
          {{ t('tamagotchi.settings.pages.system.memory-advanced.info.title') }}
        </h2>
        <p :class="['mt-1 max-w-3xl text-sm airi-text-muted']">
          {{ t('tamagotchi.settings.pages.system.memory-advanced.info.description') }}
        </p>
      </div>
    </header>

    <section :class="['overflow-hidden rounded-lg border airi-border-subtle airi-surface-panel']">
      <div :class="['border-b px-4 py-3 airi-border-subtle']">
        <h3 :class="['text-sm font-semibold']">
          {{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.title') }}
        </h3>
        <p :class="['mt-1 text-xs airi-text-muted']">
          {{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.description') }}
        </p>
      </div>
      <div :class="['grid gap-px md:grid-cols-3']">
        <div :class="['flex items-start gap-3 p-4']">
          <span :class="['i-solar:user-id-bold-duotone mt-0.5 size-5 shrink-0 text-[var(--airi-accent-text)]']" />
          <div>
            <div :class="['flex flex-wrap items-center gap-2']">
              <span :class="['text-sm font-medium']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.persona.title') }}</span>
              <span :class="['rounded-full px-2 py-0.5 text-xs airi-status-success']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.persona.status') }}</span>
            </div>
            <p :class="['mt-1 text-xs airi-text-muted']">
              {{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.persona.description') }}
            </p>
          </div>
        </div>
        <div :class="['flex items-start gap-3 border-t p-4 airi-border-subtle md:border-l md:border-t-0']">
          <span :class="['i-solar:chat-round-line-bold-duotone mt-0.5 size-5 shrink-0']" />
          <div>
            <div :class="['flex flex-wrap items-center gap-2']">
              <span :class="['text-sm font-medium']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.room.title') }}</span>
              <span :class="['rounded-full px-2 py-0.5 text-xs airi-status-info']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.room.status') }}</span>
            </div>
            <p :class="['mt-1 text-xs airi-text-muted']">
              {{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.room.description') }}
            </p>
          </div>
        </div>
        <div :class="['flex items-start gap-3 border-t p-4 airi-border-subtle md:border-l md:border-t-0']">
          <span :class="['i-solar:lock-keyhole-bold-duotone mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300']" />
          <div>
            <div :class="['flex flex-wrap items-center gap-2']">
              <span :class="['text-sm font-medium']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.group.title') }}</span>
              <span :class="['rounded-full px-2 py-0.5 text-xs airi-status-warning']">{{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.group.status') }}</span>
            </div>
            <p :class="['mt-1 text-xs airi-text-muted']">
              {{ t('tamagotchi.settings.pages.system.memory-advanced.scope-overview.group.description') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- 阶段1: 记忆隔离 -->
    <section :class="['flex flex-col gap-3 border-t pt-6 airi-border-subtle']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.memory-advanced.isolation.title') }}
      </h3>
      <FieldCheckbox
        v-model="settings.enableMultiUser"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.isolation.multi-user.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.isolation.multi-user.description')"
      />
      <div
        v-if="settings.enableMultiUser"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :class="['ml-4 flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20']"
      >
        <span :class="['i-solar:info-circle-bold mt-0.5 size-4 shrink-0 text-yellow-700 dark:text-yellow-300']" />
        <p :class="['text-sm text-yellow-800 dark:text-yellow-200']">
          {{ t('tamagotchi.settings.pages.system.memory-advanced.isolation.multi-user.warning') }}
        </p>
      </div>
    </section>

    <!-- 阶段2: 语义理解 -->
    <section :class="['flex flex-col gap-3 border-t pt-6 airi-border-subtle']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.memory-advanced.semantic.title') }}
      </h3>
      <FieldCheckbox
        v-model="settings.enableSemanticSearch"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="50"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.semantic.search.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.semantic.search.description')"
      />
      <div :class="[embeddingAvailability !== 'available' && !settings.enableOfficialCloudEmbedding ? 'pointer-events-none opacity-60' : '']">
        <FieldCheckbox
          v-motion
          :model-value="settings.enableOfficialCloudEmbedding"
          :initial="{ opacity: 0, y: 10 }"
          :enter="{ opacity: 1, y: 0 }"
          :duration="250"
          :delay="75"
          :label="t('tamagotchi.settings.pages.system.memory-advanced.semantic.official-cloud-embedding.label')"
          :description="t('tamagotchi.settings.pages.system.memory-advanced.semantic.official-cloud-embedding.description')"
          @update:model-value="updateOfficialCloudEmbedding"
        />
      </div>
      <p
        :class="[
          'rounded-md border px-3 py-2 text-xs',
          embeddingAvailability === 'available' ? 'airi-status-success' : 'airi-status-warning',
        ]"
        role="status"
      >
        {{ t(`tamagotchi.settings.pages.system.memory-advanced.semantic.official-cloud-embedding.status.${embeddingAvailability}`) }}
      </p>
      <p :class="['text-xs airi-text-muted']">
        {{ embeddingPoints === undefined
          ? t('tamagotchi.settings.pages.system.memory-advanced.semantic.official-cloud-embedding.pricing.loading')
          : t('tamagotchi.settings.pages.system.memory-advanced.semantic.official-cloud-embedding.pricing.official', { points: embeddingPoints }) }}
      </p>
      <FieldCheckbox
        v-model="settings.enableSmartValueJudgment"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="100"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.semantic.value-judgment.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.semantic.value-judgment.description')"
      />
      <FieldCheckbox
        v-model="settings.enableReplyFeedbackLearning"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="125"
        :label="t('settings.pages.reply-feedback.learning.toggle')"
        :description="t('settings.pages.reply-feedback.learning.description')"
      />
    </section>

    <!-- 阶段3: 自然对话 -->
    <section :class="['flex flex-col gap-3 border-t pt-6 airi-border-subtle']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.memory-advanced.natural.title') }}
      </h3>
      <FieldCheckbox
        v-model="settings.enableConversationInit"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="150"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.conversation-init.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.conversation-init.description')"
      />
      <FieldCheckbox
        v-model="settings.enableInnerVoiceNotePrewarm"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="175"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.inner-voice-prewarm.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.inner-voice-prewarm.description')"
      />
      <FieldCheckbox
        v-model="settings.enableNaturalOutput"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="200"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.output.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.output.description')"
      />
      <FieldRange
        v-if="settings.enableNaturalOutput"
        v-model="settings.naturalOutputDelay"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :min="100"
        :max="1000"
        :step="50"
        :class="['ml-4']"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.output-delay.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.output-delay.description')"
      />
      <FieldCheckbox
        v-model="settings.enableSemanticSegmentation"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="250"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.semantic-segmentation.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.semantic-segmentation.description')"
      >
        <template #badge>
          <span :class="['text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400']">
            {{ t('tamagotchi.settings.pages.system.memory-advanced.natural.semantic-segmentation.badge') }}
          </span>
        </template>
      </FieldCheckbox>
      <FieldRange
        v-model="settings.bubbleDelayMs"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="300"
        :min="500"
        :max="5000"
        :step="100"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.bubble-delay.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.bubble-delay.description')"
      />
      <FieldCheckbox
        v-model="settings.enableAdaptiveBubbleDelay"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="350"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.adaptive-bubble-delay.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.adaptive-bubble-delay.description')"
      />
      <FieldRange
        v-model="settings.typingSpeed"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="400"
        :min="10"
        :max="100"
        :step="5"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.natural.typing-speed.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.natural.typing-speed.description')"
      />
    </section>

    <!-- 阶段4: 消息处理 -->
    <section :class="['flex flex-col gap-3 border-t pt-6 airi-border-subtle']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.memory-advanced.message.title') }}
      </h3>
      <FieldCheckbox
        v-model="settings.enableMessageMerging"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="400"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.message.merging.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.message.merging.description')"
      >
        <template #badge>
          <span :class="['text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400']">
            {{ t('tamagotchi.settings.pages.system.memory-advanced.message.merging.badge') }}
          </span>
        </template>
      </FieldCheckbox>
      <FieldRange
        v-if="settings.enableMessageMerging"
        v-model="settings.messageMergeDelay"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :min="1000"
        :max="5000"
        :step="500"
        :class="['ml-4']"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.message.merge-delay.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.message.merge-delay.description')"
      />
    </section>

    <!-- 阶段5: 主动话题 -->
    <section :class="['flex flex-col gap-3 border-t pt-6 airi-border-subtle']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.title') }}
        <span :class="['text-xs text-red-500 ml-2']">{{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.experimental') }}</span>
      </h3>
      <FieldCheckbox
        v-model="settings.enableProactiveTopic"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="250"
        :label="t('tamagotchi.settings.pages.system.memory-advanced.proactive.enable.label')"
        :description="t('tamagotchi.settings.pages.system.memory-advanced.proactive.enable.description')"
      />
      <div
        v-if="settings.enableProactiveTopic"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :class="['ml-4 flex flex-col gap-4 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800']"
      >
        <FieldCheckbox
          v-model="settings.proactiveRandomInterval"
          :label="t('tamagotchi.settings.pages.system.memory-advanced.proactive.random-interval.label')"
          :description="t('tamagotchi.settings.pages.system.memory-advanced.proactive.random-interval.description')"
        >
          <template #badge>
            <span :class="['text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400']">
              {{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.random-interval.badge') }}
            </span>
          </template>
        </FieldCheckbox>

        <FieldRange
          v-if="!settings.proactiveRandomInterval"
          v-model="settings.proactiveCheckInterval"
          :min="1"
          :max="60"
          :step="1"
          :label="t('tamagotchi.settings.pages.system.memory-advanced.proactive.interval.label')"
          :description="t('tamagotchi.settings.pages.system.memory-advanced.proactive.interval.description')"
        />

        <div v-if="settings.proactiveRandomInterval" :class="['flex flex-col gap-3']">
          <FieldRange
            v-model="settings.proactiveMinInterval"
            :min="1"
            :max="30"
            :step="1"
            :label="t('tamagotchi.settings.pages.system.memory-advanced.proactive.min-interval.label')"
            :description="t('tamagotchi.settings.pages.system.memory-advanced.proactive.min-interval.description')"
          />
          <FieldRange
            v-model="settings.proactiveMaxInterval"
            :min="settings.proactiveMinInterval + 1"
            :max="60"
            :step="1"
            :label="t('tamagotchi.settings.pages.system.memory-advanced.proactive.max-interval.label')"
            :description="t('tamagotchi.settings.pages.system.memory-advanced.proactive.max-interval.description')"
          />
        </div>

        <div>
          <label :class="['text-sm font-medium mb-2 block text-neutral-800 dark:text-neutral-200']">
            {{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.time-range.label') }}
          </label>
          <div :class="['flex gap-2 items-center']">
            <input
              v-model.number="settings.proactiveTimeRange.start"
              type="number"
              :min="0"
              :max="23"
              :class="['w-20 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200']"
            >
            <span>-</span>
            <input
              v-model.number="settings.proactiveTimeRange.end"
              type="number"
              :min="0"
              :max="23"
              :class="['w-20 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200']"
            >
            <span :class="['text-sm text-neutral-500']">{{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.time-range.unit') }}</span>
          </div>
          <p :class="['text-xs text-neutral-600 dark:text-neutral-400 mt-1']">
            {{ t('tamagotchi.settings.pages.system.memory-advanced.proactive.time-range.description') }}
          </p>
        </div>
      </div>
    </section>

    <!-- 重置按钮 -->
    <div>
      <button
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="300"
        type="button"
        :class="['inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400']"
        @click="memoryAdvancedStore.resetToDefaults()"
      >
        <span :class="['i-solar:restart-bold-duotone size-4']" />
        {{ t('tamagotchi.settings.pages.system.memory-advanced.reset') }}
      </button>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.memory-advanced.title
  descriptionKey: tamagotchi.settings.pages.system.memory-advanced.description
  subtitleKey: settings.title
  settingsEntry: true
  productAudience: advanced
  order: 25
  icon: i-solar:settings-bold-duotone
  stageTransition:
    name: slide
</route>
