<script setup lang="ts">
import type { DisplayModelFile } from '../../../../stores/display-models'

import { createLive2DPerformanceExpressionResourceId, useLive2d } from '@proj-airi/stage-ui-live2d'
import { Button, Checkbox, Input, Textarea } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useDisplayModelsStore } from '../../../../stores/display-models'
import { Section } from '../../../layouts'

const props = defineProps<{
  model: DisplayModelFile
}>()

const { t } = useI18n()
const displayModelsStore = useDisplayModelsStore()
const live2dStore = useLive2d()
const actions = ref<Record<string, string>>({ ...props.model.pictureOc?.actions })
const customActionId = ref('')
const customActionPath = ref('')

const imagePaths = computed(() => props.model.pictureOc?.imagePaths ?? [])
const customActions = computed(() => Object.entries(actions.value)
  .filter(([id]) => id.startsWith('custom:'))
  .sort(([left], [right]) => left.localeCompare(right)))
const assignedPaths = computed(() => new Set(Object.values(actions.value)))
const unassignedPaths = computed(() => imagePaths.value.filter(path => !assignedPaths.value.has(path)))
const resourceMetadata = computed(() => live2dStore.performanceResourceMetadataByModel[props.model.id]?.expressions ?? {})

function resourceId(actionId: string) {
  return createLive2DPerformanceExpressionResourceId(actionId, 0)
}

function metadataFor(actionId: string) {
  return resourceMetadata.value[resourceId(actionId)] ?? {
    aiSelectable: true,
    avoidWhen: [],
    emotionTags: [],
    label: actionId.replace(/^custom:/, ''),
    parameterClaims: [],
    sceneTags: [],
    suitableWhen: [],
  }
}

function updateMetadata(actionId: string, patch: Partial<ReturnType<typeof metadataFor>>) {
  live2dStore.setPerformanceResourceMetadata(props.model.id, 'expressions', resourceId(actionId), {
    ...metadataFor(actionId),
    ...patch,
  })
}

function parseTags(value: string) {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}

watch(() => props.model.pictureOc?.actions, (next) => {
  actions.value = { ...next }
}, { deep: true })

function setActionPath(action: string, path: string) {
  const next = { ...actions.value }
  if (path)
    next[action] = path
  else
    delete next[action]
  actions.value = next
}

async function saveActions(options: { notify?: boolean } = {}) {
  if (!actions.value.idle)
    return
  const saved = await displayModelsStore.updatePictureOcActions(props.model.id, actions.value)
  if (saved && options.notify !== false)
    toast.success(t('settings.pages.models.picture_character.saved'))
}

defineExpose({
  saveActions,
})

function handleSettingsBeforeUnload() {
  void saveActions({ notify: false })
}

function addCustomAction() {
  const key = customActionId.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  if (!key || !customActionPath.value)
    return
  setActionPath(`custom:${key}`, customActionPath.value)
  customActionId.value = ''
  customActionPath.value = ''
}

onMounted(() => {
  window.addEventListener('beforeunload', handleSettingsBeforeUnload)
})

onUnmounted(() => {
  void saveActions({ notify: false })
  window.removeEventListener('beforeunload', handleSettingsBeforeUnload)
})
</script>

