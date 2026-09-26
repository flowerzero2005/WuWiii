<script setup lang="ts">
import type { GroupScriptAct } from '@proj-airi/stage-ui/stores/chat/group-script'

import { BasicTextarea, Button, FieldCheckbox, Input } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const acts = defineModel<GroupScriptAct[]>({ default: () => [] })
const { t } = useI18n()
const key = 'settings.pages.group-scripts.chapters'

function addAct() {
  if (acts.value.length >= 64)
    return
  acts.value = [...acts.value, { actId: `act-${crypto.randomUUID()}`, number: acts.value.length + 1, title: t(`${key}.act-title`, { number: acts.value.length + 1 }), goal: '', narration: '', visibility: 'visible', unlockConditions: [] }]
}

function removeAct(index: number) {
  acts.value.splice(index, 1)
  acts.value.forEach((act, index) => act.number = index + 1)
}

function addCondition(act: GroupScriptAct) {
  act.unlockConditions.push({ conditionId: `condition-${crypto.randomUUID()}`, description: '', minConfidence: 0.8, minEvidenceCount: 1 })
}
</script>

<template>
  <section :class="['airi-surface-panel flex flex-col gap-4 rounded-xl p-4 sm:p-5']">
    <div :class="['flex items-start justify-between gap-3']">
      <div>
        <h2 :class="['airi-text m-0 text-base font-semibold']">
          {{ t(`${key}.timeline`) }}
        </h2>
        <p :class="['airi-text-muted m-0 mt-1 text-xs leading-5']">
          {{ t(`${key}.timeline-description`) }}
        </p>
      </div>
      <Button size="sm" variant="secondary" :disabled="acts.length >= 64" :label="t(`${key}.add-act`)" @click="addAct" />
    </div>
    <p v-if="!acts.length" :class="['airi-text-muted text-sm']">
      {{ t(`${key}.empty`) }}
    </p>
    <article v-for="(act, index) in acts" :key="act.actId" :class="['airi-card flex flex-col gap-3 rounded-xl p-3']">
      <div :class="['flex items-center justify-between gap-2']">
        <strong :class="['airi-text text-sm']">{{ t(`${key}.act-title`, { number: act.number }) }}</strong>
        <Button size="sm" variant="ghost" :label="t('settings.pages.group-scripts.actions.remove')" @click="removeAct(index)" />
      </div>
      <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.title`) }}</span><Input v-model="act.title" /></label>
      <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.goal`) }}</span><BasicTextarea v-model="act.goal" :rows="2" /></label>
      <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.narration`) }}</span><BasicTextarea v-model="act.narration" :rows="3" /></label>
      <FieldCheckbox :model-value="act.visibility === 'hidden'" :label="t(`${key}.hidden`)" :description="t(`${key}.hidden-description`)" @update:model-value="act.visibility = $event ? 'hidden' : 'visible'" />
      <div :class="['flex items-center justify-between gap-2 border-t border-[var(--airi-border-subtle)] pt-3']">
        <span :class="['text-xs font-semibold']">{{ t(`${key}.conditions`) }}</span>
        <Button size="sm" variant="ghost" :disabled="act.unlockConditions.length >= 12" :label="t(`${key}.add-condition`)" @click="addCondition(act)" />
      </div>
      <div v-for="(condition, conditionIndex) in act.unlockConditions" :key="condition.conditionId" :class="['flex flex-col gap-2 rounded-lg border border-[var(--airi-border-subtle)] p-2']">
        <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.outcome`) }}</span><BasicTextarea v-model="condition.description" :rows="2" /></label>
        <div :class="['flex flex-wrap items-end gap-3']">
          <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.confidence`) }}</span><input v-model.number="condition.minConfidence" type="number" min="0" max="1" step="0.05" :class="['airi-card w-24 rounded-lg p-2']"></label>
          <label :class="['flex flex-col gap-1 text-xs']"><span>{{ t(`${key}.evidence-count`) }}</span><input v-model.number="condition.minEvidenceCount" type="number" min="1" max="8" :class="['airi-card w-24 rounded-lg p-2']"></label>
          <Button size="sm" variant="ghost" :label="t('settings.pages.group-scripts.actions.remove')" @click="act.unlockConditions.splice(conditionIndex, 1)" />
        </div>
      </div>
    </article>
  </section>
</template>
