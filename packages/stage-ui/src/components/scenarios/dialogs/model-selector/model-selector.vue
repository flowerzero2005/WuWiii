<script setup lang="ts">
import type { DisplayModel } from '../../../../stores/display-models'

import { useLive2d } from '@proj-airi/stage-ui-live2d'
import { Button, DoubleCheckButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger, EditableArea, EditableEditTrigger, EditableInput, EditablePreview, EditableRoot, EditableSubmitTrigger } from 'reka-ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useDisplayModelFileDialog } from '../../../../composables/use-display-model-file-dialog'
import { DisplayModelFormat, useDisplayModelsStore } from '../../../../stores/display-models'
import { DEFAULT_STAGE_MODEL_ID, useSettingsLive2d, useSettingsStageModel } from '../../../../stores/settings'

const emits = defineEmits<{ (e: 'close', value: void): void }>()
const selectedModel = defineModel<DisplayModel | undefined>({ type: Object, required: false })

const displayModelStore = useDisplayModelsStore()
const stageModelSettings = useSettingsStageModel()
const live2dSettings = useSettingsLive2d()
const live2dStore = useLive2d()
const { displayModelsFromIndexedDBLoading, displayModels } = storeToRefs(displayModelStore)
const { t } = useI18n()
const highlightDisplayModelCard = ref<string | undefined>(selectedModel.value?.id)

async function handleRemoveModel(model: DisplayModel) {
  if (model.type !== 'file')
    return

  if (stageModelSettings.stageModelSelected === model.id) {
    stageModelSettings.stageModelSelected = DEFAULT_STAGE_MODEL_ID
    await stageModelSettings.updateStageModel()
    selectedModel.value = await displayModelStore.getDisplayModel(DEFAULT_STAGE_MODEL_ID)
    highlightDisplayModelCard.value = DEFAULT_STAGE_MODEL_ID
  }

  await displayModelStore.removeDisplayModel(model.id)
  live2dStore.removeModelConfiguration(model.id)
  live2dSettings.removeModelMotionSettings(model.id)
}

function handleRenameModel(model: DisplayModel, name: string | null | undefined) {
  if (model.type === 'file' && name)
    void displayModelStore.renameDisplayModel(model.id, name)
}

const importingFormat = ref<DisplayModelFormat>()

async function handleAddModel(format: DisplayModelFormat.Live2dZip | DisplayModelFormat.VRM, file: File) {
  const expectedExtension = format === DisplayModelFormat.Live2dZip ? '.zip' : '.vrm'
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    toast.error(`Expected a ${expectedExtension} file.`)
    return
  }

  importingFormat.value = format
  try {
    const model = await displayModelStore.addDisplayModel(format, file)
    highlightDisplayModelCard.value = model.id
    toast.success(t('settings.pages.models.model-selector.import_success', { name: model.name }))
  }
  catch (error) {
    console.error('[ModelSelector] Failed to import display model:', error)
    toast.error(error instanceof Error ? error.message : String(error))
  }
  finally {
    importingFormat.value = undefined
  }
}

function handlePick(m: DisplayModel) {
  selectedModel.value = m
  emits('close', undefined)
}

function handleMobilePick() {
  selectedModel.value = displayModels.value.find(model => model.id === highlightDisplayModelCard.value)
  emits('close', undefined)
}

async function handleAddPictureOcPackage(file: File) {
  if (!file.name.toLowerCase().endsWith('.zip'))
    return

  importingFormat.value = DisplayModelFormat.PictureOcZip
  try {
    const model = await displayModelStore.addPictureOcPackage(file)
    highlightDisplayModelCard.value = model.id
    toast.success(t('settings.pages.models.model-selector.picture_oc_import_success', { name: model.name }))
  }
  catch (error) {
    console.error('[ModelSelector] Failed to import picture OC package:', error)
    toast.error(t('settings.pages.models.model-selector.picture_oc_import_failed'))
  }
  finally {
    importingFormat.value = undefined
  }
}

const mapFormatRenderer: Record<DisplayModelFormat, string> = {
  [DisplayModelFormat.Live2dZip]: 'Live2D',
  [DisplayModelFormat.Live2dDirectory]: 'Live2D',
  [DisplayModelFormat.VRM]: 'VRM',
  [DisplayModelFormat.PMXDirectory]: 'MMD',
  [DisplayModelFormat.PMXZip]: 'MMD',
  [DisplayModelFormat.PMD]: 'MMD',
  [DisplayModelFormat.PictureOcZip]: 'Picture OC',
}

