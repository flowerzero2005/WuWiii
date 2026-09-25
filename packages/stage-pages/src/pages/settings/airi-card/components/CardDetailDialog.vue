<script setup lang="ts">
import type { NotebookEntry } from '@proj-airi/stage-ui/stores/character/notebook'
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'
import type {
  AiriPersonaExpandedProfile,
  AiriPersonaPackageCompilerRisk,
  AiriPersonaPackageExtension,
  AiriPersonaPackageSectionKey,
} from '@proj-airi/stage-ui/stores/modules/persona-package'

import DOMPurify from 'dompurify'

import { useDisplayModelFileDialog } from '@proj-airi/stage-ui/composables/use-display-model-file-dialog'
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { useMemoryManager } from '@proj-airi/stage-ui/stores/chat/memory-manager'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import {
  AIRI_PERSONA_PACKAGE_SECTION_KEYS,
  createPersonaPackageCompilerGuidance,
} from '@proj-airi/stage-ui/stores/modules/persona-package'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { DEFAULT_STAGE_MODEL_ID } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { resolveProviderResourceLabel } from '@proj-airi/stage-ui/utils'
import { Button, FieldInput, FieldValues, Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import DeleteCardDialog from './DeleteCardDialog.vue'

import { useCardCharacterGenerator } from '../composables/use-card-character-generator'
import { useCardDescriptionOptimizer } from '../composables/use-card-description-optimizer'
import { usePersonaPackageGenerator } from '../composables/use-persona-package-generator'

interface Props {
  modelValue: boolean
  cardId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'restoreDefault'): void
  (e: 'update:modelValue', value: boolean): void
}>()

const { t, te } = useI18n()
const cardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()
const memoryManager = useMemoryManager()
const notebookStore = useCharacterNotebookStore()
const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const displayModelsStore = useDisplayModelsStore()
const { removeCard } = cardStore
const { activeCardId } = storeToRefs(cardStore)
const { displayModels, displayModelsFromIndexedDBLoading } = storeToRefs(displayModelsStore)
const { activeProvider: consciousnessProvider, activeModel: defaultConsciousnessModel } = storeToRefs(consciousnessStore)
const { activeSpeechProvider: speechProvider, activeSpeechModel: defaultSpeechModel, activeSpeechVoiceId: defaultVoiceId } = storeToRefs(speechStore)

// Get selected card data
const selectedCard = computed<AiriCard | undefined>(() => {
  if (!props.cardId)
    return undefined
  return cardStore.getCard(props.cardId)
})

// Get module settings
const moduleSettings = computed(() => {
  if (!selectedCard.value || !selectedCard.value.extensions?.airi?.modules) {
    return {
      consciousnessProvider: '',
      consciousness: '',
      speechProvider: '',
      speech: '',
      voice: '',
    }
  }

  const airiExt = selectedCard.value.extensions.airi.modules
  return {
    consciousnessProvider: airiExt.consciousness?.provider || '',
    consciousness: airiExt.consciousness?.model || '',
    speechProvider: airiExt.speech?.provider || '',
    speech: airiExt.speech?.model || '',
    voice: airiExt.speech?.voice_id || '',
  }
})

// Check if card is active
const isActive = computed(() => props.cardId === activeCardId.value)

// Animation control for card activation
const isActivating = ref(false)
const displayModelsLoaded = ref(false)
const importingDisplayModel = ref(false)

const supportedDisplayModels = computed(() => displayModels.value.filter(model => (
  model.format === DisplayModelFormat.Live2dZip || model.format === DisplayModelFormat.VRM || model.format === DisplayModelFormat.PictureOcZip
)))
const displayModelOptions = computed(() => [
  { label: t('settings.pages.card.display_model.use_default'), value: '' },
  ...supportedDisplayModels.value.map(model => ({ label: model.name, value: model.id })),
])
const boundDisplayModelId = computed({
  get: () => selectedCard.value?.extensions.airi.modules.display?.modelId ?? '',
  set: (modelId: string | number) => {
    cardStore.setCardDisplayModel(props.cardId, modelId ? String(modelId) : undefined)
  },
})

const characterDraft = ref({
  personality: '',
  scenario: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  greetings: [] as string[],
})
const characterChanged = computed(() => {
  const card = selectedCard.value
  if (!card)
    return false
  return characterDraft.value.personality !== (card.personality ?? '')
    || characterDraft.value.scenario !== (card.scenario ?? '')
    || characterDraft.value.systemPrompt !== (card.systemPrompt ?? '')
    || characterDraft.value.postHistoryInstructions !== (card.postHistoryInstructions ?? '')
    || JSON.stringify(characterDraft.value.greetings) !== JSON.stringify(card.greetings ?? [])
})

watch(selectedCard, (card) => {
  characterDraft.value = {
    personality: card?.personality ?? '',
    scenario: card?.scenario ?? '',
    systemPrompt: card?.systemPrompt ?? '',
    postHistoryInstructions: card?.postHistoryInstructions ?? '',
    greetings: card?.greetings ?? [],
  }
}, { immediate: true })

function saveCharacterSettings() {
  if (!selectedCard.value) {
    toast.error(t('settings.pages.card.creation.errors.card_not_found'))
    return
  }

  const saved = cardStore.updateCard(props.cardId, {
    ...selectedCard.value,
    ...characterDraft.value,
  })
  if (saved)
    toast.success(t('settings.pages.card.save'))
  else
    toast.error(t('settings.pages.card.creation.errors.card_not_found'))
}
const dialogContentRef = ref<HTMLElement>()
const nameDraft = ref('')
const nicknameDraft = ref('')
const descriptionDraft = ref('')
const notesDraft = ref('')
const versionDraft = ref('')
const descriptionChanged = computed(() => nameDraft.value !== (selectedCard.value?.name ?? '')
  || nicknameDraft.value !== (selectedCard.value?.nickname ?? '')
  || descriptionDraft.value !== (selectedCard.value?.description ?? '')
  || notesDraft.value !== (selectedCard.value?.notes ?? '')
  || versionDraft.value !== (selectedCard.value?.version ?? ''))

function handleDialogOpenAutoFocus(event: Event) {
  event.preventDefault()
  void nextTick(() => dialogContentRef.value?.focus({ preventScroll: true }))
}

function saveDescription() {
  if (!selectedCard.value) {
    toast.error(t('settings.pages.card.creation.errors.card_not_found'))
    return
  }

  cardStore.updateCard(props.cardId, {
    ...selectedCard.value,
    name: nameDraft.value.trim(),
    nickname: nicknameDraft.value.trim(),
    description: descriptionDraft.value.trim(),
    notes: notesDraft.value.trim(),
    version: versionDraft.value.trim(),
  })
  nameDraft.value = nameDraft.value.trim()
  nicknameDraft.value = nicknameDraft.value.trim()
  descriptionDraft.value = descriptionDraft.value.trim()
  notesDraft.value = notesDraft.value.trim()
  versionDraft.value = versionDraft.value.trim()
  toast.success(t('settings.pages.card.save'))
}

watch(selectedCard, (card) => {
  nameDraft.value = card?.name ?? ''
  nicknameDraft.value = card?.nickname ?? ''
  descriptionDraft.value = card?.description ?? ''
  notesDraft.value = card?.notes ?? ''
  versionDraft.value = card?.version ?? ''
}, { immediate: true })
const boundDisplayModel = computed(() => supportedDisplayModels.value.find(model => model.id === boundDisplayModelId.value))
const defaultDisplayModel = computed(() => supportedDisplayModels.value.find(model => model.id === DEFAULT_STAGE_MODEL_ID))
const resolvedDisplayModel = computed(() => boundDisplayModel.value ?? defaultDisplayModel.value)
const pictureOcDisplayModel = computed(() => boundDisplayModel.value?.type === 'file' && boundDisplayModel.value.format === DisplayModelFormat.PictureOcZip
  ? boundDisplayModel.value
  : undefined)
