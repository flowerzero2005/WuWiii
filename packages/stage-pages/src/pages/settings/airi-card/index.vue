<script setup lang="ts">
import type { ccv3 } from '@proj-airi/ccc'
import type {
  AiriPersonaPackage,
  AiriPersonaPackageSectionKey,
} from '@proj-airi/stage-ui/stores/modules/persona-package'

import { Alert } from '@proj-airi/stage-ui/components'
import { useDownload } from '@proj-airi/stage-ui/composables/download'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { AIRI_PERSONA_PACKAGE_SECTION_KEYS } from '@proj-airi/stage-ui/stores/modules/persona-package'
import { Button, InputFile } from '@proj-airi/ui'
import { Select } from '@proj-airi/ui/components/form'
import { storeToRefs } from 'pinia'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CardCreate from './components/CardCreate.vue'
import CardCreationDialog from './components/CardCreationDialog.vue'
import CardDetailDialog from './components/CardDetailDialog.vue'
import CardListItem from './components/CardListItem.vue'
import DeleteCardDialog from './components/DeleteCardDialog.vue'

const { t } = useI18n()
const cardStore = useAiriCardStore()
const { addCard, addPersonaPackage, removeCard, restoreDefaultCard, updateCardFromPersonaPackage } = cardStore
const { cards, activeCardId } = storeToRefs(cardStore)

