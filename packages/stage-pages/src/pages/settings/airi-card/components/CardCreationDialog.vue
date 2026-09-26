<script setup lang="ts">
import type { Card } from '@proj-airi/ccc'
import type { AiriExtension } from '@proj-airi/stage-ui/stores/modules/airi-card'

import kebabcase from '@stdlib/string-base-kebabcase'

import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { resolveProviderResourceLabel } from '@proj-airi/stage-ui/utils'
import { Button, FieldInput, FieldValues } from '@proj-airi/ui'
import { Select } from '@proj-airi/ui/components/form'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { useCardCharacterGenerator } from '../composables/use-card-character-generator'
import { useCardDescriptionOptimizer } from '../composables/use-card-description-optimizer'

interface Props {
  modelValue: boolean
  cardId?: string // If provided, edit mode; otherwise create mode
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const modelValue = defineModel<boolean>()

const { t, te } = useI18n()
const cardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()
const speechStore = useSpeechStore()
const providersStore = useProvidersStore()

const { activeProvider: consciousnessProvider, activeModel: defaultConsciousnessModel } = storeToRefs(consciousnessStore)
const { activeSpeechProvider: speechProvider, activeSpeechModel: defaultSpeechModel, activeSpeechVoiceId: defaultSpeechVoiceId } = storeToRefs(speechStore)

// Determine if we're in edit mode
const isEditMode = computed(() => !!props.cardId)

// Modules configuration
const selectedConsciousnessProvider = ref<string>('')
const selectedConsciousnessModel = ref<string>('')
const selectedSpeechProvider = ref<string>('')
const selectedSpeechModel = ref<string>('')
const selectedSpeechVoiceId = ref<string>('')
const initializingCard = ref(false)

function resolveProviderLabel(providerId: string) {
  const metadata = providersStore.getProviderMetadata(providerId)
  return metadata?.localizedName || metadata?.name || providerId
}

function resolveModelLabel(providerId: string, modelId: string, modelName?: string) {
  return resolveProviderResourceLabel(providerId, 'models', modelId, modelName, t, te)
}

function resolveVoiceLabel(providerId: string, voiceId: string, voiceName?: string) {
  return resolveProviderResourceLabel(providerId, 'voices', voiceId, voiceName, t, te)
}

// Computed: available consciousness provider options
const consciousnessProviderOptions = computed(() => {
  return providersStore.configuredChatProvidersMetadata.map(provider => ({
    value: provider.id,
    label: provider.localizedName || provider.name,
  }))
})

// Computed: available consciousness models options
const consciousnessModelOptions = computed(() => {
  const provider = selectedConsciousnessProvider.value || consciousnessProvider.value
  if (!provider)
    return []
  const models = providersStore.getModelsForProvider(provider)
  return models.map(model => ({
    value: model.id,
    label: resolveModelLabel(provider, model.id, model.name),
  }))
})

// Computed: available speech provider options
const speechProviderOptions = computed(() => {
  return providersStore.configuredSpeechProvidersMetadata.map(provider => ({
    value: provider.id,
    label: provider.localizedName || provider.name,
  }))
})

// Computed: available speech models options
const speechModelOptions = computed(() => {
  const provider = selectedSpeechProvider.value || speechProvider.value
  if (!provider)
    return []
  const models = providersStore.getModelsForProvider(provider)
  return models.map(model => ({
    value: model.id,
    label: resolveModelLabel(provider, model.id, model.name),
  }))
})

// Computed: available speech voices options
const speechVoiceOptions = computed(() => {
  const provider = selectedSpeechProvider.value || speechProvider.value
  if (!provider)
    return []
  const voices = speechStore.getVoicesForProvider(provider)
  return voices.map(voice => ({
    value: voice.id,
    label: resolveVoiceLabel(provider, voice.id, voice.name),
  }))
})

const defaultConsciousnessProviderLabel = computed(() => resolveProviderLabel(consciousnessProvider.value))
const defaultConsciousnessModelLabel = computed(() => {
  const model = providersStore.getModelsForProvider(consciousnessProvider.value)
    .find(item => item.id === defaultConsciousnessModel.value)
  return resolveModelLabel(consciousnessProvider.value, defaultConsciousnessModel.value, model?.name)
})
const defaultSpeechProviderLabel = computed(() => resolveProviderLabel(speechProvider.value))
const defaultSpeechModelLabel = computed(() => {
  const model = providersStore.getModelsForProvider(speechProvider.value)
    .find(item => item.id === defaultSpeechModel.value)
  return resolveModelLabel(speechProvider.value, defaultSpeechModel.value, model?.name)
})
const defaultSpeechVoiceLabel = computed(() => {
  const voice = speechStore.getVoicesForProvider(speechProvider.value)
    .find(item => item.id === defaultSpeechVoiceId.value)
  return resolveVoiceLabel(speechProvider.value, defaultSpeechVoiceId.value, voice?.name)
})

// Load models for current providers on init
watch(() => [consciousnessProvider.value, speechProvider.value], async ([consProvider, spProvider]) => {
  if (consProvider) {
    await consciousnessStore.loadModelsForProvider(consProvider)
  }
  if (spProvider) {
    await speechStore.loadVoicesForProvider(spProvider)
    const metadata = providersStore.getProviderMetadata(spProvider)
    if (metadata?.capabilities.listModels) {
      await providersStore.fetchModelsForProvider(spProvider)
    }
  }
}, { immediate: true })

// Watch consciousness provider changes and reload models
watch(selectedConsciousnessProvider, async (newProvider, oldProvider) => {
  if (initializingCard.value)
    return
  if (oldProvider !== undefined && newProvider !== oldProvider && newProvider) {
    await consciousnessStore.loadModelsForProvider(newProvider)
    // Reset model selection to default or empty
    selectedConsciousnessModel.value = ''
  }
})

// Watch speech provider changes and reload models/voices
watch(selectedSpeechProvider, async (newProvider, oldProvider) => {
  if (initializingCard.value)
    return
  if (oldProvider !== undefined && newProvider !== oldProvider && newProvider) {
    await speechStore.loadVoicesForProvider(newProvider)
    const metadata = providersStore.getProviderMetadata(newProvider)
    if (metadata?.capabilities.listModels) {
      await providersStore.fetchModelsForProvider(newProvider)
    }
    // Reset model and voice selection
    selectedSpeechModel.value = ''
    selectedSpeechVoiceId.value = ''
  }
})

// Reset voice when speech model changes (different models may have different voices)
watch(selectedSpeechModel, async (newModel, oldModel) => {
  if (initializingCard.value)
    return
  // Only reset if model actually changed and we're not initializing
  const provider = selectedSpeechProvider.value || speechProvider.value
  if (oldModel !== undefined && newModel !== oldModel && provider) {
    // Reload voices for the current provider
    await speechStore.loadVoicesForProvider(provider)

    // Reset voice selection to default
    selectedSpeechVoiceId.value = defaultSpeechVoiceId.value || ''
  }
})

// Tab type definition
interface Tab {
  id: string
  label: string
  icon: string
}

// Active tab ID state
const activeTabId = ref('')

// Tabs for card details
const tabs: Tab[] = [
  { id: 'identity', label: t('settings.pages.card.creation.identity'), icon: 'i-solar:emoji-funny-square-bold-duotone' },
  { id: 'behavior', label: t('settings.pages.card.creation.behavior'), icon: 'i-solar:chat-round-line-bold-duotone' },
  { id: 'modules', label: t('settings.pages.card.modules'), icon: 'i-solar:widget-4-bold-duotone' },
  { id: 'settings', label: t('settings.pages.card.creation.settings'), icon: 'i-solar:settings-bold-duotone' },
]

// Active tab state - set to first available tab by default
const activeTab = computed({
  get: () => {
    // If current active tab is not in available tabs, reset to first tab
    if (!tabs.some(tab => tab.id === activeTabId.value))
      return tabs[0]?.id || ''
    return activeTabId.value
  },
  set: (value: string) => {
    activeTabId.value = value
  },
})

// Check for errors, and save built Cards :

const showError = ref<boolean>(false)
const errorMessage = ref<string>('')

function saveCard(card: Card): boolean {
  // Before saving, let's validate what the user entered :
  const rawCard: Card = toRaw(card)
  const requiredFields: Array<[keyof Card, string]> = [
    ['name', t('settings.pages.card.creation.errors.name')],
    ['version', t('settings.pages.card.creation.errors.version')],
    ['description', t('settings.pages.card.creation.errors.description')],
    ['personality', t('settings.pages.card.creation.errors.personality')],
    ['systemPrompt', t('settings.pages.card.creation.errors.systemprompt')],
    ['postHistoryInstructions', t('settings.pages.card.creation.errors.posthistoryinstructions')],
  ]

  const missingField = requiredFields.find(([key]) => !String(rawCard[key] ?? '').trim())
  if (missingField) {
    showError.value = true
    errorMessage.value = missingField[1]
    toast.error(errorMessage.value)
    return false
  }

  if (!/^(?:\d+\.)+\d+$/.test(String(rawCard.version))) {
    // Invalid version
    showError.value = true
    errorMessage.value = t('settings.pages.card.creation.errors.version')
    toast.error(errorMessage.value)
    return false
  }
  showError.value = false

  const existingAiriExtension = rawCard.extensions?.airi as AiriExtension | undefined

  // Build card with modules extension
  const cardWithModules = {
    ...rawCard,
    extensions: {
      ...rawCard.extensions,
      airi: {
        ...existingAiriExtension,
        modules: {
          ...existingAiriExtension?.modules,
          consciousness: {
            ...existingAiriExtension?.modules?.consciousness,
            provider: selectedConsciousnessProvider.value || consciousnessProvider.value,
            model: selectedConsciousnessModel.value || defaultConsciousnessModel.value,
          },
          speech: {
            ...existingAiriExtension?.modules?.speech,
            provider: selectedSpeechProvider.value || speechProvider.value,
            model: selectedSpeechModel.value || defaultSpeechModel.value,
            voice_id: selectedSpeechVoiceId.value || defaultSpeechVoiceId.value,
          },
        },
        agents: existingAiriExtension?.agents ?? {},
      } as AiriExtension,
    },
  }

  if (isEditMode.value && props.cardId) {
    // Edit mode: update existing card
    if (!cardStore.updateCard(props.cardId, cardWithModules)) {
      toast.error(t('settings.pages.card.creation.errors.card_not_found'))
      return false
    }
  }
  else {
    // Create mode: add new card
    cardStore.addCard(cardWithModules)
  }

  modelValue.value = false // Close this
  toast.success(t('settings.pages.card.save'))
  return true
}

// Cards data holders :

// Initialize card data - load from existing card if in edit mode
function initializeCard(): Card {
  // Extract existing card data if in edit mode
  const existingCard = (isEditMode.value && props.cardId) ? cardStore.getCard(props.cardId) : undefined
  const airiExt = existingCard?.extensions?.airi as AiriExtension | undefined

  // Initialize module selections with fallback logic (handles all cases: create, edit with/without extension)
  selectedConsciousnessProvider.value = airiExt?.modules?.consciousness?.provider || consciousnessProvider.value
  selectedConsciousnessModel.value = airiExt?.modules?.consciousness?.model || defaultConsciousnessModel.value
  selectedSpeechProvider.value = airiExt?.modules?.speech?.provider || speechProvider.value
  selectedSpeechModel.value = airiExt?.modules?.speech?.model || defaultSpeechModel.value
  selectedSpeechVoiceId.value = airiExt?.modules?.speech?.voice_id || defaultSpeechVoiceId.value

  // Return existing card data or defaults
  if (existingCard) {
    return { ...toRaw(existingCard) }
  }

  return {
    name: t('settings.pages.card.creation.defaults.name'),
    nickname: undefined,
    version: '1.0',
    description: t('settings.pages.card.creation.defaults.description'),
    notes: undefined,
    personality: t('settings.pages.card.creation.defaults.personality'),
    scenario: t('settings.pages.card.creation.defaults.scenario'),
    systemPrompt: t('settings.pages.card.creation.defaults.systemprompt'),
    postHistoryInstructions: t('settings.pages.card.creation.defaults.posthistoryinstructions'),
    greetings: [],
    messageExample: [],
  }
}

const card = ref<Card>(initializeCard())

// Reinitialize when cardId changes or dialog opens
watch(() => [props.modelValue, props.cardId], async () => {
  if (props.modelValue) {
    initializingCard.value = true
    card.value = initializeCard()
    await nextTick()
    initializingCard.value = false
  }
})

function makeComputed<T extends keyof Card>(
  /*
  Function used to generate Computed values, with an optional sanitize function
  */
  key: T,
  transform?: (input: string) => string,
) {
  return computed({
    get: () => {
      return card.value[key] ?? ''
    },
    set: (val: string) => { // Set,
      const input = val.trim() // We first trim the value
      card.value[key] = (input.length > 0
        ? (transform ? transform(input) : input) // then potentially transform it
        : '') as Card[T]// or default to empty string value if nothing was given
    },
  })
}

const cardName = makeComputed('name', input => kebabcase(input))
const cardNickname = makeComputed('nickname')
const cardDescription = makeComputed('description')
const cardNotes = makeComputed('notes')

const cardPersonality = makeComputed('personality')
const cardScenario = makeComputed('scenario')
const cardGreetings = computed({
  get: () => card.value.greetings ?? [],
  set: (val: string[]) => {
    card.value.greetings = val || []
  },
})

const cardVersion = makeComputed('version')
const cardSystemPrompt = makeComputed('systemPrompt')
const cardPostHistoryInstructions = makeComputed('postHistoryInstructions')

const {
  characterSettingsGenerationError,
  generateCharacterSettingsWithCurrentModel,
  isGeneratingCharacterSettings,
} = useCardCharacterGenerator({
  getSource: () => ({
    description: cardDescription.value,
    existing: {
      greetings: cardGreetings.value,
      personality: cardPersonality.value,
      postHistoryInstructions: cardPostHistoryInstructions.value,
      scenario: cardScenario.value,
      systemPrompt: cardSystemPrompt.value,
    },
    name: cardName.value || card.value.name || '',
    nickname: cardNickname.value,
  }),
  logLabel: 'CardCreationDialog',
})

async function handleGenerateCharacterSettings() {
  const result = await generateCharacterSettingsWithCurrentModel()
  if (!result) {
    const code = characterSettingsGenerationError.value || 'request-failed'
    toast.error(t(`settings.pages.card.creation.character_generation_errors.${code}`))
    return
  }

  cardPersonality.value = result.personality
  cardScenario.value = result.scenario
  cardSystemPrompt.value = result.systemPrompt
  cardPostHistoryInstructions.value = result.postHistoryInstructions
  cardGreetings.value = result.greetings
  toast.success(t('settings.pages.card.creation.character_generation_ready'))
}

const {
  descriptionOptimizeWithWeb,
  descriptionResearchWithWeb,
  handleOptimizeDescriptionWithCurrentModel,
  isOptimizingDescription,
} = useCardDescriptionOptimizer({
  getDescription: () => cardDescription.value,
  getName: () => cardName.value || card.value.name || '',
  getNickname: () => cardNickname.value,
  logLabel: 'CardCreationDialog',
  setDescription: value => cardDescription.value = value,
})

// Helper function to generate placeholder text for default values
function getDefaultPlaceholder(defaultValue: string | undefined): string {
  return defaultValue
    ? `${t('settings.pages.card.creation.use_default')} (${defaultValue})`
    : t('settings.pages.card.creation.use_default_not_configured')
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent class="fixed left-1/2 top-1/2 z-100 m-0 max-h-[90vh] max-w-6xl w-[92vw] flex flex-col overflow-auto border border-neutral-200 rounded-xl bg-white p-5 shadow-xl 2xl:w-[60vw] lg:w-[80vw] md:w-[85vw] xl:w-[70vw] -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800 sm:p-6">
        <div class="w-full flex flex-col gap-5">
          <DialogTitle text-2xl font-normal class="from-primary-500 to-primary-400 bg-gradient-to-r bg-clip-text text-transparent">
            {{ isEditMode ? t("settings.pages.card.edit_card") : t("settings.pages.card.create_card") }}
          </DialogTitle>

          <!-- Dialog tabs -->
          <div class="mt-4">
            <div class="border-b border-neutral-200 dark:border-neutral-700">
              <div class="flex justify-center -mb-px sm:justify-start space-x-1">
                <button
                  v-for="tab in tabs"
                  :key="tab.id"
                  class="px-4 py-2 text-sm font-medium"
                  :class="[
                    activeTab === tab.id
                      ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-500 dark:border-primary-400'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300',
                  ]"
                  @click="activeTab = tab.id"
                >
                  <div class="flex items-center gap-1">
                    <div :class="tab.icon" />
                    {{ tab.label }}
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Error div -->
          <div v-if="showError" class="w-full border border-red-200 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
            <p>
              {{ errorMessage }}
            </p>
          </div>