const pictureOcActionKeys = ['idle', 'speaking', 'thinking', 'listening', 'reminder', 'happy', 'sad', 'angry', 'surprised'] as const
const pictureOcActionDraft = ref<Record<string, string>>({})
const pictureOcImageOptions = computed(() => (pictureOcDisplayModel.value?.pictureOc?.imagePaths ?? []).map((path: string) => ({ label: path, value: path })))
const pictureOcActionOptions = computed(() => pictureOcActionKeys.map(action => ({
  action,
  label: t(`settings.pages.card.display_model.actions.${action}`),
  value: pictureOcActionDraft.value[action] ?? pictureOcDisplayModel.value?.pictureOc?.actions[action] ?? pictureOcDisplayModel.value?.pictureOc?.actions.idle ?? '',
})))
const displayModelBindingMissing = computed(() => (
  displayModelsLoaded.value && Boolean(boundDisplayModelId.value) && !boundDisplayModel.value
))

watch(boundDisplayModel, (model) => {
  pictureOcActionDraft.value = model?.type === 'file' && model.pictureOc
    ? { ...model.pictureOc.actions }
    : {}
}, { immediate: true })

async function savePictureOcActions() {
  const model = pictureOcDisplayModel.value
  if (!model?.pictureOc)
    return

  const saved = await displayModelsStore.updatePictureOcActions(model.id, pictureOcActionDraft.value)
  if (saved)
    toast.success(t('settings.pages.card.display_model.actions_saved'))
  else
    toast.error(t('settings.pages.card.display_model.actions_save_failed'))
}

function getDisplayModelFormatLabel(format?: DisplayModelFormat) {
  if (format === DisplayModelFormat.VRM)
    return 'VRM'
  return format === DisplayModelFormat.PictureOcZip ? 'Picture OC' : 'Live2D'
}

async function importAndBindDisplayModel(format: DisplayModelFormat, file: File) {
  if (!selectedCard.value)
    return

  const expectedExtension = format === DisplayModelFormat.VRM ? '.vrm' : '.zip'
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    toast.error(t('settings.pages.card.display_model.invalid_file', { extension: expectedExtension }))
    return
  }

  importingDisplayModel.value = true
  try {
    const model = format === DisplayModelFormat.PictureOcZip
      ? await displayModelsStore.addPictureOcPackage(file)
      : await displayModelsStore.addDisplayModel(format, file)
    boundDisplayModelId.value = model.id
    toast.success(t('settings.pages.card.display_model.import_success', { name: model.name }))
  }
  catch (error) {
    console.error('[CardDetailDialog] Failed to import display model:', error)
    toast.error(t('settings.pages.card.display_model.import_failed'))
  }
  finally {
    importingDisplayModel.value = false
  }
}

const fileDialogError = () => toast.error(t('settings.pages.card.display_model.import_failed'))
const live2dImportDialog = useDisplayModelFileDialog({
  accept: '.zip',
  kind: 'live2d',
  onChange: file => void importAndBindDisplayModel(DisplayModelFormat.Live2dZip, file),
  onError: fileDialogError,
})
const vrmImportDialog = useDisplayModelFileDialog({
  accept: '.vrm',
  kind: 'vrm',
  onChange: file => void importAndBindDisplayModel(DisplayModelFormat.VRM, file),
  onError: fileDialogError,
})
const pictureOcImportDialog = useDisplayModelFileDialog({
  accept: '.zip',
  kind: 'picture-oc',
  onChange: file => void importAndBindDisplayModel(DisplayModelFormat.PictureOcZip, file),
  onError: fileDialogError,
})

function handleActivate() {
  isActivating.value = true
  setTimeout(() => {
    activeCardId.value = props.cardId
    isActivating.value = false
  }, 300)
}

function highlightTagToHtml(text: string) {
  return DOMPurify.sanitize(text?.replace(/\{\{(.*?)\}\}/g, '<span class="bg-primary-500/20 inline-block">{{ $1 }}</span>').trim())
}

// Delete confirmation
const showDeleteConfirm = ref(false)
const includeGrowthMemoriesInExport = ref(false)

const {
  descriptionOptimizeWithWeb,
  descriptionResearchWithWeb,
  handleOptimizeDescriptionWithCurrentModel,
  isOptimizingDescription,
} = useCardDescriptionOptimizer({
  getDescription: () => descriptionDraft.value,
  getName: () => selectedCard.value?.name ?? '',
  getNickname: () => selectedCard.value?.nickname ?? '',
  logLabel: 'CardDetailDialog',
  setDescription: (value) => {
    descriptionDraft.value = value
  },
})

const {
  characterSettingsGenerationError,
  generateCharacterSettingsWithCurrentModel,
  isGeneratingCharacterSettings,
} = useCardCharacterGenerator({
  getSource: () => ({
    description: descriptionDraft.value,
    existing: characterDraft.value,
    name: nameDraft.value || selectedCard.value?.name || '',
    nickname: nicknameDraft.value,
  }),
  logLabel: 'CardDetailDialog',
})

async function handleGenerateCharacterSettings() {
  const result = await generateCharacterSettingsWithCurrentModel()
  if (!result) {
    const code = characterSettingsGenerationError.value || 'request-failed'
    toast.error(t(`settings.pages.card.creation.character_generation_errors.${code}`))
    return
  }

  characterDraft.value = result
  toast.success(t('settings.pages.card.creation.character_generation_ready'))
}

const {
  clearPersonaPackageGenerationError,
  generatePersonaPackageWithCurrentModel,
  isGeneratingPersonaPackage,
  personaPackageGenerationError,
} = usePersonaPackageGenerator({
  getCard: () => selectedCard.value,
  getGrowthMemories: () => getPersonaGrowthMemoryTexts(),
  logLabel: 'CardDetailDialog',
})

type AdvancedProfileListKey = 'expressionNotes' | 'feedbackCalibration' | 'growthMemories' | 'identity' | 'personality' | 'responseBoundaries' | 'scenarioBoundaries' | 'webSearchInterests' | 'writingPreferences'
type GeneratedPersonaProfileDiffStatus = 'added' | 'changed' | 'unchanged'

interface AdvancedProfileDraft {
  expressionNotes: string
  feedbackCalibration: string
  growthMemories: string
  identity: string
  personality: string
  responseBoundaries: string
  scenarioBoundaries: string
  summary: string
  webSearchInterests: string
  writingPreferences: string
}

interface GeneratedPersonaProfileDiffItem {
  currentCount: number
  key: AdvancedProfileListKey | 'summary'
  label: string
  nextCount: number
  status: GeneratedPersonaProfileDiffStatus
}

const emptyAdvancedDraft: AdvancedProfileDraft = {
  expressionNotes: '',
  feedbackCalibration: '',
  growthMemories: '',
  identity: '',
  personality: '',
  responseBoundaries: '',
  scenarioBoundaries: '',
  summary: '',
  webSearchInterests: '',
  writingPreferences: '',
}

const advancedDraft = ref<AdvancedProfileDraft>({ ...emptyAdvancedDraft })

const advancedDraftSections = computed<Array<{ key: AdvancedProfileListKey, label: string }>>(() => [
  { key: 'identity', label: t('settings.pages.card.persona_package.sections.identity') },
  { key: 'personality', label: t('settings.pages.card.persona_package.sections.personality') },
  { key: 'scenarioBoundaries', label: t('settings.pages.card.persona_package.sections.scenario_boundaries') },
  { key: 'responseBoundaries', label: t('settings.pages.card.persona_package.sections.response_boundaries') },
  { key: 'writingPreferences', label: t('settings.pages.card.persona_package.sections.writing_preferences') },
  { key: 'feedbackCalibration', label: t('settings.pages.card.persona_package.sections.feedback_calibration') },
  { key: 'growthMemories', label: t('settings.pages.card.persona_package.sections.growth_memories') },
  { key: 'webSearchInterests', label: t('settings.pages.card.persona_package.sections.web_search_interests') },
  { key: 'expressionNotes', label: t('settings.pages.card.persona_package.sections.expression_notes') },
])

const generatedPersonaProfileDiffSections = computed<Array<{ key: AdvancedProfileListKey | 'summary', label: string }>>(() => [
  { key: 'summary', label: t('settings.pages.card.persona_package.sections.summary') },
  ...advancedDraftSections.value,
])

const personaPackageExtension = computed(() => {
  return cardStore.getPersonaPackageExtension(selectedCard.value)
})

const advancedProfile = computed(() => personaPackageExtension.value?.advancedProfile)
const enabledSections = computed(() => personaPackageExtension.value?.enabledSections ?? {})
const pendingGeneratedPersonaProfile = ref<AiriPersonaExpandedProfile | undefined>()
const selectedGeneratedPersonaSections = ref<Set<AdvancedProfileListKey | 'summary'>>(new Set())
const lastAppliedPersonaPackageSnapshot = ref<{
  cardId: string
  personaPackage?: AiriPersonaPackageExtension
}>()