const live2dDialog = useDisplayModelFileDialog({
  accept: '.zip',
  kind: 'live2d',
  onChange: file => void handleAddModel(DisplayModelFormat.Live2dZip, file),
  onError: error => toast.error(error instanceof Error ? error.message : String(error)),
})
const vrmDialog = useDisplayModelFileDialog({
  accept: '.vrm',
  kind: 'vrm',
  onChange: file => void handleAddModel(DisplayModelFormat.VRM, file),
  onError: error => toast.error(error instanceof Error ? error.message : String(error)),
})
const pictureOcDialog = useDisplayModelFileDialog({
  accept: '.zip',
  kind: 'picture-oc',
  onChange: file => void handleAddPictureOcPackage(file),
  onError: error => toast.error(error instanceof Error ? error.message : String(error)),
})
</script>

<template>
  <div pt="4 sm:0" gap="4 sm:6" h-full flex flex-col>
    <div flex items-center>
      <div w-full flex-1 text-xl>
        {{ t('settings.pages.models.model-selector.title') }}
      </div>
      <div>
        <DropdownMenuRoot>
          <DropdownMenuTrigger
            bg="neutral-400/20 hover:neutral-400/45 active:neutral-400/60 dark:neutral-700/50 hover:dark:neutral-700/65 active:dark:neutral-700/90"
            flex items-center justify-center gap-1 rounded-lg px-2 py-1 backdrop-blur-sm
            transition="colors duration-200 ease-in-out"
            :aria-label="t('settings.pages.models.model-selector.options')"
            :disabled="Boolean(importingFormat)"
          >
            <div :class="importingFormat ? 'i-svg-spinners:ring-resize' : 'i-solar:add-circle-bold'" />
            <div>{{ importingFormat ? t('settings.pages.models.model-selector.loading') : t('settings.pages.models.model-selector.add') }}</div>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="will-change-[opacity,transform] z-10000 max-w-45 rounded-lg p-0.5 shadow-md outline-none data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade data-[side=right]:animate-slideLeftAndFade data-[side=top]:animate-slideDownAndFade"
              bg="neutral-100/50 dark:neutral-950/50"
              transition="colors duration-200 ease-in-out"
              backdrop-blur-sm
              align="end"
              side="bottom"
              :side-offset="8"
            >
              <DropdownMenuItem
                :class="[
                  'data-[disabled]:text-mauve8 relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 leading-none outline-none data-[disabled]:pointer-events-none',
                  'text-base sm:text-sm',
                  'data-[highlighted]:bg-primary-300/20 dark:data-[highlighted]:bg-primary-100/20',
                  'data-[highlighted]:text-primary-400 dark:data-[highlighted]:text-primary-200',
                ]"
                transition="colors duration-200 ease-in-out"
                @click="live2dDialog.open()"
              >
                Live2D
              </DropdownMenuItem>
              <DropdownMenuItem
                :class="[
                  'data-[disabled]:text-mauve8 relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 leading-none outline-none data-[disabled]:pointer-events-none',
                  'text-base sm:text-sm',
                  'data-[highlighted]:bg-primary-300/20 dark:data-[highlighted]:bg-primary-100/20',
                  'data-[highlighted]:text-primary-400 dark:data-[highlighted]:text-primary-200',
                ]"
                transition="colors duration-200 ease-in-out" @click="vrmDialog.open()"
              >
                VRM
              </DropdownMenuItem>
              <DropdownMenuItem
                :class="[
                  'data-[disabled]:text-mauve8 relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 leading-none outline-none data-[disabled]:pointer-events-none',
                  'text-base sm:text-sm',
                  'data-[highlighted]:bg-primary-300/20 dark:data-[highlighted]:bg-primary-100/20',
                  'data-[highlighted]:text-primary-400 dark:data-[highlighted]:text-primary-200',
                ]"
                transition="colors duration-200 ease-in-out"
                @click="pictureOcDialog.open()"
              >
                {{ t('settings.pages.models.model-selector.picture_oc') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </div>
    <div v-if="displayModelsFromIndexedDBLoading">
      {{ t('settings.pages.models.model-selector.loading') }}
    </div>
    <div class="flex-1 overflow-x-auto overflow-y-hidden md:flex-none sm:overflow-x-hidden sm:overflow-y-scroll" h-full w-full>
      <div class="w-full flex gap-2 md:grid lg:grid-cols-2 md:grid-cols-1 lg:max-h-80dvh">
        <div
          v-for="(model) of displayModels"
          :key="model.id"
          v-auto-animate
          relative gap-2
          class="block w-[min(80vw,20rem)] shrink-0 md:min-w-0 md:w-full md:flex md:flex-row"
          role="button"
          tabindex="0"
          :aria-label="`${model.name}, ${mapFormatRenderer[model.format]}`"
          @click="() => highlightDisplayModelCard = model.id"
          @keydown.enter.prevent="handlePick(model)"
          @keydown.space.prevent="handlePick(model)"
        >
          <div v-if="model.type === 'file'" absolute left-3 top-4 z-1>
            <DoubleCheckButton size="sm" variant="danger" @click.stop @confirm="handleRemoveModel(model)">
              <div i-solar:trash-bin-minimalistic-bold-duotone />
              <template #confirm>
                {{ t('settings.pages.models.model-selector.confirm') }}
              </template>
              <template #cancel>
                {{ t('settings.pages.card.cancel') }}
              </template>
            </DoubleCheckButton>
          </div>
          <div
            class="aspect-[3/4] w-full shrink-0 px-1 py-2 lg:w-60 md:w-52 sm:w-64"
          >
            <img v-if="model.previewImage" :src="model.previewImage" :alt="model.name" h-full w-full rounded-lg bg="neutral-100 dark:neutral-900" object-contain :class="[highlightDisplayModelCard && highlightDisplayModelCard === model.id ? 'ring-3 ring-primary-400' : 'ring-0 ring-transparent']" transition="all duration-200 ease-in-out">
            <div v-else bg="neutral-100 dark:neutral-900" relative h-full w-full flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg :class="[highlightDisplayModelCard && highlightDisplayModelCard === model.id ? 'ring-3 ring-primary-400' : 'ring-0 ring-transparent']" transition="all duration-200 ease-in-out">
              <div i-solar:question-square-bold-duotone text-4xl opacity-75 />
              <div translate-y="100%" absolute top-0 flex flex-col translate-x--7 rotate-45 scale-250 gap-0 opacity-5>
                <div text="sm sm:sm" translate-x-7 translate-y--2 text-nowrap>
                  {{ t('settings.pages.models.model-selector.preview_unavailable') }}
                </div>
                <div text="sm sm:sm" translate-x-0 translate-y--0 text-nowrap>
                  {{ t('settings.pages.models.model-selector.preview_unavailable') }}
                </div>
                <div text="sm sm:sm" translate-x--7 translate-y-2 text-nowrap>
                  {{ t('settings.pages.models.model-selector.preview_unavailable') }}
                </div>
              </div>
            </div>
          </div>
          <div w-full flex flex-col>
            <div w-full flex-1 p-2>
              <EditableRoot
                v-slot="{ isEditing }"
                :default-value="model.name"
                :placeholder="t('settings.pages.models.model-selector.name_placeholder')"
                class="flex gap-2"
                auto-resize
                @submit="handleRenameModel(model, $event)"
              >
                <EditableArea class="w-[calc(100%-8px-1rem)] dark:text-white">
                  <EditablePreview class="line-clamp-1 w-[calc(100%-8px)] overflow-hidden text-ellipsis" />
                  <EditableInput class="w-[calc(100%-8px)]! placeholder:text-neutral-700 dark:placeholder:text-neutral-600" />
                </EditableArea>
                <EditableEditTrigger v-if="!isEditing && model.type === 'file'">
                  <div i-solar:pen-2-line-duotone opacity-50 />
                </EditableEditTrigger>
                <div v-else class="flex gap-2">
                  <EditableSubmitTrigger>
                    <div i-solar:check-read-line-duotone opacity-50 />
                  </EditableSubmitTrigger>
                </div>
              </EditableRoot>
              <div flex items-center gap-1 text="neutral-400 dark:neutral-600">
                <div i-solar:tag-horizontal-bold />
                <div>{{ mapFormatRenderer[model.format] }}</div>
              </div>
            </div>
            <Button class="hidden md:block" variant="secondary" @click="handlePick(model)">
              {{ t('settings.pages.models.model-selector.pick') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
    <Button class="block md:hidden" @click="handleMobilePick()">
      {{ t('settings.pages.models.model-selector.confirm') }}
    </Button>
  </div>
</template>