          <!-- Actual content -->
          <!-- Identity details -->
          <div v-if="activeTab === 'identity'" class="tab-content ml-auto mr-auto w-95%">
            <p class="mb-3">
              {{ t('settings.pages.card.creation.fields_info.subtitle') }}
            </p>

            <div class="input-list ml-auto mr-auto max-w-4xl w-full flex flex-col gap-6">
              <FieldInput v-model="cardName" :label="t('settings.pages.card.creation.name')" :description="t('settings.pages.card.creation.fields_info.name')" :required="true" />
              <FieldInput v-model="cardNickname" :label="t('settings.pages.card.creation.nickname')" :description="t('settings.pages.card.creation.fields_info.nickname')" />
              <div flex="~ col" gap-2>
                <FieldInput v-model="cardDescription" :label="t('settings.pages.card.creation.description')" :single-line="false" :required="true" :description="t('settings.pages.card.creation.fields_info.description')" />
                <div class="flex flex-col items-stretch gap-3">
                  <div class="flex flex-col items-start gap-2">
                    <label class="w-fit flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <input
                        v-model="descriptionOptimizeWithWeb"
                        type="checkbox"
                        class="h-3.5 w-3.5"
                      >
                      {{ t('settings.pages.card.creation.optimize_description_with_web') }}
                    </label>
                    <label class="w-fit flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <input
                        v-model="descriptionResearchWithWeb"
                        type="checkbox"
                        class="h-3.5 w-3.5"
                      >
                      {{ t('settings.pages.card.creation.research_description_with_web') }}
                    </label>
                  </div>
                  <Button
                    class="self-start"
                    variant="secondary"
                    icon="i-solar:stars-bold-duotone"
                    :label="isOptimizingDescription ? t('settings.pages.card.creation.optimizing_description') : t('settings.pages.card.creation.optimize_description')"
                    :disabled="isOptimizingDescription || !cardDescription.trim()"
                    @click="handleOptimizeDescriptionWithCurrentModel"
                  />
                </div>
              </div>
              <FieldInput v-model="cardNotes" :label="t('settings.pages.card.creator_notes')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.notes')" />
            </div>
          </div>
          <!-- Behavior -->
          <div v-else-if="activeTab === 'behavior'" class="tab-content ml-auto mr-auto w-95%">
            <div class="input-list ml-auto mr-auto max-w-4xl w-full flex flex-col gap-6">
              <div :class="['airi-surface-glass', 'flex flex-col items-start gap-3 rounded-lg p-4 sm:flex-row sm:items-center sm:justify-between']">
                <div class="min-w-0">
                  <div :class="['airi-text', 'text-sm font-medium']">
                    {{ t('settings.pages.card.creation.generate_character_settings') }}
                  </div>
                  <p :class="['airi-text-muted', 'mt-1 text-xs leading-5']">
                    {{ t('settings.pages.card.creation.character_generation_description') }}
                  </p>
                </div>
                <Button
                  class="shrink-0"
                  variant="secondary"
                  icon="i-solar:magic-stick-3-bold-duotone"
                  :label="isGeneratingCharacterSettings ? t('settings.pages.card.creation.generating_character_settings') : t('settings.pages.card.creation.generate_character_settings')"
                  :disabled="isGeneratingCharacterSettings || !cardDescription.trim()"
                  @click="handleGenerateCharacterSettings"
                />
              </div>
              <FieldInput v-model="cardPersonality" :label="t('settings.pages.card.personality')" :single-line="false" :required="true" :description="t('settings.pages.card.creation.fields_info.personality')" />
              <FieldInput v-model="cardScenario" :label="t('settings.pages.card.scenario')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.scenario')" />
              <FieldValues v-model="cardGreetings" :label="t('settings.pages.card.creation.greetings')" :description="t('settings.pages.card.creation.fields_info.greetings')" />
            </div>
          </div>
          <!-- Modules -->
          <div v-else-if="activeTab === 'modules'" class="tab-content ml-auto mr-auto w-95%">
            <p class="mb-3">
              {{ t('settings.pages.card.creation.modules_info') }}
            </p>