const personaCompilerGuidance = computed(() => {
  if (!selectedCard.value)
    return undefined

  return createPersonaPackageCompilerGuidance({
    card: selectedCard.value,
    growthMemories: getPersonaGrowthMemoryTexts(),
  })
})

const personaCompilerRiskItems = computed(() => {
  const guidance = personaCompilerGuidance.value
  if (!guidance)
    return []

  return guidance.risks.map(risk => ({
    ...risk,
    label: getPersonaCompilerRiskLabel(risk),
  }))
})

const personaCompilerSearchCandidates = computed(() => {
  return personaCompilerGuidance.value?.searchCandidates.slice(0, 6) ?? []
})

const generatedPersonaProfileDiffItems = computed<GeneratedPersonaProfileDiffItem[]>(() => {
  if (!pendingGeneratedPersonaProfile.value)
    return []

  return generatedPersonaProfileDiffSections.value.map((section) => {
    const current = getProfileSectionDiffText(advancedProfile.value, section.key)
    const next = getProfileSectionDiffText(pendingGeneratedPersonaProfile.value, section.key)

    return {
      currentCount: getProfileSectionItemCount(advancedProfile.value, section.key),
      key: section.key,
      label: section.label,
      nextCount: getProfileSectionItemCount(pendingGeneratedPersonaProfile.value, section.key),
      status: current === next ? 'unchanged' : current ? 'changed' : 'added',
    }
  })
})

const changedGeneratedPersonaProfileDiffItems = computed(() => {
  return generatedPersonaProfileDiffItems.value.filter(item => item.status !== 'unchanged')
})

const selectedGeneratedPersonaSectionCount = computed(() => {
  return selectedGeneratedPersonaSections.value.size
})

const personaGrowthCandidates = computed(() => {
  return notebookStore.entries
    .filter(entry => notebookStore.entryBelongsToCurrentScope(entry))
    .filter(entry => entry.metadata?.memoryKind === 'persona-growth-candidate')
    .filter(entry => entry.metadata?.personaGrowthStatus !== 'disabled')
})

const solidifiedPersonaGrowthMemories = computed(() => {
  return notebookStore.entries
    .filter(entry => notebookStore.entryBelongsToCurrentScope(entry))
    .filter(entry => entry.metadata?.memoryKind === 'persona-growth-memory')
})

const personaPackageStatusText = computed(() => {
  if (!personaPackageExtension.value?.advancedProfile)
    return t('settings.pages.card.persona_package.empty')

  const updatedAt = personaPackageExtension.value.advancedProfile.updatedAt
  return t('settings.pages.card.persona_package.status', {
    growthCount: solidifiedPersonaGrowthMemories.value.length,
    updatedAt: formatDateTime(updatedAt),
  })
})

watch(advancedProfile, (profile) => {
  advancedDraft.value = profileToDraft(profile)
}, { immediate: true })

watch(() => props.cardId, () => {
  clearPersonaPackageGenerationError()
  pendingGeneratedPersonaProfile.value = undefined
  selectedGeneratedPersonaSections.value = new Set()
  lastAppliedPersonaPackageSnapshot.value = undefined
})

watch(() => props.modelValue, async (open) => {
  if (!open || displayModelsLoaded.value)
    return

  await displayModelsStore.loadDisplayModelsFromIndexedDB()
  displayModelsLoaded.value = true
}, { immediate: true })

function handleDeleteConfirm() {
  if (selectedCard.value) {
    removeCard(props.cardId)
    emit('update:modelValue', false)
  }
  showDeleteConfirm.value = false
}

function profileToDraft(profile?: AiriPersonaExpandedProfile): AdvancedProfileDraft {
  if (!profile)
    return { ...emptyAdvancedDraft }

  return {
    expressionNotes: profile.expressionNotes.join('\n'),
    feedbackCalibration: profile.feedbackCalibration.join('\n'),
    growthMemories: profile.growthMemories.join('\n'),
    identity: profile.identity.join('\n'),
    personality: profile.personality.join('\n'),
    responseBoundaries: profile.responseBoundaries.join('\n'),
    scenarioBoundaries: profile.scenarioBoundaries.join('\n'),
    summary: profile.summary,
    webSearchInterests: profile.webSearchInterests.join('\n'),
    writingPreferences: profile.writingPreferences.join('\n'),
  }
}

function splitDraftList(value: string) {
  return value
    .split(/\r?\n/g)
    .map(item => item.trim())
    .filter(Boolean)
}

function formatDateTime(timestamp?: number) {
  if (!timestamp)
    return t('settings.pages.card.persona_package.never')

  return new Date(timestamp).toLocaleString()
}

function getPersonaGrowthMemoryTexts() {
  return solidifiedPersonaGrowthMemories.value
    .map(entry => entry.text.trim())
    .filter(Boolean)
}

function getPersonaCompilerDensityText() {
  const density = personaCompilerGuidance.value?.density
  if (!density)
    return ''

  return t(`settings.pages.card.persona_package.compiler.density.${density}`)
}

function getPersonaCompilerModeText() {
  const mode = personaCompilerGuidance.value?.generationMode
  if (!mode)
    return ''

  return t(`settings.pages.card.persona_package.compiler.mode.${mode}`)
}

function getPersonaCompilerRiskLabel(risk: AiriPersonaPackageCompilerRisk) {
  return t(`settings.pages.card.persona_package.compiler.risk.${risk.code}`)
}

function getPersonaCompilerRiskClass(severity: AiriPersonaPackageCompilerRisk['severity']) {
  if (severity === 'warning')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-300'

  return 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-950/20 dark:text-primary-300'
}

function getProfileSectionDiffText(
  profile: AiriPersonaExpandedProfile | undefined,
  sectionKey: AdvancedProfileListKey | 'summary',
) {
  if (!profile)
    return ''

  const value = sectionKey === 'summary'
    ? profile.summary
    : profile[sectionKey].join('\n')

  return value.replace(/\s+/g, ' ').trim()
}

function getProfileSectionItemCount(
  profile: AiriPersonaExpandedProfile | undefined,
  sectionKey: AdvancedProfileListKey | 'summary',
) {
  if (!profile)
    return 0

  if (sectionKey === 'summary')
    return profile.summary ? 1 : 0

  return profile[sectionKey].length
}

function getGeneratedProfileDiffStatusClass(status: GeneratedPersonaProfileDiffStatus) {
  if (status === 'changed')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-300'
  if (status === 'added')
    return 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-950/20 dark:text-primary-300'

  return 'border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400'
}

function isGeneratedPersonaSectionSelected(sectionKey: AdvancedProfileListKey | 'summary') {
  return selectedGeneratedPersonaSections.value.has(sectionKey)
}

function setGeneratedPersonaSectionSelected(sectionKey: AdvancedProfileListKey | 'summary', selected: boolean) {
  const next = new Set(selectedGeneratedPersonaSections.value)
  if (selected)
    next.add(sectionKey)
  else
    next.delete(sectionKey)

  selectedGeneratedPersonaSections.value = next
}

function selectChangedGeneratedPersonaSections() {
  selectedGeneratedPersonaSections.value = new Set(
    changedGeneratedPersonaProfileDiffItems.value.map(item => item.key),
  )
}

function clearGeneratedPersonaSectionSelection() {
  selectedGeneratedPersonaSections.value = new Set()
}

function handleCompilePersonaPackageDraft() {
  if (!props.cardId)
    return

  clearPersonaPackageGenerationError()
  pendingGeneratedPersonaProfile.value = undefined
  cardStore.compilePersonaPackageDraft(props.cardId, {
    growthMemories: getPersonaGrowthMemoryTexts(),
  })
}

async function handleGeneratePersonaPackagePreview() {
  const profile = await generatePersonaPackageWithCurrentModel()
  pendingGeneratedPersonaProfile.value = profile
  if (!profile) {
    clearGeneratedPersonaSectionSelection()
    return
  }

  selectChangedGeneratedPersonaSections()
}