<template>
  <Section :title="t('settings.pages.models.picture_character.title')" icon="i-solar:gallery-wide-bold-duotone" size="sm" :expand="true">
    <div :class="['flex', 'flex-col', 'gap-4']">
      <p :class="['text-sm', 'airi-text-muted']">
        {{ t('settings.pages.models.picture_character.description') }}
      </p>

      <label :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'font-medium', 'airi-text']">{{ t('settings.pages.models.picture_character.idle') }}</span>
        <select :value="actions.idle ?? ''" :class="['airi-input-muted', 'px-2', 'py-1.5']" @change="setActionPath('idle', ($event.target as HTMLSelectElement).value)">
          <option v-for="path in imagePaths" :key="path" :value="path">
            {{ path }}
          </option>
        </select>
      </label>

      <label :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'font-medium', 'airi-text']">{{ t('settings.pages.models.picture_character.speaking') }}</span>
        <select :value="actions.speaking ?? ''" :class="['airi-input-muted', 'px-2', 'py-1.5']" @change="setActionPath('speaking', ($event.target as HTMLSelectElement).value)">
          <option value="">
            {{ t('settings.pages.models.picture_character.unassigned') }}
          </option>
          <option v-for="path in imagePaths" :key="path" :value="path">
            {{ path }}
          </option>
        </select>
      </label>

      <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]']">
        <Input v-model="customActionId" :placeholder="t('settings.pages.models.picture_character.action_name')" size="sm" variant="primary-dimmed" />
        <select v-model="customActionPath" :class="['airi-input-muted', 'px-2', 'py-1.5']">
          <option value="">
            {{ t('settings.pages.models.picture_character.select_image') }}
          </option>
          <option v-for="path in imagePaths" :key="path" :value="path">
            {{ path }}
          </option>
        </select>
        <Button size="sm" variant="secondary" :disabled="!customActionId || !customActionPath" @click="addCustomAction">
          {{ t('settings.pages.models.picture_character.add_action') }}
        </Button>
      </div>

      <div v-if="customActions.length" :class="['flex', 'flex-col', 'gap-2']">
        <div v-for="[id, path] in customActions" :key="id" :class="['flex', 'flex-col', 'gap-3', 'airi-surface-panel', 'p-3']">
          <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
            <span :class="['min-w-0', 'truncate', 'text-sm', 'airi-text']">{{ id }}: {{ path }}</span>
            <Checkbox
              :model-value="metadataFor(id).aiSelectable"
              @update:model-value="value => updateMetadata(id, { aiSelectable: Boolean(value) })"
            />
          </div>
          <Input
            :model-value="metadataFor(id).label"
            size="sm"
            variant="primary-dimmed"
            :placeholder="t('settings.pages.models.picture_character.action_label')"
            @update:model-value="value => updateMetadata(id, { label: String(value ?? '') })"
          />
          <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-2']">
            <Input
              :model-value="metadataFor(id).emotionTags.join(', ')"
              size="sm"
              variant="primary-dimmed"
              :placeholder="t('settings.pages.models.picture_character.emotion_tags')"
              @update:model-value="value => updateMetadata(id, { emotionTags: parseTags(String(value ?? '')) })"
            />
            <Input
              :model-value="metadataFor(id).sceneTags.join(', ')"
              size="sm"
              variant="primary-dimmed"
              :placeholder="t('settings.pages.models.picture_character.scene_tags')"
              @update:model-value="value => updateMetadata(id, { sceneTags: parseTags(String(value ?? '')) })"
            />
          </div>
          <Textarea
            :model-value="metadataFor(id).aiDescription ?? ''"
            :maxlength="1200"
            :class="['min-h-24']"
            :placeholder="t('settings.pages.models.picture_character.ai_description')"
            @update:model-value="value => updateMetadata(id, { aiDescription: String(value ?? '') })"
          />
          <Button
            size="sm"
            variant="secondary-muted"
            icon="i-solar:trash-bin-minimalistic-bold-duotone"
            :label="t('settings.pages.models.picture_character.remove_action')"
            @click="setActionPath(id, '')"
          />
        </div>
      </div>

      <div :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'font-medium', 'airi-text']">{{ t('settings.pages.models.picture_character.unassigned_images') }}</span>
        <span :class="['text-xs', 'airi-text-muted']">{{ unassignedPaths.length ? unassignedPaths.join(', ') : t('settings.pages.models.picture_character.none') }}</span>
      </div>

      <div :class="['flex', 'justify-end']">
        <Button size="sm" variant="secondary" @click="saveActions">
          {{ t('settings.pages.models.picture_character.save') }}
        </Button>
      </div>
    </div>
  </Section>
</template>