            <div :class="['grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-4', 'ml-auto', 'mr-auto', 'w-90%']">
              <!-- Consciousness Provider -->
              <div :class="['flex', 'flex-col', 'gap-2']">
                <label :class="['flex', 'flex-row', 'items-center', 'gap-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
                  <div i-lucide:brain />
                  {{ t('settings.pages.card.chat.provider') }}
                </label>
                <Select
                  v-model="selectedConsciousnessProvider"
                  :options="consciousnessProviderOptions"
                  :placeholder="getDefaultPlaceholder(defaultConsciousnessProviderLabel)"
                  empty-label="暂无可用服务商"
                  class="w-full"
                />
              </div>

              <!-- Consciousness Model -->
              <div :class="['flex', 'flex-col', 'gap-2']">
                <label :class="['flex', 'flex-row', 'items-center', 'gap-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
                  <div i-lucide:ghost />
                  {{ t('settings.pages.card.consciousness.model') }}
                </label>
                <Select
                  v-model="selectedConsciousnessModel"
                  :options="consciousnessModelOptions"
                  :placeholder="getDefaultPlaceholder(defaultConsciousnessModelLabel)"
                  empty-label="暂无可用模型"
                  :disabled="!selectedConsciousnessProvider && !consciousnessProvider"
                  class="w-full"
                />
              </div>