function applyGeneratedPersonaPackagePreview() {
  if (!props.cardId || !pendingGeneratedPersonaProfile.value)
    return

  const selectedSections = selectedGeneratedPersonaSections.value
  if (selectedSections.size === 0) {
    toast.error(t('settings.pages.card.persona_package.no_generated_sections_selected'))
    return
  }

  const profilePatch = generatedPersonaProfileDiffSections.value.reduce((patch, section) => {
    if (!selectedSections.has(section.key))
      return patch

    if (section.key === 'summary')
      patch.summary = pendingGeneratedPersonaProfile.value?.summary ?? ''
    else
      patch[section.key] = pendingGeneratedPersonaProfile.value?.[section.key] ?? []

    return patch
  }, {} as Partial<AiriPersonaExpandedProfile>)

  lastAppliedPersonaPackageSnapshot.value = {
    cardId: props.cardId,
    personaPackage: selectedCard.value?.extensions.airi.personaPackage
      ? structuredClone(selectedCard.value.extensions.airi.personaPackage)
      : undefined,
  }
  cardStore.updatePersonaPackageAdvancedProfile(props.cardId, profilePatch, {
    source: 'compiled-draft',
  })
  pendingGeneratedPersonaProfile.value = undefined
  selectedGeneratedPersonaSections.value = new Set()
  toast.success(t('settings.pages.card.persona_package.apply_generated_success'))
}

function undoGeneratedPersonaPackageApplication() {
  const snapshot = lastAppliedPersonaPackageSnapshot.value
  const card = selectedCard.value
  if (!snapshot || !card || snapshot.cardId !== props.cardId)
    return

  cardStore.updateCard(props.cardId, {
    ...card,
    extensions: {
      ...card.extensions,
      airi: {
        ...card.extensions.airi,
        personaPackage: snapshot.personaPackage,
      },
    },
  })
  lastAppliedPersonaPackageSnapshot.value = undefined
}

function discardGeneratedPersonaPackagePreview() {
  clearPersonaPackageGenerationError()
  pendingGeneratedPersonaProfile.value = undefined
  clearGeneratedPersonaSectionSelection()
}

function handleRegenerateAllPersonaPackageSections() {
  if (!props.cardId)
    return

  clearPersonaPackageGenerationError()
  pendingGeneratedPersonaProfile.value = undefined
  cardStore.regeneratePersonaPackageAdvancedProfileSections(props.cardId, [...AIRI_PERSONA_PACKAGE_SECTION_KEYS], {
    growthMemories: getPersonaGrowthMemoryTexts(),
  })
}

function handleSaveAdvancedDraft() {
  if (!props.cardId)
    return

  const saved = cardStore.updatePersonaPackageAdvancedProfile(props.cardId, {
    expressionNotes: splitDraftList(advancedDraft.value.expressionNotes),
    feedbackCalibration: splitDraftList(advancedDraft.value.feedbackCalibration),
    growthMemories: splitDraftList(advancedDraft.value.growthMemories),
    identity: splitDraftList(advancedDraft.value.identity),
    personality: splitDraftList(advancedDraft.value.personality),
    responseBoundaries: splitDraftList(advancedDraft.value.responseBoundaries),
    scenarioBoundaries: splitDraftList(advancedDraft.value.scenarioBoundaries),
    summary: advancedDraft.value.summary.trim(),
    webSearchInterests: splitDraftList(advancedDraft.value.webSearchInterests),
    writingPreferences: splitDraftList(advancedDraft.value.writingPreferences),
  })
  if (saved)
    toast.success(t('settings.pages.card.persona_package.save_draft'))
  else
    toast.error(t('settings.pages.card.creation.errors.card_not_found'))
}

function handleSyncPersonaPackageGrowthMemories() {
  if (!props.cardId)
    return

  cardStore.syncPersonaPackageGrowthMemories(props.cardId, getPersonaGrowthMemoryTexts())
}

async function handleSolidifyPersonaGrowthCandidate(entry: NotebookEntry) {
  await memoryManager.solidifyPersonaGrowthCandidate(entry.id)
  handleSyncPersonaPackageGrowthMemories()
}

async function handleSolidifyAllPersonaGrowthCandidates() {
  for (const entry of personaGrowthCandidates.value)
    await memoryManager.solidifyPersonaGrowthCandidate(entry.id)

  handleSyncPersonaPackageGrowthMemories()
}

async function handleDisablePersonaGrowthCandidate(entry: NotebookEntry) {
  await memoryManager.disablePersonaGrowthCandidate(entry.id)
}

async function handleDisableAllPersonaGrowthCandidates() {
  for (const entry of personaGrowthCandidates.value)
    await memoryManager.disablePersonaGrowthCandidate(entry.id)
}

function isPersonaPackageSectionEnabled(sectionKey: AiriPersonaPackageSectionKey) {
  return enabledSections.value[sectionKey] !== false
}

function setPersonaPackageSectionEnabled(sectionKey: AiriPersonaPackageSectionKey, enabled: boolean) {
  if (!props.cardId)
    return

  cardStore.updatePersonaPackageEnabledSections(props.cardId, {
    [sectionKey]: enabled,
  })
}

function handleRegeneratePersonaPackageSection(sectionKey: AiriPersonaPackageSectionKey) {
  if (!props.cardId)
    return

  cardStore.regeneratePersonaPackageAdvancedProfileSections(props.cardId, [sectionKey], {
    growthMemories: getPersonaGrowthMemoryTexts(),
  })
}

function createGrowthMemoryExportEntries(): Array<{ createdAt?: number, id: string, kind?: string, text: string }> {
  return solidifiedPersonaGrowthMemories.value.map(entry => ({
    createdAt: entry.createdAt,
    id: entry.id,
    kind: typeof entry.metadata?.personaGrowthKind === 'string' ? entry.metadata.personaGrowthKind : undefined,
    text: entry.text,
  }))
}

