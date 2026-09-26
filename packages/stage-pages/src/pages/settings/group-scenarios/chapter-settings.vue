<script setup lang="ts">
import type { GroupRoomScriptState } from '@proj-airi/stage-ui/stores/chat/group-script'
import type { GroupScriptRuntimeCommand } from '@proj-airi/stage-ui/stores/chat/group-script-runtime'

import { useGroupScriptJobs } from '@proj-airi/stage-ui/composables/use-group-script-jobs'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS } from '@proj-airi/stage-ui/stores/chat/group-script'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { summarizeChatHistoryMessage } from '@proj-airi/stage-ui/utils/chat-message-summary'
import { Button, DoubleCheckButton, FieldCheckbox } from '@proj-airi/ui'
import { useNow } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ sessionId: string, state: GroupRoomScriptState, revision: number }>()
const emit = defineEmits<{ updated: [] }>()
const { t, locale } = useI18n()
const key = 'settings.pages.group-scripts.chapters'
const session = useChatSessionStore()
const consciousness = useConsciousnessStore()
const consent = useOfficialCapabilityConsentStore()
const auth = useAuthStore()
const jobs = useGroupScriptJobs(() => props.sessionId)
const settings = ref({ ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, ...props.state.chapterSettings })
const saving = ref(false)
const error = ref('')
const current = computed(() => props.state.templateSnapshot.acts?.find(act => act.actId === props.state.progress?.currentActId))
const draft = computed(() => props.state.chapterRuntime?.sequelDraft)
const official = computed(() => consciousness.activeProvider === 'official-cloud')
const quote = computed(() => consent.getQuote('group-script', { modelId: consciousness.activeModel }))
const needsConsent = computed(() => official.value && (!auth.isAuthenticated || !quote.value || consent.needsConsent(auth.userId, 'group-script', quote.value)))
const price = computed(() => {
  const display = quote.value?.display
  return display?.billingMode === 'model-usage' ? t(`${key}.price`, { model: display.modelId, minimum: display.minimumPoints, points: display.pointsPerTokenUnit, unit: display.tokenUnit, multiplier: display.multiplier }) : t(`${key}.price-unavailable`)
})
const sourceTurn = computed(() => session.getSessionMessages(props.sessionId).findLast(message => message.role === 'user' && message.id))
const progressHistory = computed(() => [...(props.state.progress?.history ?? [])].reverse())
const now = useNow({ interval: 1000 })
const liveJob = computed(() => !!props.state.chapterRuntime?.pendingJob && props.state.chapterRuntime.pendingJob.expiresAt > now.value.getTime())
const expiredJob = computed(() => !!props.state.chapterRuntime?.pendingJob && !liveJob.value)
function actTitle(id?: string) {
  return [...(props.state.templateSnapshot.acts ?? []), ...(draft.value?.acts.map(item => item.act) ?? [])].find(act => act.actId === id)?.title ?? t(`${key}.complete`)
}
function roleName(id: string) {
  return props.state.templateSnapshot.slots.find(slot => slot.slotId === id)?.name ?? t(`${key}.unknown-role`)
}
function evidenceExcerpt(id: string) {
  const message = session.getSessionMessages(props.sessionId).find(message => message.id === id)
  return message ? summarizeChatHistoryMessage(message, { maxLength: 180, toolLimit: 0 }) : t(`${key}.evidence-removed`)
}
watch(() => props.state, state => settings.value = { ...DEFAULT_GROUP_SCRIPT_CHAPTER_SETTINGS, ...state.chapterSettings })

function acceptPrice() {
  if (auth.isAuthenticated && quote.value)
    consent.accept(auth.userId, 'group-script', quote.value)
}

async function saveSettings() {
  if (saving.value || ((settings.value.automaticEvaluationEnabled || settings.value.sequelGenerationEnabled) && needsConsent.value))
    return
  saving.value = true
  error.value = ''
  try {
    await session.updateGroupRoomScript(props.sessionId, { ...props.state, chapterSettings: { ...settings.value } }, props.revision)
    emit('updated')
  }
  catch {
    error.value = t(`${key}.save-failed`)
  }
  finally {
    saving.value = false
  }
}

async function command(input: GroupScriptRuntimeCommand) {
  if (saving.value)
    return
  jobs.cancel()
  saving.value = true
  error.value = ''
  try {
    await session.executeGroupScriptCommand(props.sessionId, props.revision, input)
    emit('updated')
  }
  catch {
    error.value = t(`${key}.save-failed`)
  }
  finally {
    saving.value = false
  }
}