              <!-- Speech Provider -->
              <div :class="['flex', 'flex-col', 'gap-2']">
                <label :class="['flex', 'flex-row', 'items-center', 'gap-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
                  <div i-lucide:radio />
                  {{ t('settings.pages.card.speech.provider') }}
                </label>
                <Select
                  v-model="selectedSpeechProvider"
                  :options="speechProviderOptions"
                  :placeholder="getDefaultPlaceholder(defaultSpeechProviderLabel)"
                  empty-label="暂无可用语音服务商"
                  class="w-full"
                />
              </div>

              <!-- Speech Model -->
              <div :class="['flex', 'flex-col', 'gap-2']">
                <label :class="['flex', 'flex-row', 'items-center', 'gap-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
                  <div i-lucide:mic />
                  {{ t('settings.pages.card.speech.model') }}
                </label>
                <Select
                  v-model="selectedSpeechModel"
                  :options="speechModelOptions"
                  :placeholder="getDefaultPlaceholder(defaultSpeechModelLabel)"
                  empty-label="暂无可用语音模型"
                  :disabled="!selectedSpeechProvider && !speechProvider"
                  class="w-full"
                />
              </div>

              <!-- Speech Voice -->
              <div :class="['flex', 'flex-col', 'gap-2']">
                <label :class="['flex', 'flex-row', 'items-center', 'gap-2', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
                  <div i-lucide:music />
                  {{ t('settings.pages.card.speech.voice') }}
                </label>
                <Select
                  v-model="selectedSpeechVoiceId"
                  :options="speechVoiceOptions"
                  :placeholder="getDefaultPlaceholder(defaultSpeechVoiceLabel)"
                  empty-label="暂无可用声线"
                  :disabled="!selectedSpeechProvider && !speechProvider"
                  class="w-full"
                />
              </div>
            </div>
          </div>
          <!-- Settings -->
          <div v-else-if="activeTab === 'settings'" class="tab-content ml-auto mr-auto w-95%">
            <div class="input-list ml-auto mr-auto max-w-4xl w-full flex flex-col gap-6">
              <FieldInput v-model="cardSystemPrompt" :label="t('settings.pages.card.systemprompt')" :single-line="false" :required="true" :description="t('settings.pages.card.creation.fields_info.systemprompt')" />
              <FieldInput v-model="cardPostHistoryInstructions" :label="t('settings.pages.card.posthistoryinstructions')" :single-line="false" :required="true" :description="t('settings.pages.card.creation.fields_info.posthistoryinstructions')" />
              <FieldInput v-model="cardVersion" :label="t('settings.pages.card.creation.version')" :required="true" :description="t('settings.pages.card.creation.fields_info.version')" />
            </div>
          </div>

          <div class="ml-auto mr-1 flex flex-row gap-2">
            <Button
              type="button"
              variant="secondary"
              icon="i-solar:undo-left-bold-duotone"
              :label="t('settings.pages.card.cancel')"
              :disabled="false"
              @click="modelValue = false"
            />
            <button
              type="button"
              class="airi-control-primary rounded-lg px-4 py-2 text-sm font-medium"
              @click.prevent.stop="saveCard(card)"
            >
              {{ isEditMode ? t('settings.pages.card.save') : t('settings.pages.card.creation.create') }}
            </button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.input-list > * {
    width: 100%;
  }
</style>