function downloadPersonaPackage() {
  if (!selectedCard.value)
    return

  const personaPackage = cardStore.exportPersonaPackage(props.cardId, {
    growthMemories: createGrowthMemoryExportEntries(),
    privacy: {
      includeGrowthMemories: includeGrowthMemoriesInExport.value,
    },
  })
  if (!personaPackage)
    return

  const blob = new Blob([JSON.stringify(personaPackage, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `wuwiii-resident-package-${selectedCard.value.name.replace(/[^\w-]+/g, '-') || 'card'}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

// Tab type definition
interface Tab {
  id: string
  label: string
  icon: string
}

// Active tab ID state
const activeTabId = ref('')

// Tabs for card details
const tabs = computed<Tab[]>(() => {
  const availableTabs: Tab[] = []

  availableTabs.push({
    id: 'description',
    label: t('settings.pages.card.creation.identity'),
    icon: 'i-solar:document-text-linear',
  })

  // Notes tab - only show if there are creator notes
  if (selectedCard.value?.notes) {
    availableTabs.push({
      id: 'notes',
      label: t('settings.pages.card.creator_notes'),
      icon: 'i-solar:notes-linear',
    })
  }

  availableTabs.push({
    id: 'character',
    label: t('settings.pages.card.character'),
    icon: 'i-solar:user-rounded-linear',
  })

  // Modules tab - always show
  availableTabs.push({
    id: 'personaPackage',
    label: t('settings.pages.card.persona_package.title'),
    icon: 'i-solar:box-linear',
  })

  availableTabs.push({
    id: 'modules',
    label: t('settings.pages.card.modules'),
    icon: 'i-solar:tuning-square-linear',
  })

  return availableTabs
})

// Active tab state - set to first available tab by default
const activeTab = computed({
  get: () => {
    // If current active tab is not in available tabs, reset to first tab
    if (!tabs.value.find(tab => tab.id === activeTabId.value))
      return tabs.value[0]?.id || ''
    return activeTabId.value
  },
  set: (value: string) => {
    activeTabId.value = value
  },
})

// Helper function to generate placeholder text for default values
function getDefaultPlaceholder(defaultLabel: string | undefined): string {
  return defaultLabel
    ? `${t('settings.pages.card.creation.use_default')} (${defaultLabel})`
    : t('settings.pages.card.creation.use_default_not_configured')
}

function getProviderDisplayValue(value: string | undefined, defaultValue: string | undefined) {
  const providerId = value || defaultValue
  if (!providerId)
    return getDefaultPlaceholder(undefined)

  const metadata = providersStore.getProviderMetadata(providerId)
  const label = metadata?.localizedName || metadata?.name || providerId
  return value ? label : getDefaultPlaceholder(label)
}

function getResourceDisplayValue(
  resource: 'models' | 'voices',
  value: string | undefined,
  defaultValue: string | undefined,
  providerId: string | undefined,
) {
  const resourceId = value || defaultValue
  if (!resourceId)
    return getDefaultPlaceholder(undefined)

  const resourceName = resource === 'models'
    ? providersStore.getModelsForProvider(providerId || '').find(model => model.id === resourceId)?.name
    : speechStore.getVoicesForProvider(providerId || '').find(voice => voice.id === resourceId)?.name
  const label = resolveProviderResourceLabel(providerId, resource, resourceId, resourceName, t, te)
  return value ? label : getDefaultPlaceholder(label)
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent
        ref="dialogContentRef"
        tabindex="-1"
        class="fixed left-1/2 top-1/2 z-100 m-0 max-h-[90vh] max-w-6xl w-[92vw] flex flex-col overflow-auto border border-neutral-200 rounded-xl bg-white p-5 shadow-xl outline-none 2xl:w-[60vw] lg:w-[80vw] md:w-[85vw] xl:w-[70vw] -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800 sm:p-6"
        @open-auto-focus="handleDialogOpenAutoFocus"
      >
        <div v-if="selectedCard" class="w-full flex flex-col gap-5">
          <!-- Header with status indicator -->
          <div flex="~ col" gap-3>
            <div flex="~ row" items-center justify-between>
              <div>
                <div flex="~ row" items-center gap-2>
                  <DialogTitle text-2xl font-normal class="from-primary-500 to-primary-400 bg-gradient-to-r bg-clip-text text-transparent">
                    {{ selectedCard.name }}
                  </DialogTitle>
                  <div v-if="isActive" class="flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-600 font-medium dark:bg-primary-900/40 dark:text-primary-400">
                    <div i-solar:check-circle-bold-duotone text-xs />
                    {{ t('settings.pages.card.active_badge') }}
                  </div>
                </div>
                <div mt-1 text-sm text-neutral-500 dark:text-neutral-400>
                  v{{ selectedCard.version }}
                  <template v-if="selectedCard.creator">
                    · {{ t('settings.pages.card.created_by') }} <span font-medium>{{ selectedCard.creator }}</span>
                  </template>
                </div>
              </div>

              <!-- Action buttons -->
              <div flex="~ row" gap-2>
                <Button
                  v-if="props.cardId === 'default'"
                  variant="secondary"
                  icon="i-solar:restart-bold-duotone"
                  :label="t('settings.pages.card.restore_default')"
                  @click="emit('restoreDefault')"
                />
                <!-- Activation button -->
                <Button
                  variant="primary"
                  :icon="isActive ? 'i-solar:check-circle-bold-duotone' : 'i-solar:play-circle-broken'"
                  :label="isActive ? t('settings.pages.card.active') : t('settings.pages.card.activate')"
                  :disabled="isActive"
                  :class="{ 'animate-pulse': isActivating }"
                  @click="handleActivate"
                />
              </div>
            </div>

            <!-- Card content tabs -->
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

            <!-- Creator notes -->
            <div v-if="activeTab === 'notes' && selectedCard.notes">
              <div
                bg="white/60 dark:black/30"
                border="~ neutral-200/50 dark:neutral-700/30"
                max-h-60 overflow-auto whitespace-pre-line rounded-lg p-4 text-neutral-700 sm:max-h-80 dark:text-neutral-300 transition="all duration-200"
                hover="bg-white/80 dark:bg-black/40"
                v-html="highlightTagToHtml(selectedCard.notes)"
              />
            </div>

            <!-- Description section -->
            <div v-if="activeTab === 'description'">
              <div flex="~ col" gap-3>
                <div class="rounded-lg border border-primary-200/60 bg-primary-50/60 p-3 text-sm text-primary-800 dark:border-primary-500/30 dark:bg-primary-950/20 dark:text-primary-200">
                  <div class="mb-1 flex items-center gap-2 font-medium"><div i-solar:info-circle-bold-duotone />{{ t('settings.pages.card.runtime_effect') }}</div>
                  <p class="m-0 text-xs leading-5 opacity-85">{{ t('settings.pages.card.runtime_effect_description') }}</p>
                </div>
                <FieldInput v-model="nameDraft" :label="t('settings.pages.card.creation.name')" :description="t('settings.pages.card.creation.fields_info.name')" />
                <FieldInput v-model="nicknameDraft" :label="t('settings.pages.card.creation.nickname')" :description="t('settings.pages.card.creation.fields_info.nickname')" />
                <p class="m-0 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.pages.card.field_effects.description') }}</p>
                <FieldInput
                  v-model="descriptionDraft"
                  :label="t('settings.pages.card.description_label')"
                  :single-line="false"
                  input-class="min-h-40 resize-y"
                  :description="t('settings.pages.card.creation.fields_info.description')"
                />
                <FieldInput v-model="notesDraft" :label="t('settings.pages.card.creator_notes')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.notes')" />
                <FieldInput v-model="versionDraft" :label="t('settings.pages.card.creation.version')" :description="t('settings.pages.card.creation.fields_info.version')" />
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
                  <div flex="~ row wrap" items-center gap-2>
                    <Button
                      variant="secondary"
                      icon="i-solar:stars-bold-duotone"
                      :label="isOptimizingDescription ? t('settings.pages.card.creation.optimizing_description') : t('settings.pages.card.creation.optimize_description')"
                      :disabled="isOptimizingDescription || !descriptionDraft.trim()"
                      @click="handleOptimizeDescriptionWithCurrentModel"
                    />
                    <button
                      type="button"
                      class="airi-control-primary rounded-lg px-4 py-2 text-sm font-medium"
                      :disabled="!descriptionChanged"
                      @click="saveDescription"
                    >
                      {{ t('settings.pages.card.save') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Character -->
            <div v-if="activeTab === 'character'">
              <div class="mx-auto flex w-full max-w-4xl flex-col gap-5">
                <div class="rounded-lg border border-primary-200/60 bg-primary-50/60 p-3 text-xs leading-5 text-primary-800 dark:border-primary-500/30 dark:bg-primary-950/20 dark:text-primary-200">
                  {{ t('settings.pages.card.field_effects.personality') }} {{ t('settings.pages.card.field_effects.scenario') }}
                </div>
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
                    :disabled="isGeneratingCharacterSettings || !descriptionDraft.trim()"
                    @click="handleGenerateCharacterSettings"
                  />
                </div>
                <FieldInput v-model="characterDraft.personality" :label="t('settings.pages.card.personality')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.personality')" />
                <p class="m-0 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.pages.card.field_effects.personality') }}</p>
                <FieldInput v-model="characterDraft.scenario" :label="t('settings.pages.card.scenario')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.scenario')" />
                <p class="m-0 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.pages.card.field_effects.scenario') }}</p>
                <FieldInput v-model="characterDraft.systemPrompt" :label="t('settings.pages.card.systemprompt')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.systemprompt')" />
                <p class="m-0 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.pages.card.field_effects.system_prompt') }}</p>
                <FieldInput v-model="characterDraft.postHistoryInstructions" :label="t('settings.pages.card.posthistoryinstructions')" :single-line="false" :description="t('settings.pages.card.creation.fields_info.posthistoryinstructions')" />
                <p class="m-0 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.pages.card.field_effects.post_history') }}</p>
                <FieldValues v-model="characterDraft.greetings" :label="t('settings.pages.card.creation.greetings')" :description="t('settings.pages.card.creation.fields_info.greetings')" :required="false" />
                <div class="flex justify-end">
                  <button
                    type="button"
                    class="airi-control-primary rounded-lg px-4 py-2 text-sm font-medium"
                    :disabled="!characterChanged"
                    @click="saveCharacterSettings"
                  >
                    {{ t('settings.pages.card.save') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Persona Package -->
            <div v-if="activeTab === 'personaPackage'">
              <div flex="~ col" gap-4>
                <div class="rounded-lg border border-primary-200/60 bg-primary-50/60 p-3 text-xs leading-5 text-primary-800 dark:border-primary-500/30 dark:bg-primary-950/20 dark:text-primary-200">
                  <div class="mb-1 flex items-center gap-2 font-medium"><div i-solar:box-bold-duotone />{{ t('settings.pages.card.persona_package.title') }}</div>
                  {{ t('settings.pages.card.field_effects.persona_package') }}
                </div>
                <div
                  flex="~ col"
                  gap-3 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  bg="white/60 dark:black/30"
                >
                  <div
                    v-if="personaCompilerGuidance"
                    flex="~ col"
                    gap-3 rounded-lg p-3
                    border="~ primary-200/60 dark:primary-500/30"
                    bg="primary-50/60 dark:primary-950/20"
                  >
                    <div flex="~ row wrap" items-center justify-between gap-3>
                      <div flex="~ row wrap" items-center gap-2>
                        <div
                          class="border-primary-200 dark:border-primary-500/30"
                          flex="~ row"
                          items-center gap-1 border rounded-full px-2 py-1 text-xs
                          bg="white/70 dark:black/20"
                          text="primary-700 dark:primary-300"
                        >
                          <div i-solar:chart-square-bold-duotone />
                          <span>{{ getPersonaCompilerDensityText() }}</span>
                        </div>
                        <div
                          class="border-primary-200 dark:border-primary-500/30"
                          flex="~ row"
                          items-center gap-1 border rounded-full px-2 py-1 text-xs
                          bg="white/70 dark:black/20"
                          text="primary-700 dark:primary-300"
                        >
                          <div i-solar:filter-bold-duotone />
                          <span>{{ getPersonaCompilerModeText() }}</span>
                        </div>
                        <div
                          class="border-neutral-200 dark:border-neutral-700"
                          flex="~ row"
                          items-center gap-1 border rounded-full px-2 py-1 text-xs
                          bg="white/70 dark:black/20"
                          text="neutral-600 dark:neutral-300"
                        >
                          <div i-solar:document-text-bold-duotone />
                          <span>{{ personaCompilerGuidance.sourceCharCount }}</span>
                        </div>
                      </div>

                      <div flex="~ row wrap" items-center justify-end gap-2 text-xs text-neutral-500 dark:text-neutral-400>
                        <span>{{ t('settings.pages.card.persona_package.compiler.risks') }}: {{ personaCompilerRiskItems.length }}</span>
                        <span>{{ t('settings.pages.card.persona_package.compiler.search_candidates') }}: {{ personaCompilerSearchCandidates.length }}</span>
                      </div>
                    </div>

                    <div
                      v-if="personaCompilerRiskItems.length > 0"
                      flex="~ col"
                      gap-2
                    >
                      <div
                        v-for="risk in personaCompilerRiskItems"
                        :key="risk.code"
                        border rounded-lg px-3 py-2 text-xs
                        :class="getPersonaCompilerRiskClass(risk.severity)"
                      >
                        {{ risk.label }}
                      </div>
                    </div>

                    <div
                      v-if="personaCompilerSearchCandidates.length > 0"
                      flex="~ row wrap"
                      gap-2
                    >
                      <div
                        v-for="candidate in personaCompilerSearchCandidates"
                        :key="`${candidate.sourceField}:${candidate.term}`"
                        class="border-neutral-200 dark:border-neutral-700"
                        flex="~ row"
                        items-center gap-1 border rounded-full px-2 py-1 text-xs
                        bg="white/70 dark:black/20"
                        text="neutral-600 dark:neutral-300"
                      >
                        <div i-solar:magnifer-line-duotone />
                        <span>{{ candidate.term }}</span>
                      </div>
                    </div>
                  </div>

                  <div flex="~ row wrap" items-center justify-between gap-3>
                    <div flex="~ col" gap-1>
                      <div text-sm text-neutral-500 dark:text-neutral-400>
                        {{ personaPackageStatusText }}
                      </div>
                      <label flex="~ row" items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300>
                        <input
                          v-model="includeGrowthMemoriesInExport"
                          type="checkbox"
                          class="h-4 w-4"
                        >
                        {{ t('settings.pages.card.persona_package.include_growth_memories') }}
                      </label>
                    </div>

                    <div flex="~ row wrap" justify-end gap-2>
                      <Button
                        variant="secondary"
                        icon="i-solar:magic-stick-3-bold-duotone"
                        :label="t('settings.pages.card.persona_package.compile')"
                        @click="handleCompilePersonaPackageDraft"
                      />
                      <Button
                        variant="secondary"
                        icon="i-solar:stars-bold-duotone"
                        :label="isGeneratingPersonaPackage ? t('settings.pages.card.persona_package.generating') : t('settings.pages.card.persona_package.generate_with_model')"
                        :disabled="isGeneratingPersonaPackage"
                        @click="handleGeneratePersonaPackagePreview"
                      />
                      <Button
                        variant="secondary"
                        icon="i-solar:refresh-square-bold-duotone"
                        :label="t('settings.pages.card.persona_package.regenerate_all')"
                        @click="handleRegenerateAllPersonaPackageSections"
                      />
                      <Button
                        variant="secondary"
                        icon="i-solar:refresh-bold-duotone"
                        :label="t('settings.pages.card.persona_package.sync_growth')"
                        :disabled="solidifiedPersonaGrowthMemories.length === 0"
                        @click="handleSyncPersonaPackageGrowthMemories"
                      />
                      <Button
                        variant="primary"
                        icon="i-solar:download-square-bold-duotone"
                        :label="t('settings.pages.card.persona_package.export')"
                        @click="downloadPersonaPackage"
                      />
                    </div>
                  </div>

                  <div
                    v-if="personaPackageGenerationError"
                    rounded-lg p-2 text-xs text-amber-700 dark:text-amber-300
                    border="~ amber-300/60 dark:amber-500/30"
                    bg="amber-50/70 dark:amber-950/20"
                  >
                    {{ t(`settings.pages.card.persona_package.generation_error.${personaPackageGenerationError}`) }}
                  </div>

                  <div
                    v-if="pendingGeneratedPersonaProfile"
                    flex="~ col"
                    gap-3 rounded-lg p-3
                    border="~ primary-300/60 dark:primary-500/30"
                    bg="primary-50/70 dark:primary-950/20"
                  >
                    <div flex="~ row wrap" items-start justify-between gap-3>
                      <div min-w-0 flex="~ col" gap-1>
                        <h2 text-sm text-primary-700 font-medium dark:text-primary-300>
                          {{ t('settings.pages.card.persona_package.generated_preview') }}
                        </h2>
                        <div text-sm text-neutral-700 dark:text-neutral-300>
                          {{ pendingGeneratedPersonaProfile.summary }}
                        </div>
                      </div>
                      <div flex="~ row wrap" items-center justify-end gap-2>
                        <Button
                          variant="secondary"
                          icon="i-solar:trash-bin-minimalistic-bold-duotone"
                          :label="t('settings.pages.card.persona_package.discard_generated')"
                          @click="discardGeneratedPersonaPackagePreview"
                        />
                        <button
                          type="button"
                          class="airi-control-primary rounded-lg px-4 py-2 text-sm font-medium"
                          :disabled="selectedGeneratedPersonaSections.size === 0"
                          @click="applyGeneratedPersonaPackagePreview"
                        >
                          {{ t('settings.pages.card.persona_package.apply_generated') }}
                        </button>
                      </div>
                    </div>

                    <div flex="~ col" gap-2>
                      <div flex="~ row wrap" items-center justify-between gap-2>
                        <div text-xs text-neutral-600 dark:text-neutral-300>
                          {{ t('settings.pages.card.persona_package.selected_generated_sections', {
                            changed: changedGeneratedPersonaProfileDiffItems.length,
                            selected: selectedGeneratedPersonaSectionCount,
                          }) }}
                        </div>
                        <div flex="~ row wrap" items-center justify-end gap-2>
                          <Button
                            variant="secondary"
                            icon="i-solar:list-check-bold-duotone"
                            :label="t('settings.pages.card.persona_package.select_changed_generated')"
                            :disabled="changedGeneratedPersonaProfileDiffItems.length === 0"
                            @click="selectChangedGeneratedPersonaSections"
                          />
                          <Button
                            variant="secondary"
                            icon="i-solar:minus-circle-line-duotone"
                            :label="t('settings.pages.card.persona_package.clear_generated_selection')"
                            :disabled="selectedGeneratedPersonaSectionCount === 0"
                            @click="clearGeneratedPersonaSectionSelection"
                          />
                        </div>
                      </div>

                      <div
                        v-for="item in generatedPersonaProfileDiffItems"
                        :key="item.key"
                        grid="~ cols-[auto_minmax(0,1fr)_auto_auto]"
                        items-center gap-2 rounded-lg p-2 text-xs
                        border="~ neutral-200/50 dark:neutral-700/30"
                        bg="white/70 dark:black/20"
                      >
                        <input
                          type="checkbox"
                          class="h-3.5 w-3.5"
                          :checked="isGeneratedPersonaSectionSelected(item.key)"
                          @change="setGeneratedPersonaSectionSelected(item.key, ($event.target as HTMLInputElement).checked)"
                        >
                        <span min-w-0 truncate text-neutral-700 dark:text-neutral-300>{{ item.label }}</span>
                        <span text-neutral-500 dark:text-neutral-400>{{ item.currentCount }} -> {{ item.nextCount }}</span>
                        <span
                          border rounded-full px-2 py-0.5
                          :class="getGeneratedProfileDiffStatusClass(item.status)"
                        >
                          {{ t(`settings.pages.card.persona_package.diff.${item.status}`) }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-else-if="lastAppliedPersonaPackageSnapshot"
                    :class="[
                      'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2',
                      'border-primary-300/60 bg-primary-50/70 dark:border-primary-500/30 dark:bg-primary-950/20',
                    ]"
                  >
                    <span :class="['text-sm text-primary-700 dark:text-primary-300']">
                      {{ t('settings.pages.card.persona_package.applied_generated') }}
                    </span>
                    <Button
                      variant="secondary"
                      icon="i-solar:undo-left-round-bold-duotone"
                      :label="t('settings.pages.card.persona_package.undo_applied')"
                      @click="undoGeneratedPersonaPackageApplication"
                    />
                  </div>
                </div>

                <div
                  flex="~ col"
                  gap-2 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  bg="white/60 dark:black/30"
                >
                  <p text-xs text-neutral-500 leading-5 dark:text-neutral-400>
                    {{ t('settings.pages.card.persona_package.edit_help') }}
                  </p>
                  <div flex="~ row" items-center justify-between gap-3>
                    <label text-sm text-neutral-500 dark:text-neutral-400>
                      {{ t('settings.pages.card.persona_package.sections.summary') }}
                    </label>
                    <div flex="~ row" items-center gap-2>
                      <label flex="~ row" items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400>
                        <input
                          type="checkbox"
                          class="h-3.5 w-3.5"
                          :checked="isPersonaPackageSectionEnabled('summary')"
                          @change="setPersonaPackageSectionEnabled('summary', ($event.target as HTMLInputElement).checked)"
                        >
                        {{ t('settings.pages.card.persona_package.section_enabled') }}
                      </label>
                      <Button
                        variant="secondary"
                        icon="i-solar:refresh-bold-duotone"
                        :label="t('settings.pages.card.persona_package.regenerate_section')"
                        @click="handleRegeneratePersonaPackageSection('summary')"
                      />
                    </div>
                  </div>
                  <p text-xs text-neutral-500 leading-5 dark:text-neutral-400>
                    {{ t('settings.pages.card.persona_package.section_help.summary') }}
                  </p>
                  <textarea
                    v-model="advancedDraft.summary"
                    rows="3"
                    class="w-full resize-y border border-neutral-200 rounded-lg bg-white/70 p-3 text-sm outline-none dark:border-neutral-700 dark:bg-black/30"
                  />
                </div>

                <div grid="~ cols-1 lg:cols-2" gap-3>
                  <div
                    v-for="section in advancedDraftSections"
                    :key="section.key"
                    flex="~ col"
                    gap-2 rounded-lg p-3
                    border="~ neutral-200/50 dark:neutral-700/30"
                    bg="white/60 dark:black/30"
                  >
                    <div flex="~ row" items-center justify-between gap-3>
                      <label text-sm text-neutral-500 dark:text-neutral-400>
                        {{ section.label }}
                      </label>
                      <div flex="~ row" items-center gap-2>
                        <label flex="~ row" items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400>
                          <input
                            type="checkbox"
                            class="h-3.5 w-3.5"
                            :checked="isPersonaPackageSectionEnabled(section.key)"
                            @change="setPersonaPackageSectionEnabled(section.key, ($event.target as HTMLInputElement).checked)"
                          >
                          {{ t('settings.pages.card.persona_package.section_enabled') }}
                        </label>
                        <Button
                          variant="secondary"
                          icon="i-solar:refresh-bold-duotone"
                          :label="t('settings.pages.card.persona_package.regenerate_section')"
                          @click="handleRegeneratePersonaPackageSection(section.key)"
                        />
                      </div>
                    </div>
                    <p text-xs text-neutral-500 leading-5 dark:text-neutral-400>
                      {{ t(`settings.pages.card.persona_package.section_help.${section.key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`) }}
                    </p>
                    <textarea
                      v-model="advancedDraft[section.key]"
                      rows="5"
                      class="w-full resize-y border border-neutral-200 rounded-lg bg-white/70 p-3 text-sm outline-none dark:border-neutral-700 dark:bg-black/30"
                    />
                  </div>
                </div>

                <div flex="~ row" justify-end>
                  <button
                    type="button"
                    class="airi-control-primary self-start rounded-lg px-4 py-2 text-sm font-medium"
                    @click="handleSaveAdvancedDraft"
                  >
                    {{ t('settings.pages.card.persona_package.save_draft') }}
                  </button>
                </div>

                <div
                  flex="~ col"
                  gap-3 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  bg="white/60 dark:black/30"
                >
                  <div flex="~ row" items-center justify-between gap-3>
                    <h2 text-lg text-neutral-500 font-medium dark:text-neutral-400>
                      {{ t('settings.pages.card.persona_package.growth_candidates') }}
                    </h2>
                    <div flex="~ row wrap" items-center justify-end gap-2>
                      <div text-sm text-neutral-500 dark:text-neutral-400>
                        {{ personaGrowthCandidates.length }}
                      </div>
                      <Button
                        variant="secondary"
                        icon="i-solar:archive-check-bold-duotone"
                        :label="t('settings.pages.card.persona_package.solidify_all_candidates')"
                        :disabled="personaGrowthCandidates.length === 0"
                        @click="handleSolidifyAllPersonaGrowthCandidates"
                      />
                      <Button
                        variant="secondary"
                        icon="i-solar:trash-bin-minimalistic-bold-duotone"
                        :label="t('settings.pages.card.persona_package.ignore_all_candidates')"
                        :disabled="personaGrowthCandidates.length === 0"
                        @click="handleDisableAllPersonaGrowthCandidates"
                      />
                    </div>
                  </div>

                  <div v-if="personaGrowthCandidates.length === 0" text-sm text-neutral-500 dark:text-neutral-400>
                    {{ t('settings.pages.card.persona_package.no_growth_candidates') }}
                  </div>

                  <div v-else flex="~ col" max-h-52 gap-2 overflow-auto pr-1>
                    <div
                      v-for="entry in personaGrowthCandidates"
                      :key="entry.id"
                      flex="~ row"
                      items-start justify-between gap-3 rounded-lg p-3
                      border="~ neutral-200/50 dark:neutral-700/30"
                      bg="neutral-50/70 dark:neutral-900/50"
                    >
                      <div min-w-0 flex-1 whitespace-pre-line text-sm text-neutral-700 dark:text-neutral-300>
                        {{ entry.text }}
                      </div>
                      <Button
                        variant="secondary"
                        icon="i-solar:archive-check-bold-duotone"
                        :label="t('settings.pages.card.persona_package.solidify_candidate')"
                        @click="handleSolidifyPersonaGrowthCandidate(entry)"
                      />
                      <Button
                        variant="secondary"
                        icon="i-solar:trash-bin-minimalistic-bold-duotone"
                        :label="t('settings.pages.card.persona_package.ignore_candidate')"
                        @click="handleDisablePersonaGrowthCandidate(entry)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Modules -->
            <div v-if="activeTab === 'modules'">
              <section
                :class="[
                  'mb-4 grid grid-cols-1 gap-4 border-b pb-4 lg:grid-cols-[minmax(0,1fr)_18rem]',
                  'border-neutral-200/70 dark:border-neutral-700/50',
                ]"
                :aria-busy="displayModelsFromIndexedDBLoading"
              >
                <div class="min-w-0 flex items-center gap-3">
                  <div
                    :class="[
                      'grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border',
                      'border-neutral-200/70 bg-neutral-100 text-neutral-400 dark:border-neutral-700/60 dark:bg-neutral-900/70 dark:text-neutral-500',
                    ]"
                  >
                    <img
                      v-if="resolvedDisplayModel?.previewImage"
                      :src="resolvedDisplayModel.previewImage"
                      :alt="resolvedDisplayModel.name"
                      class="size-full object-cover"
                    >
                    <div v-else class="i-solar:body-shape-minimalistic-linear size-8" aria-hidden="true" />
                  </div>
                  <div class="min-w-0">
                    <h3 class="flex items-center gap-2 text-sm text-neutral-900 font-semibold dark:text-neutral-100">
                      <span class="i-solar:body-shape-minimalistic-bold-duotone size-4 text-primary-500" aria-hidden="true" />
                      {{ t('settings.pages.card.display_model.title') }}
                    </h3>
                    <p class="mt-1 text-xs text-neutral-500 leading-5 dark:text-neutral-400">
                      {{ t('settings.pages.card.display_model.description') }}
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span class="min-w-0 max-w-full truncate rounded-md bg-neutral-100 px-2 py-1 text-neutral-600 dark:bg-neutral-900/70 dark:text-neutral-300">
                        {{ resolvedDisplayModel?.name ?? t('settings.pages.card.display_model.use_default') }}
                      </span>
                      <span v-if="resolvedDisplayModel" class="rounded-md bg-primary-500/10 px-2 py-1 text-primary-600 dark:text-primary-300">
                        {{ getDisplayModelFormatLabel(resolvedDisplayModel.format) }}
                      </span>
                      <span class="text-neutral-500 dark:text-neutral-400">
                        {{ isActive ? t('settings.pages.card.display_model.active') : t('settings.pages.card.display_model.when_active') }}
                      </span>
                    </div>
                  </div>
                </div>

                <div class="min-w-0 flex flex-col justify-center gap-2">
                  <Select
                    v-model="boundDisplayModelId"
                    :options="displayModelOptions"
                    :placeholder="t('settings.pages.card.display_model.use_default')"
                    :aria-label="t('settings.pages.card.display_model.title')"
                    :disabled="displayModelsFromIndexedDBLoading"
                  />
                  <div :class="['grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]']">
                    <Button
                      class="min-w-0 w-full"
                      variant="secondary"
                      icon="i-solar:upload-minimalistic-bold-duotone"
                      :label="t('settings.pages.card.display_model.import_live2d')"
                      :disabled="importingDisplayModel"
                      @click="live2dImportDialog.open()"
                    />
                    <Button
                      class="min-w-0 w-full"
                      variant="secondary"
                      icon="i-solar:upload-minimalistic-bold-duotone"
                      :label="t('settings.pages.card.display_model.import_vrm')"
                      :disabled="importingDisplayModel"
                      @click="vrmImportDialog.open()"
                    />
                    <Button
                      class="min-w-0 w-full"
                      variant="secondary"
                      icon="i-solar:gallery-add-bold-duotone"
                      :label="t('settings.pages.card.display_model.import_picture_oc')"
                      :disabled="importingDisplayModel"
                      @click="pictureOcImportDialog.open()"
                    />
                  </div>
                  <p class="text-[11px] text-neutral-500 leading-4 dark:text-neutral-400">
                    {{ t('settings.pages.card.display_model.local_reference') }}
                  </p>

                  <div
                    v-if="boundDisplayModel?.format === DisplayModelFormat.PictureOcZip"
                    :class="[
                      'mt-1 grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2',
                      'border-primary-200/70 bg-primary-50/50 dark:border-primary-900/60 dark:bg-primary-950/20',
                    ]"
                  >
                    <div class="sm:col-span-2">
                      <h4 class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">
                        {{ t('settings.pages.card.display_model.actions_title') }}
                      </h4>
                      <p class="mt-1 text-[11px] text-neutral-500 leading-4 dark:text-neutral-400">
                        {{ t('settings.pages.card.display_model.actions_description') }}
                      </p>
                    </div>
                    <div v-for="entry in pictureOcActionOptions" :key="entry.action" class="min-w-0">
                      <label class="mb-1 block text-[11px] text-neutral-600 dark:text-neutral-300">
                        {{ entry.label }}
                      </label>
                      <Select
                        :model-value="entry.value"
                        :options="pictureOcImageOptions"
                        :aria-label="entry.label"
                        @update:model-value="value => pictureOcActionDraft[entry.action] = String(value)"
                      />
                    </div>
                    <div class="flex justify-end sm:col-span-2">
                      <Button
                        variant="secondary"
                        icon="i-solar:diskette-bold-duotone"
                        :label="t('settings.pages.card.display_model.actions_save')"
                        @click="savePictureOcActions"
                      />
                    </div>
                  </div>
                </div>

                <div
                  v-if="displayModelBindingMissing"
                  role="status"
                  :class="[
                    'sm:col-span-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5',
                    'border-amber-300/70 bg-amber-50/80 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-200',
                  ]"
                >
                  <span class="i-solar:danger-triangle-bold-duotone mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{{ t('settings.pages.card.display_model.missing', { id: boundDisplayModelId }) }}</span>
                </div>
              </section>

              <div grid="~ cols-1 sm:cols-2" gap-4>
                <div
                  flex="~ col"
                  bg="white/60 dark:black/30"
                  gap-1 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  transition="all duration-200"
                  hover="bg-white/80 dark:bg-black/40"
                >
                  <span flex="~ row" items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400>
                    <div i-lucide:brain />
                    {{ t('settings.pages.card.chat.provider') }}
                  </span>
                  <div truncate font-medium>
                    {{ getProviderDisplayValue(moduleSettings.consciousnessProvider, consciousnessProvider) }}
                  </div>
                </div>

                <div
                  flex="~ col"
                  bg="white/60 dark:black/30"
                  gap-1 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  transition="all duration-200"
                  hover="bg-white/80 dark:bg-black/40"
                >
                  <span flex="~ row" items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400>
                    <div i-lucide:ghost />
                    {{ t('settings.pages.card.consciousness.model') }}
                  </span>
                  <div truncate font-medium>
                    {{ getResourceDisplayValue('models', moduleSettings.consciousness, defaultConsciousnessModel, moduleSettings.consciousnessProvider || consciousnessProvider) }}
                  </div>
                </div>

                <div
                  flex="~ col"
                  bg="white/60 dark:black/30"
                  gap-1 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  transition="all duration-200"
                  hover="bg-white/80 dark:bg-black/40"
                >
                  <span flex="~ row" items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400>
                    <div i-lucide:radio />
                    {{ t('settings.pages.card.speech.provider') }}
                  </span>
                  <div truncate font-medium>
                    {{ getProviderDisplayValue(moduleSettings.speechProvider, speechProvider) }}
                  </div>
                </div>

                <div
                  flex="~ col"
                  bg="white/60 dark:black/30"
                  gap-2 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  transition="all duration-200"
                  hover="bg-white/80 dark:bg-black/40"
                >
                  <span flex="~ row" items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400>
                    <div i-lucide:mic />
                    {{ t('settings.pages.card.speech.model') }}
                  </span>
                  <div truncate font-medium>
                    {{ getResourceDisplayValue('models', moduleSettings.speech, defaultSpeechModel, moduleSettings.speechProvider || speechProvider) }}
                  </div>
                </div>

                <div
                  flex="~ col"
                  bg="white/60 dark:black/30"
                  gap-2 rounded-lg p-3
                  border="~ neutral-200/50 dark:neutral-700/30"
                  transition="all duration-200"
                  hover="bg-white/80 dark:bg-black/40"
                >
                  <span flex="~ row" items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400>
                    <div i-lucide:music />
                    {{ t('settings.pages.card.speech.voice') }}
                  </span>
                  <div truncate font-medium>
                    {{ getResourceDisplayValue('voices', moduleSettings.voice, defaultVoiceId, moduleSettings.speechProvider || speechProvider) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-else
          bg="neutral-50/50 dark:neutral-900/50"
          rounded-xl p-8 text-center
          border="~ neutral-200/50 dark:neutral-700/30"
          shadow="sm"
        >
          <div i-solar:card-search-broken mx-auto mb-3 text-6xl text-neutral-400 />
          {{ t('settings.pages.card.card_not_found') }}
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Delete confirmation dialog -->
  <DeleteCardDialog
    v-model="showDeleteConfirm"
    :card-name="selectedCard?.name"
    @confirm="handleDeleteConfirm"
    @cancel="showDeleteConfirm = false"
  />
</template>