function progressCommand(type: 'restart' | 'rollback' | 'restore', revision?: number) {
  return command({ type, operationId: `chapter-${crypto.randomUUID()}`, at: Date.now(), revision, actId: type === 'restart' ? current.value?.actId ?? props.state.templateSnapshot.acts?.at(-1)?.actId : undefined })
}

function draftCommand(type: 'accept' | 'discard') {
  if (draft.value)
    return command({ type, requestId: draft.value.requestId, operationId: `chapter-${crypto.randomUUID()}`, at: Date.now() })
}

async function generate() {
  const turn = sourceTurn.value
  if (!turn?.id || needsConsent.value)
    return
  error.value = ''
  try {
    await jobs.run('sequel', { sessionId: props.sessionId, turnId: turn.id, language: locale.value })
    emit('updated')
  }
  catch (cause) {
    if (!(cause instanceof DOMException) || cause.name !== 'AbortError')
      error.value = t(`${key}.generation-failed`)
  }
}
</script>

<template>
  <section v-if="state.progress" :class="['flex flex-col gap-4 border-t border-[var(--airi-border-subtle)] pt-4']">
    <div>
      <h3 :class="['airi-text m-0 text-base font-semibold']">
        {{ t(`${key}.progress`) }}
      </h3>
      <p :class="['airi-text-muted text-sm']">
        {{ state.progress.isComplete ? t(`${key}.complete`) : t(`${key}.current`, { number: current?.number, title: current?.title }) }}
      </p>
      <p v-if="current?.goal" :class="['airi-text text-sm']">
        {{ current.goal }}
      </p>
      <ul v-if="current?.unlockConditions.length" :class="['airi-text-muted m-0 pl-5 text-xs leading-6']">
        <li v-for="condition in current.unlockConditions" :key="condition.conditionId">
          {{ condition.description }} · {{ t(`${key}.threshold`, { confidence: condition.minConfidence ?? 0.75, count: condition.minEvidenceCount ?? 1 }) }}
        </li>
      </ul>
    </div>
    <div :class="['airi-card flex flex-col gap-3 rounded-xl p-3']">
      <p :class="['airi-text-muted m-0 text-xs leading-5']">
        {{ official ? price : t(`${key}.own-provider`) }}
      </p>
      <p :class="['airi-text-muted m-0 text-xs leading-5']">
        {{ t(`${key}.billing-description`) }}
      </p>
      <DoubleCheckButton v-if="needsConsent" size="sm" :disabled="!auth.isAuthenticated || !quote" @confirm="acceptPrice">
        {{ t(`${key}.consent`) }}
        <template #confirm>
          {{ t(`${key}.confirm-consent`) }}
        </template>
        <template #cancel>
          {{ t('settings.pages.group-scripts.actions.cancel') }}
        </template>
      </DoubleCheckButton>
      <FieldCheckbox v-model="settings.automaticEvaluationEnabled" :disabled="needsConsent" :label="t(`${key}.automatic`)" :description="t(`${key}.automatic-description`)" />
      <FieldCheckbox v-model="settings.showActNarration" :label="t(`${key}.show-narration`)" :description="t(`${key}.show-narration-description`)" />
      <FieldCheckbox v-model="settings.sequelGenerationEnabled" :disabled="needsConsent" :label="t(`${key}.sequel-enabled`)" :description="t(`${key}.sequel-description`)" />
      <label :class="['flex items-center gap-3 text-xs']"><span>{{ t(`${key}.maximum`) }}</span><input v-model.number="settings.maxGeneratedActs" type="number" min="1" max="8" :class="['airi-card w-20 rounded-lg p-2']"></label>
      <Button size="sm" :loading="saving" :disabled="needsConsent && (settings.automaticEvaluationEnabled || settings.sequelGenerationEnabled)" :label="t(`${key}.save-settings`)" @click="saveSettings" />
    </div>
    <div :class="['flex flex-wrap gap-2']">
      <DoubleCheckButton size="sm" :disabled="saving" @confirm="progressCommand('restart')">
        {{ t(`${key}.restart`) }}
        <template #confirm>
          {{ t(`${key}.confirm-progress`) }}
        </template>
        <template #cancel>
          {{ t('settings.pages.group-scripts.actions.cancel') }}
        </template>
      </DoubleCheckButton>
      <DoubleCheckButton size="sm" :disabled="saving || !state.progress.completedActIds.length" @confirm="progressCommand('rollback')">
        {{ t(`${key}.rollback`) }}
        <template #confirm>
          {{ t(`${key}.confirm-progress`) }}
        </template>
        <template #cancel>
          {{ t('settings.pages.group-scripts.actions.cancel') }}
        </template>
      </DoubleCheckButton>
      <Button v-if="jobs.pending.value" size="sm" variant="ghost" :label="t('settings.pages.group-scripts.actions.cancel')" @click="jobs.cancel" />
    </div>
    <details :class="['airi-card rounded-xl p-3']">
      <summary :class="['cursor-pointer text-sm font-semibold']">
        {{ t(`${key}.history`, { revision: state.progress.revision }) }}
      </summary>
      <p :class="['airi-text-muted text-xs']">
        {{ t(`${key}.history-description`) }}
      </p>
      <article v-for="snapshot in progressHistory" :key="snapshot.revision" :class="['flex flex-wrap items-center justify-between gap-2 border-t border-[var(--airi-border-subtle)] py-2 text-xs']">
        <span>{{ t(`${key}.revision`, { revision: snapshot.revision }) }} · {{ t(`${key}.actions.${snapshot.action}`) }} · {{ actTitle(snapshot.currentActId) }}</span>
        <Button size="sm" variant="ghost" :disabled="saving || snapshot.revision === state.progress.revision" :label="t(`${key}.restore`)" @click="progressCommand('restore', snapshot.revision)" />
      </article>
      <article v-for="evaluation in state.chapterRuntime?.evaluations" :key="evaluation.turnId" :class="['border-t border-[var(--airi-border-subtle)] py-2 text-xs']">
        <p>{{ actTitle(evaluation.actId) }} · {{ t(`${key}.results.${evaluation.result}`) }}</p>
        <div v-for="condition in evaluation.conditions" :key="condition.conditionId" :class="['airi-text-muted']">
          <p>{{ condition.summary }} · {{ t(`${key}.evidence-confidence`, { confidence: condition.confidence }) }}</p>
          <blockquote v-for="messageId in condition.messageIds" :key="messageId" :class="['m-0 my-1 border-l-2 border-[var(--airi-border-accent)] pl-2']">
            {{ evidenceExcerpt(messageId) }}
          </blockquote>
        </div>
      </article>
    </details>
    <div :class="['airi-card flex flex-col gap-3 rounded-xl p-3']">
      <h4 :class="['m-0 text-sm font-semibold']">
        {{ t(`${key}.sequel`) }}
      </h4>
      <p :class="['airi-text-muted m-0 text-xs']">
        {{ t(`${key}.generation-basis`, { revision: state.progress.revision, count: state.chapterSettings?.maxGeneratedActs ?? 2 }) }}
      </p>
      <Button size="sm" :loading="jobs.pending.value" :disabled="saving || needsConsent || !state.chapterSettings?.sequelGenerationEnabled || !sourceTurn || !!draft || liveJob" :label="t(`${key}.generate`)" @click="generate" />
      <p v-if="liveJob" :class="['airi-text-muted text-xs']">
        {{ t(`${key}.job-running`) }}
      </p>
      <p v-else-if="expiredJob" :class="['airi-text-muted text-xs']">
        {{ t(`${key}.job-expired`) }}
      </p>
      <p v-if="!sourceTurn" :class="['airi-text-muted text-xs']">
        {{ t(`${key}.conversation-required`) }}
      </p>
      <template v-if="draft">
        <p :class="['airi-text text-sm']">
          {{ draft.summary }}
        </p>
        <article v-for="proposal in draft.acts" :key="proposal.act.actId" :class="['rounded-lg border border-[var(--airi-border-subtle)] p-3 text-xs']">
          <strong>{{ proposal.act.number }} · {{ proposal.act.title }}</strong>
          <p>{{ proposal.act.goal }}</p><p>{{ proposal.act.narration }}</p>
          <p :class="['airi-text-muted']">
            {{ t(`${key}.draft-roles`) }}: {{ proposal.roleSlotIds.map(roleName).join(', ') }}
          </p>
          <p :class="['airi-text-muted']">
            {{ t(`${key}.draft-after`) }}: {{ actTitle(proposal.afterActId) }} · {{ proposal.prerequisiteActIds.map(actTitle).join(', ') }}
          </p>
          <ul :class="['pl-4']">
            <li v-for="condition in proposal.act.unlockConditions" :key="condition.conditionId">
              {{ condition.description }}
            </li>
          </ul>
        </article>
        <div :class="['flex gap-2']">
          <Button size="sm" :disabled="saving" :label="t(`${key}.accept-draft`)" @click="draftCommand('accept')" /><Button size="sm" variant="ghost" :disabled="saving" :label="t(`${key}.discard-draft`)" @click="draftCommand('discard')" />
        </div>
      </template>
    </div>
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </section>
</template>