function exportActivePersonaPackage() {
  if (!activeCardId.value)
    return
  const payload = cardStore.exportPersonaPackage(activeCardId.value)
  if (!payload)
    return
  useDownload(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${payload.card.name || 'airi-persona'}.json`).download()
}

// Currently selected card ID (different from active card ID)
const selectedCardId = ref<string>('')
// Currently editing card ID
const editingCardId = ref<string>('')
// Dialog state
const isCardDialogOpen = ref(false)
const isCardCreationDialogOpen = ref(false)

// Search query
const searchQuery = ref('')

// Sort option
const sortOption = ref('nameAsc')

const inputFiles = ref<File[]>([])
const pendingPersonaPackageImport = ref<AiriPersonaPackage | null>(null)
const isPersonaPackageImportDialogOpen = ref(false)
const isRestoreDefaultCardDialogOpen = ref(false)

// Card list data structure
interface CardItem {
  id: string
  name: string
  description?: string
  deprecated?: boolean
  customizable?: boolean
}

interface PersonaPackageImportDiffItem {
  current: string
  label: string
  next: string
  status: 'added' | 'changed' | 'unchanged'
}

watch(inputFiles, async (newFiles) => {
  const file = newFiles[0]
  if (!file)
    return

  try {
    const content = await file.text()
    const personaPackage = cardStore.parsePersonaPackageJson(content)
    if (personaPackage) {
      pendingPersonaPackageImport.value = personaPackage
      isPersonaPackageImportDialogOpen.value = true
      inputFiles.value = []
      return
    }

    const cardJSON = JSON.parse(content) as ccv3.CharacterCardV3

    // Add card and select it
    selectedCardId.value = addCard(cardJSON)
    isCardDialogOpen.value = true
  }
  catch (error) {
    console.error('Error processing card file:', error)
  }
})

const activeCardName = computed(() => {
  return cards.value.get(activeCardId.value)?.name ?? ''
})

const activeCard = computed(() => {
  return cards.value.get(activeCardId.value)
})

const personaPackageSectionLabelKeys: Record<AiriPersonaPackageSectionKey, string> = {
  expressionNotes: 'settings.pages.card.persona_package.sections.expression_notes',
  feedbackCalibration: 'settings.pages.card.persona_package.sections.feedback_calibration',
  growthMemories: 'settings.pages.card.persona_package.sections.growth_memories',
  identity: 'settings.pages.card.persona_package.sections.identity',
  personality: 'settings.pages.card.persona_package.sections.personality',
  responseBoundaries: 'settings.pages.card.persona_package.sections.response_boundaries',
  scenarioBoundaries: 'settings.pages.card.persona_package.sections.scenario_boundaries',
  summary: 'settings.pages.card.persona_package.sections.summary',
  webSearchInterests: 'settings.pages.card.persona_package.sections.web_search_interests',
  writingPreferences: 'settings.pages.card.persona_package.sections.writing_preferences',
}

const pendingPersonaPackageSummary = computed(() => {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage)
    return ''

  return personaPackage.advancedProfile?.summary
    || personaPackage.card.description
    || personaPackage.card.personality
    || ''
})

function normalizeDiffText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function previewDiffText(value: string) {
  if (!value)
    return '—'

  return value.length > 120 ? `${value.slice(0, 119).trim()}...` : value
}

function createDiffItem(label: string, currentValue: unknown, nextValue: unknown): PersonaPackageImportDiffItem {
  const current = normalizeDiffText(currentValue)
  const next = normalizeDiffText(nextValue)

  return {
    current: previewDiffText(current),
    label,
    next: previewDiffText(next),
    status: current === next ? 'unchanged' : current ? 'changed' : 'added',
  }
}

function countPersonaPackageSectionItems(
  profile: AiriPersonaPackage['advancedProfile'],
  sectionKey: AiriPersonaPackageSectionKey,
) {
  if (!profile)
    return 0

  if (sectionKey === 'summary')
    return profile.summary ? 1 : 0

  return profile[sectionKey]?.length ?? 0
}

function countEnabledPersonaPackageSections(
  profile: AiriPersonaPackage['advancedProfile'],
  enabledSections: AiriPersonaPackage['enabledSections'],
) {
  return AIRI_PERSONA_PACKAGE_SECTION_KEYS.filter((sectionKey) => {
    return enabledSections?.[sectionKey] !== false
      && countPersonaPackageSectionItems(profile, sectionKey) > 0
  }).length
}

const pendingPersonaPackageDiffItems = computed<PersonaPackageImportDiffItem[]>(() => {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage)
    return []

  const currentCard = activeCard.value
  const currentPersonaPackage = cardStore.getPersonaPackageExtension(currentCard)
  const currentAdvancedSections = countEnabledPersonaPackageSections(
    currentPersonaPackage?.advancedProfile,
    currentPersonaPackage?.enabledSections,
  )
  const nextAdvancedSections = countEnabledPersonaPackageSections(
    personaPackage.advancedProfile,
    personaPackage.enabledSections,
  )

  return [
    createDiffItem(t('settings.pages.card.persona_package.diff.name'), currentCard?.name, personaPackage.card.name),
    createDiffItem(t('settings.pages.card.persona_package.diff.version'), currentCard?.version, personaPackage.card.version),
    createDiffItem(t('settings.pages.card.persona_package.diff.description'), currentCard?.description, personaPackage.card.description),
    createDiffItem(t('settings.pages.card.persona_package.diff.personality'), currentCard?.personality, personaPackage.card.personality),
    createDiffItem(t('settings.pages.card.persona_package.diff.scenario'), currentCard?.scenario, personaPackage.card.scenario),
    createDiffItem(t('settings.pages.card.persona_package.diff.system_prompt'), currentCard?.systemPrompt, personaPackage.card.systemPrompt),
    createDiffItem(
      t('settings.pages.card.persona_package.diff.advanced_sections'),
      currentAdvancedSections > 0 ? currentAdvancedSections : '',
      nextAdvancedSections > 0 ? nextAdvancedSections : '',
    ),
  ]
})

const pendingPersonaPackageSectionSummary = computed(() => {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage?.advancedProfile)
    return []

  return AIRI_PERSONA_PACKAGE_SECTION_KEYS
    .map(sectionKey => ({
      count: countPersonaPackageSectionItems(personaPackage.advancedProfile, sectionKey),
      enabled: personaPackage.enabledSections?.[sectionKey] !== false,
      key: sectionKey,
      label: t(personaPackageSectionLabelKeys[sectionKey]),
    }))
    .filter(section => section.count > 0)
})

const pendingPersonaPackagePrivacyText = computed(() => {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage)
    return ''

  return personaPackage.privacy.includeGrowthMemories
    ? t('settings.pages.card.persona_package.privacy_includes_growth')
    : t('settings.pages.card.persona_package.privacy_excludes_growth')
})

function getDiffStatusClass(status: PersonaPackageImportDiffItem['status']) {
  if (status === 'changed')
    return 'airi-status-warning'
  if (status === 'added')
    return 'airi-status-info'
  return 'airi-status-neutral'
}

function clearPendingPersonaPackageImport() {
  pendingPersonaPackageImport.value = null
  isPersonaPackageImportDialogOpen.value = false
}

function importPersonaPackageAsNewCard() {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage)
    return

  selectedCardId.value = addPersonaPackage(personaPackage)
  isCardDialogOpen.value = true
  clearPendingPersonaPackageImport()
}

function overwriteActiveCardWithPersonaPackage() {
  const personaPackage = pendingPersonaPackageImport.value
  if (!personaPackage || !activeCardId.value)
    return

  updateCardFromPersonaPackage(activeCardId.value, personaPackage)
  selectedCardId.value = activeCardId.value
  isCardDialogOpen.value = true
  clearPendingPersonaPackageImport()
}

// Transform cards Map to array for display
const cardsArray = computed<CardItem[]>(() =>
  Array.from(cards.value.entries()).map(([id, card]) => ({
    id,
    name: card.name,
    description: card.description,
  })),
)

// Filtered cards based on search query
const filteredCards = computed<CardItem[]>(() => {
  if (!searchQuery.value)
    return cardsArray.value

  const query = searchQuery.value.toLowerCase()
  return cardsArray.value.filter(item =>
    item.name.toLowerCase().includes(query)
    || (item.description && item.description.toLowerCase().includes(query)),
  )
})

// Sorted filtered cards based on sort option
const sortedFilteredCards = computed<CardItem[]>(() => {
  // Create a new array to avoid mutating the source
  const sorted = [...filteredCards.value]

  if (sortOption.value === 'nameAsc')
    return sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (sortOption.value === 'nameDesc')
    return sorted.sort((a, b) => b.name.localeCompare(a.name))
  else if (sortOption.value === 'recent')
    return sorted.sort((a, b) => b.id.localeCompare(a.id))
  else
    return sorted
})

// Delete confirmation
const showDeleteConfirm = ref(false)
const cardToDelete = ref<string | null>(null)

function handleDeleteConfirm() {
  if (cardToDelete.value) {
    removeCard(cardToDelete.value)
    cardToDelete.value = null
    showDeleteConfirm.value = false
  }
}

function handleRestoreDefaultCard() {
  restoreDefaultCard()
  isRestoreDefaultCardDialogOpen.value = false
}

// Card deletion confirmation
function confirmDelete(id: string) {
  cardToDelete.value = id
  showDeleteConfirm.value = true
}

function handleSelectCard(cardId: string) {
  // Verify card exists before opening dialog
  if (!cards.value.has(cardId)) {
    console.error(`Card with id ${cardId} not found`)
    return
  }
  selectedCardId.value = cardId
  isCardDialogOpen.value = true
}

function handleEditCard(cardId: string) {
  handleSelectCard(cardId)
}

function handleCardCreationDialog() {
  editingCardId.value = '' // Clear editing state for new card creation
  isCardCreationDialogOpen.value = true
}

// Card activation
function activateCard(id: string) {
  activeCardId.value = id
}

// Clear editing state when creation/edit dialog closes
watch(isCardCreationDialogOpen, (isOpen) => {
  if (!isOpen) {
    editingCardId.value = ''
  }
})

// Card version number
function getVersionNumber(id: string) {
  const card = cards.value.get(id)
  return card?.version || '1.0.0'
}

// Card module short name
function getModuleShortName(id: string, module: 'consciousness' | 'voice') {
  const card = cards.value.get(id)
  if (!card || !card.extensions?.airi?.modules)
    return 'default'

  const airiExt = card.extensions.airi.modules

  if (module === 'consciousness') {
    return airiExt.consciousness?.model ? airiExt.consciousness.model.split('-').pop() || 'default' : 'default'
  }
  else if (module === 'voice') {
    return airiExt.speech?.voice_id || 'default'
  }

  return 'default'
}
</script>

<template>
  <div :class="['airi-surface-panel', 'rounded-xl p-4', 'flex flex-col gap-4']">
    <!-- Toolbar with search and filters -->
    <div flex="~ row" flex-wrap items-center justify-between gap-4>
      <!-- Search bar -->
      <div class="relative min-w-[200px] flex-1" inline-flex="~" w-full items-center>
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <div i-solar:magnifer-line-duotone class="airi-text-muted" />
        </div>
        <input
          v-model="searchQuery"
          type="search"
          :class="['airi-input', 'w-full py-2.5 pl-10 pr-3']"
          :placeholder="t('settings.pages.card.search')"
        >
      </div>

      <!-- Sort options -->
      <div class="relative flex flex-row justify-start gap-2 lg:flex-col">
        <div :class="['airi-text-muted', 'top-[-32px] whitespace-nowrap text-sm leading-10 lg:absolute']">
          {{ t('settings.pages.card.sort_by') }}:
        </div>
        <Select
          v-model="sortOption"
          :options="[
            { value: 'nameAsc', label: t('settings.pages.card.name_asc') },
            { value: 'nameDesc', label: t('settings.pages.card.name_desc') },
            { value: 'recent', label: t('settings.pages.card.recent') },
          ]"
          :placeholder="t('settings.pages.card.sort_placeholder')"
          class="min-w-[150px]"
        />
      </div>
      <Button variant="secondary" :disabled="!activeCardId" @click="exportActivePersonaPackage">
        <div i-solar:download-square-line-duotone />
        {{ t('settings.pages.card.persona_package.export') }}
      </Button>
    </div>

    <!-- Masonry card layout -->
    <div
      class="mt-4"
      :class="{ 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 grid-auto-rows-[minmax(min-content,max-content)] grid-auto-flow-dense sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-5 md:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]': cards.size > 0 }"
    >
      <!-- Upload card -->
      <InputFile v-model="inputFiles" accept="*.json">
        <template #default="{ isDragging }">
          <template v-if="!isDragging">
            <div flex flex-col items-center>
              <div i-solar:upload-square-line-duotone :class="['airi-text-muted', 'mb-4 text-5xl']" />
              <p :class="['airi-text', 'font-medium']">
                {{ t('settings.pages.card.upload') }}
              </p>
              <p :class="['airi-text-muted', 'mt-2 text-sm']">
                {{ t('settings.pages.card.upload_desc') }}
              </p>
            </div>
          </template>
          <template v-else>
            <div flex flex-col items-center>
              <div i-solar:upload-minimalistic-bold class="mb-2 text-5xl text-primary-500 dark:text-primary-400" />
              <p font-medium text="primary-600 dark:primary-300">
                {{ t('settings.pages.card.drop_here') }}
              </p>
            </div>
          </template>
        </template>
      </InputFile>

      <!-- Create card -->
      <CardCreate @click="handleCardCreationDialog" />

      <!-- Card Items -->
      <template v-if="cards.size > 0">
        <CardListItem
          v-for="item in sortedFilteredCards"
          :id="item.id"
          :key="item.id"
          :name="item.name"
          :description="item.description"
          :is-active="item.id === activeCardId"
          :is-selected="item.id === selectedCardId && isCardDialogOpen"
          :version="getVersionNumber(item.id)"
          :consciousness-model="getModuleShortName(item.id, 'consciousness')"
          :voice-model="getModuleShortName(item.id, 'voice')"
          @select="handleSelectCard(item.id)"
          @activate="activateCard(item.id)"
          @delete="confirmDelete(item.id)"
          @edit="handleEditCard(item.id)"
        />
      </template>

      <!-- No cards message -->
      <div
        v-if="cards.size === 0"
        :class="['airi-card', 'col-span-full rounded-lg p-8 text-center']"
      >
        <div i-solar:card-search-broken :class="['airi-text-muted', 'mx-auto mb-3 text-6xl']" />
        <p class="airi-text-muted">
          {{ t('settings.pages.card.no_cards') }}
        </p>
      </div>

      <!-- No search results -->
      <Alert v-if="searchQuery && sortedFilteredCards.length === 0" type="warning">
        <template #title>
          {{ t('settings.pages.card.no_results') }}
        </template>
        <template #content>
          {{ t('settings.pages.card.try_different_search') }}
        </template>
      </Alert>
    </div>
  </div>

  <!-- Delete confirmation dialog -->
  <DeleteCardDialog
    v-model="showDeleteConfirm"
    :card-name="cardToDelete ? cardStore.getCard(cardToDelete)?.name : ''"
    @confirm="handleDeleteConfirm"
    @cancel="cardToDelete = null"
  />

  <!-- Card detail dialog -->
  <CardDetailDialog
    v-model="isCardDialogOpen"
    :card-id="selectedCardId"
    @restore-default="isRestoreDefaultCardDialogOpen = true"
  />

  <!-- Card creation/edit dialog -->
  <CardCreationDialog
    v-model="isCardCreationDialogOpen"
    :card-id="editingCardId"
  />

  <AlertDialogRoot :open="isRestoreDefaultCardDialogOpen" @update:open="isRestoreDefaultCardDialogOpen = $event">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50 backdrop-blur-sm']" />
      <AlertDialogContent
        :class="[
          'airi-surface-panel',
          'fixed left-1/2 top-1/2 z-100 max-w-md w-[calc(100vw-2rem)]',
          'rounded-xl p-6 shadow-xl -translate-x-1/2 -translate-y-1/2',
        ]"
      >
        <AlertDialogTitle :class="['text-xl font-normal airi-text']">
          {{ t('settings.pages.card.restore_default') }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mt-4 airi-text-muted']">
          {{ t('settings.pages.card.restore_default_confirmation') }}
        </AlertDialogDescription>
        <div :class="['mt-6 flex flex-row justify-end gap-3']">
          <AlertDialogCancel as-child>
            <Button variant="secondary" :label="t('settings.pages.card.cancel')" />
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <Button
              variant="primary"
              icon="i-solar:restart-bold-duotone"
              :label="t('settings.pages.card.restore')"
              @click="handleRestoreDefaultCard"
            />
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>

  <DialogRoot :open="isPersonaPackageImportDialogOpen" @update:open="(value) => { if (!value) clearPendingPersonaPackageImport() }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent
        :class="[
          'airi-surface-panel',
          'fixed left-1/2 top-1/2 z-100 m-0 max-h-[90vh] max-w-2xl w-[92vw]',
          'flex flex-col overflow-auto rounded-xl p-5 shadow-xl -translate-x-1/2 -translate-y-1/2 sm:p-6',
          'data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow',
        ]"
      >
        <div v-if="pendingPersonaPackageImport" flex="~ col" gap-4>
          <DialogTitle text-2xl font-normal class="from-primary-500 to-primary-400 bg-gradient-to-r bg-clip-text text-transparent">
            {{ t('settings.pages.card.persona_package.import_title') }}
          </DialogTitle>

          <p :class="['airi-text-muted', 'text-sm']">
            {{ t('settings.pages.card.persona_package.import_description') }}
          </p>

          <div
            grid="~ cols-1 sm:cols-2"
            gap-3
          >
            <div
              flex="~ col"
              :class="['airi-card', 'gap-1 rounded-lg p-3']"
            >
              <span :class="['airi-text-muted', 'text-xs uppercase']">{{ t('settings.pages.card.active') }}</span>
              <span font-medium>{{ activeCardName || t('settings.pages.card.card_not_found') }}</span>
            </div>
            <div
              flex="~ col"
              :class="['airi-card', 'gap-1 rounded-lg p-3']"
            >
              <span :class="['airi-text-muted', 'text-xs uppercase']">{{ t('settings.pages.card.persona_package.title') }}</span>
              <span font-medium>{{ pendingPersonaPackageImport.card.name }}</span>
              <span :class="['airi-text-muted', 'text-xs']">v{{ pendingPersonaPackageImport.card.version }}</span>
            </div>
          </div>

          <div
            v-if="pendingPersonaPackageSummary"
            :class="['airi-surface-glass', 'max-h-36 overflow-auto whitespace-pre-line rounded-lg p-3 text-sm']"
          >
            {{ pendingPersonaPackageSummary }}
          </div>

          <div
            flex="~ col"
            :class="['airi-surface-glass', 'gap-3 rounded-lg p-3']"
          >
            <h2 :class="['airi-text-muted', 'text-sm font-medium']">
              {{ t('settings.pages.card.persona_package.import_changes') }}
            </h2>

            <div flex="~ col" gap-2>
              <div
                v-for="item in pendingPersonaPackageDiffItems"
                :key="item.label"
                grid="~ cols-1 sm:cols-[8rem_1fr_auto]"
                :class="['airi-card', 'items-start gap-2 rounded-lg p-2']"
              >
                <div :class="['airi-text-muted', 'text-xs font-medium']">
                  {{ item.label }}
                </div>
                <div min-w-0 flex="~ col" gap-1 text-xs>
                  <div :class="['airi-text-muted', 'truncate']">
                    {{ item.current }}
                  </div>
                  <div class="truncate airi-text">
                    {{ item.next }}
                  </div>
                </div>
                <div
                  border rounded-full px-2 py-0.5 text-xs
                  :class="getDiffStatusClass(item.status)"
                >
                  {{ t(`settings.pages.card.persona_package.diff.${item.status}`) }}
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="pendingPersonaPackageSectionSummary.length > 0"
            flex="~ col"
            :class="['airi-surface-glass', 'gap-3 rounded-lg p-3']"
          >
            <h2 :class="['airi-text-muted', 'text-sm font-medium']">
              {{ t('settings.pages.card.persona_package.import_package_meta') }}
            </h2>

            <div flex="~ row wrap" gap-2>
              <div
                v-for="section in pendingPersonaPackageSectionSummary"
                :key="section.key"
                flex="~ row"
                items-center gap-2 border rounded-full px-2 py-1 text-xs
                :class="section.enabled
                  ? 'airi-status-info'
                  : 'airi-status-neutral'"
              >
                <span>{{ section.label }}</span>
                <span>{{ section.count }}</span>
              </div>
            </div>
          </div>

          <div
            :class="['airi-status-info', 'rounded-lg p-3 text-sm']"
          >
            {{ t('settings.pages.card.persona_package.privacy_default') }}
            <div :class="['mt-1 text-xs opacity-80']">
              {{ pendingPersonaPackagePrivacyText }}
            </div>
          </div>

          <div flex="~ row wrap" justify-end gap-2>
            <Button
              variant="secondary"
              icon="i-solar:close-circle-bold-duotone"
              :label="t('settings.pages.card.persona_package.cancel_import')"
              @click="clearPendingPersonaPackageImport"
            />
            <Button
              variant="secondary"
              icon="i-solar:refresh-bold-duotone"
              :label="t('settings.pages.card.persona_package.overwrite_active')"
              :disabled="!activeCardId"
              @click="overwriteActiveCardWithPersonaPackage"
            />
            <Button
              variant="primary"
              icon="i-solar:add-circle-bold-duotone"
              :label="t('settings.pages.card.persona_package.import_as_new')"
              @click="importPersonaPackageAsNewCard"
            />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Background decoration -->
  <div
    v-motion
    :class="[
      'airi-text-muted pointer-events-none fixed bottom-0 right--5 top-[calc(100dvh-15rem)] z--1',
      'flex items-center justify-center opacity-20 dark:opacity-15',
    ]"
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
    size-60
  >
    <div text="60" i-solar:emoji-funny-square-bold-duotone />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.card.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.card.description
  icon: i-solar:emoji-funny-square-bold-duotone
  settingsEntry: true
  order: 1
  stageTransition:
    name: slide
</route>
