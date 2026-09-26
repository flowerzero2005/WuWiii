import type { Card, ccv3 } from '@proj-airi/ccc'

import type { AiriPersonaAffectDefinition } from '../chat/persona-affect-definition'
import type { AiriPersonaEmotionDimension } from '../chat/persona-emotion-dimensions'
import type { AiriExpressionProfile, AiriExpressionProfileInput } from '../chat/persona-expression-profile'
import type {
  AiriPersonaExpandedProfile,
  AiriPersonaPackage,
  AiriPersonaPackageEnabledSections,
  AiriPersonaPackageExtension,
  AiriPersonaPackageGrowthMemory,
  AiriPersonaPackagePrivacy,
  AiriPersonaPackageSectionKey,
  AiriPersonaPackageWebSearchProfile,
} from './persona-package'
import type { SpeechSelectionSnapshot } from './speech'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SystemPromptV2 from '../../constants/prompts/system-v2'

import { AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION, createAiriPersonaAffectDefinition } from '../chat/persona-affect-definition'
import {
  AIRI_PERSONA_EMOTION_DIMENSIONS,
  normalizeAiriPersonaEmotionDimensions,
} from '../chat/persona-emotion-dimensions'
import {
  createDefaultAiriExpressionProfile,
  createGenericAiriExpressionProfile,
  normalizeAiriExpressionProfile,
} from '../chat/persona-expression-profile'
import { DEFAULT_STAGE_MODEL_ID, useSettingsStageModel } from '../settings/stage-model'
import { useConsciousnessStore } from './consciousness'
import {
  buildPersonaRuntimePromptSection,
  compilePersonaExpandedProfileFromCard,
  createCardFromPersonaPackage,
  createPersonaFingerprint,
  createPersonaPackageFromCard,
  normalizePersonaExpandedProfile,
  normalizePersonaPackageExtension,
  parsePersonaPackage,
} from './persona-package'
import { useSpeechStore } from './speech'

export interface AiriExtension {
  useDefaultPersonaSeed?: boolean

  modules: {
    consciousness: {
      provider: string // Example: "openai"
      model: string // Example: "gpt-4o"
    }

    speech: {
      provider: string // Example: "elevenlabs"
      model: string // Example: "eleven_multilingual_v2"
      voice_id: string // Example: "alloy"

      pitch?: number
      rate?: number
      ssml?: boolean
      language?: string
    }

    display?: {
      modelId?: string
    }

    vrm?: {
      source?: 'file' | 'url'
      file?: string // Example: "vrm/model.vrm"
      url?: string // Example: "https://example.com/vrm/model.vrm"
    }

    live2d?: {
      source?: 'file' | 'url'
      file?: string // Example: "live2d/model.json"
      url?: string // Example: "https://example.com/live2d/model.json"
    }
  }

  agents: {
    [key: string]: { // example: minecraft
      prompt: string
      enabled?: boolean
    }
  }

  expression?: AiriExpressionProfileInput
  personaPackage?: AiriPersonaPackageExtension
}

interface ResolvedAiriExtension extends Omit<AiriExtension, 'expression'> {
  expression: AiriExpressionProfile
}

export interface AiriCard extends Card {
  extensions: {
    airi: AiriExtension
  } & Card['extensions']
}

export interface AiriCardRuntimeSnapshot {
  affectDefinition: AiriPersonaAffectDefinition
  avatarUrl?: string
  characterId: string
  displayName: string
  displayModelId?: string
  emotionDimensions: AiriPersonaEmotionDimension[]
  expressionProfile: AiriExpressionProfile
  modelId: string
  personaFingerprint?: ReturnType<typeof createPersonaFingerprint>
  providerId: string
  speech: SpeechSelectionSnapshot | null
  systemPrompt: string
  useDefaultPersonaSeed: boolean
}

interface AiriCardRuntimeSyncEvent {
  type: 'active-card-updated'
  sourceId: string
  activeCardId: string
  activeCard: AiriCard
}

function normalizePersonaText(value: string | undefined) {
  return value?.trim() ?? ''
}

function normalizeCardPersonaPackage(input?: Partial<AiriPersonaPackageExtension>, now = Date.now()) {
  const normalized = normalizePersonaPackageExtension(input, now)
  return normalized
    ? { ...normalized, affectDefinition: input?.affectDefinition }
    : undefined
}

function createPersonaDefinitionSignature(card: AiriCard) {
  const advancedProfile = card.extensions.airi.personaPackage?.advancedProfile

  return JSON.stringify({
    description: normalizePersonaText(card.description),
    personality: normalizePersonaText(card.personality),
    scenario: normalizePersonaText(card.scenario),
    systemPrompt: normalizePersonaText(card.systemPrompt),
    postHistoryInstructions: normalizePersonaText(card.postHistoryInstructions),
    notes: normalizePersonaText(card.notes),
    greetings: card.greetings?.map(normalizePersonaText) ?? [],
    messageExample: card.messageExample?.map(example => example.map(normalizePersonaText)) ?? [],
    tags: card.tags?.map(normalizePersonaText) ?? [],
    advancedProfile: advancedProfile
      ? {
          summary: normalizePersonaText(advancedProfile.summary),
          identity: advancedProfile.identity.map(normalizePersonaText),
          personality: advancedProfile.personality.map(normalizePersonaText),
          scenarioBoundaries: advancedProfile.scenarioBoundaries.map(normalizePersonaText),
          responseBoundaries: advancedProfile.responseBoundaries.map(normalizePersonaText),
          writingPreferences: advancedProfile.writingPreferences.map(normalizePersonaText),
          feedbackCalibration: advancedProfile.feedbackCalibration.map(normalizePersonaText),
          growthMemories: advancedProfile.growthMemories.map(normalizePersonaText),
          webSearchInterests: advancedProfile.webSearchInterests.map(normalizePersonaText),
          expressionNotes: advancedProfile.expressionNotes.map(normalizePersonaText),
        }
      : undefined,
  })
}

function hasPersonaDefinitionChanged(currentCard: AiriCard, nextCard: AiriCard) {
  return createPersonaDefinitionSignature(currentCard) !== createPersonaDefinitionSignature(nextCard)
}

function shouldUseDefaultPersonaSeed(characterId: string, extension: Pick<AiriExtension, 'useDefaultPersonaSeed'>) {
  return characterId === 'default' && extension.useDefaultPersonaSeed === true
}

function inferLegacyDefaultPersonaSeed(card: AiriCard, currentDefaultCard: AiriCard) {
  if (typeof card.extensions.airi.useDefaultPersonaSeed === 'boolean')
    return card.extensions.airi.useDefaultPersonaSeed

  if (createPersonaDefinitionSignature(card) === createPersonaDefinitionSignature(currentDefaultCard))
    return true

  const hasLegacyGeneratedDescription = card.name.trim().toLowerCase() === 'airi'
    && normalizePersonaText(card.description).includes('Emotion for feeling')
  const hasOtherPersonaDefinition = Boolean(
    normalizePersonaText(card.personality)
    || normalizePersonaText(card.scenario)
    || normalizePersonaText(card.systemPrompt)
    || normalizePersonaText(card.postHistoryInstructions)
    || normalizePersonaText(card.notes)
    || card.greetings?.some(greeting => normalizePersonaText(greeting))
    || card.messageExample?.some(example => example.some(line => normalizePersonaText(line)))
    || card.tags?.some(tag => normalizePersonaText(tag))
    || card.extensions.airi.personaPackage?.advancedProfile,
  )

  return hasLegacyGeneratedDescription && !hasOtherPersonaDefinition
}

function replaceDefaultPersonaSeed(card: AiriCard): AiriCard {
  const extension = card.extensions.airi
  const expression = normalizeAiriExpressionProfile(extension.expression)
  const usesUntouchedDefaultExpression = JSON.stringify(expression) === JSON.stringify(createDefaultAiriExpressionProfile())
  const inheritedDefaultDimensions = extension.useDefaultPersonaSeed === true
    && JSON.stringify(extension.personaPackage?.emotionDimensions) === JSON.stringify(AIRI_PERSONA_EMOTION_DIMENSIONS)
  const inheritedDefaultAffect = extension.useDefaultPersonaSeed === true
    && JSON.stringify(extension.personaPackage?.affectDefinition) === JSON.stringify(AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION)

  return {
    ...card,
    extensions: {
      ...card.extensions,
      airi: {
        ...extension,
        expression: usesUntouchedDefaultExpression ? createGenericAiriExpressionProfile() : expression,
        personaPackage: extension.personaPackage
          ? {
              ...extension.personaPackage,
              affectDefinition: inheritedDefaultAffect
                ? undefined
                : extension.personaPackage.affectDefinition,
              emotionDimensions: inheritedDefaultDimensions
                ? undefined
                : extension.personaPackage.emotionDimensions,
            }
          : undefined,
        useDefaultPersonaSeed: false,
      },
    },
  }
}

export const useAiriCardStore = defineStore('airi-card', () => {
  const { t } = useI18n()

  const SYSTEM_PROMPT_VERSION = '1.4.83' // Increment when base locale content changes - Updated 2026-09-12: keep conversational momentum measured and persona-led.

  const cards = useLocalStorageManualReset<Map<string, AiriCard>>('airi-cards', new Map())
  const activeCardId = useLocalStorageManualReset<string>('airi-card-active-id', 'default')

  const activeCard = computed(() => cards.value.get(activeCardId.value))

  const consciousnessStore = useConsciousnessStore()
  const speechStore = useSpeechStore()
  const stageModelStore = useSettingsStageModel()
  const runtimeSyncSourceId = nanoid()
  let applyingRemoteRuntime = false
  let activeDisplayModelApplication: Promise<void> | undefined
  let activeDisplayModelApplicationGeneration = 0
  let activeDisplayModelId: string | undefined
  let lastRuntimeSyncSignature = ''
  let runtimeSyncChannel: BroadcastChannel | undefined

  const {
    activeProvider: activeConsciousnessProvider,
    activeModel: activeConsciousnessModel,
  } = storeToRefs(consciousnessStore)

  const {
    activeSpeechProvider,
    activeSpeechVoiceId,
    activeSpeechModel,
    selectedLanguage: activeSpeechLanguage,
  } = storeToRefs(speechStore)

  const addCard = (card: AiriCard | Card | ccv3.CharacterCardV3) => {
    const newCardId = nanoid()
    const newCards = new Map(cards.value)
    newCards.set(newCardId, newAiriCard(card))
    cards.value = newCards
    return newCardId
  }

  const removeCard = (id: string) => {
    const newCards = new Map(cards.value)
    newCards.delete(id)
    cards.value = newCards
  }

  const updateCard = (id: string, updates: AiriCard | Card | ccv3.CharacterCardV3) => {
    const existingCard = cards.value.get(id)
    if (!existingCard)
      return false

    const updatedCard = {
      ...existingCard,
      ...updates,
    }

    let nextCard = newAiriCard(updatedCard)
    if (id === 'default' && hasPersonaDefinitionChanged(existingCard, nextCard))
      nextCard = replaceDefaultPersonaSeed(nextCard)

    const newCards = new Map(cards.value)
    newCards.set(id, nextCard)
    cards.value = newCards
    return true
  }

  function setCardDisplayModel(id: string, modelId?: string) {
    const card = cards.value.get(id)
    if (!card)
      return false

    const extension = resolveAiriExtension(card)
    const normalizedModelId = modelId?.trim()
    return setAiriCard(id, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          modules: {
            ...extension.modules,
            display: normalizedModelId ? { modelId: normalizedModelId } : undefined,
          },
        },
      },
    })
  }

  function setAiriCard(id: string, card: Card | AiriCard) {
    const existingCard = cards.value.get(id)
    if (!existingCard)
      return false

    const newCards = new Map(cards.value)
    newCards.set(id, newAiriCard({
      ...existingCard,
      ...card,
    }))
    cards.value = newCards
    return true
  }

  const getCard = (id: string) => {
    return cards.value.get(id)
  }

  function buildCardSystemPrompt(card: AiriCard, extension: ResolvedAiriExtension, characterId: string) {
    const includeDefaultAiriSeed = shouldUseDefaultPersonaSeed(characterId, extension)

    return [
      // Platform policy precedes every editable persona source and defines their boundaries.
      t('base.prompt.universal-safety'),
      t('base.prompt.product-context'),
      SystemPromptV2(
        includeDefaultAiriSeed ? t('base.prompt.prefix') : '',
        t('base.prompt.suffix'),
      ).content,
      buildPersonaRuntimePromptSection({
        card,
        extension: extension.personaPackage,
        expressionProfile: extension.expression,
        includeDefaultAiriSeed,
      }),
    ].filter(Boolean).join('\n')
  }

  function getCardRuntime(characterId: string): AiriCardRuntimeSnapshot | null {
    const card = cards.value.get(characterId)
    if (!card)
      return null

    const extension = resolveAiriExtension(card)
    const personaPackage = extension.personaPackage
    const includeDefaultAiriSeed = shouldUseDefaultPersonaSeed(characterId, extension)
    const avatar = card.metadata?.avatar
    const speech = hasExplicitCardSpeech(card)
      ? {
          providerId: extension.modules.speech.provider,
          modelId: extension.modules.speech.model,
          voiceId: extension.modules.speech.voice_id,
          language: extension.modules.speech.language || 'zh-CN',
        }
      : null

    return {
      affectDefinition: createAiriPersonaAffectDefinition(personaPackage?.affectDefinition, includeDefaultAiriSeed),
      avatarUrl: typeof avatar === 'string' ? avatar : undefined,
      characterId,
      displayName: card.name || t('base.resident.default-name'),
      displayModelId: extension.modules.display?.modelId,
      emotionDimensions: resolvePersonaEmotionDimensions(extension),
      expressionProfile: extension.expression,
      modelId: extension.modules.consciousness.model,
      personaFingerprint: createPersonaFingerprint({
        card,
        expressionProfile: extension.expression,
        extension: personaPackage,
        includeDefaultAiriSeed,
      }),
      providerId: extension.modules.consciousness.provider,
      speech,
      systemPrompt: buildCardSystemPrompt(card, extension, characterId),
      useDefaultPersonaSeed: includeDefaultAiriSeed,
    }
  }

  function hasExplicitCardSpeech(card: AiriCard) {
    return Boolean(card.extensions.airi.modules.speech?.voice_id?.trim())
  }

  function resolveAiriExtension(card: Card | ccv3.CharacterCardV3): ResolvedAiriExtension {
    // Get existing extension if available
    const existingExtension = ('data' in card
      ? card.data?.extensions?.airi
      : card.extensions?.airi) as AiriExtension

    // Create default modules config
    const defaultModules = {
      consciousness: {
        provider: activeConsciousnessProvider.value,
        model: activeConsciousnessModel.value,
      },
      speech: {
        provider: '',
        model: '',
        voice_id: '',
        language: 'zh-CN',
      },
    }

    // Return default if no extension exists
    if (!existingExtension) {
      return {
        modules: defaultModules,
        agents: {},
        expression: createGenericAiriExpressionProfile(),
      }
    }

    const storedConsciousnessProvider = existingExtension.modules?.consciousness?.provider?.trim()
    const consciousnessProvider = storedConsciousnessProvider || defaultModules.consciousness.provider
    const storedConsciousnessModel = existingExtension.modules?.consciousness?.model?.trim()

    // Merge existing extension with defaults. An empty legacy provider is an
    // uninitialized value, not an intentional persona binding.
    const personaPackage = normalizeCardPersonaPackage(existingExtension.personaPackage)

    return {
      modules: {
        consciousness: {
          provider: consciousnessProvider,
          model: storedConsciousnessModel
            || (consciousnessProvider === defaultModules.consciousness.provider ? defaultModules.consciousness.model : ''),
        },
        speech: {
          provider: existingExtension.modules?.speech?.provider ?? defaultModules.speech.provider,
          model: existingExtension.modules?.speech?.model ?? defaultModules.speech.model,
          voice_id: existingExtension.modules?.speech?.voice_id ?? defaultModules.speech.voice_id,
          pitch: existingExtension.modules?.speech?.pitch,
          rate: existingExtension.modules?.speech?.rate,
          ssml: existingExtension.modules?.speech?.ssml,
          language: existingExtension.modules?.speech?.language ?? defaultModules.speech.language,
        },
        display: existingExtension.modules?.display,
        vrm: existingExtension.modules?.vrm,
        live2d: existingExtension.modules?.live2d,
      },
      agents: existingExtension.agents ?? {},
      expression: normalizeAiriExpressionProfile(existingExtension.expression),
      personaPackage,
      useDefaultPersonaSeed: existingExtension.useDefaultPersonaSeed,
    }
  }

  function getPersonaPackageExtension(card: Card | AiriCard | undefined) {
    if (!card)
      return undefined

    return resolveAiriExtension(card).personaPackage
  }

  function resolvePersonaEmotionDimensions(extension: ResolvedAiriExtension) {
    if (extension.personaPackage?.emotionDimensions !== undefined)
      return normalizeAiriPersonaEmotionDimensions(extension.personaPackage.emotionDimensions)

    return [...AIRI_PERSONA_EMOTION_DIMENSIONS]
  }

  function compilePersonaPackageDraft(
    id: string,
    options: {
      growthMemories?: string[]
      now?: number
      webSearchInterests?: string[]
    } = {},
  ) {
    const card = cards.value.get(id)
    if (!card)
      return false

    const now = options.now ?? Date.now()
    const extension = resolveAiriExtension(card)
    const advancedProfile = compilePersonaExpandedProfileFromCard({
      card,
      expressionProfile: extension.expression,
      growthMemories: options.growthMemories,
      includeDefaultAiriSeed: shouldUseDefaultPersonaSeed(id, extension),
      now,
      webSearchInterests: options.webSearchInterests,
    })
    const personaPackage = normalizeCardPersonaPackage({
      enabled: true,
      advancedProfile,
      affectDefinition: extension.personaPackage?.affectDefinition,
      emotionDimensions: extension.personaPackage?.emotionDimensions,
      enabledSections: extension.personaPackage?.enabledSections,
      lastCompiledAt: now,
      privacy: extension.personaPackage?.privacy,
      source: 'compiled-draft',
    }, now)

    return setAiriCard(id, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          personaPackage,
        },
      },
    })
  }

  function updatePersonaPackageAdvancedProfile(
    id: string,
    profile: Partial<AiriPersonaExpandedProfile>,
    options: {
      now?: number
      preserveDefaultPersonaSeed?: boolean
      source?: AiriPersonaPackageExtension['source']
    } = {},
  ) {
    const card = cards.value.get(id)
    if (!card)
      return false

    const now = options.now ?? Date.now()
    const extension = resolveAiriExtension(card)
    const advancedProfile = normalizePersonaExpandedProfile({
      ...extension.personaPackage?.advancedProfile,
      ...profile,
      updatedAt: now,
    }, now)
    const personaPackage = normalizeCardPersonaPackage({
      enabled: true,
      advancedProfile,
      affectDefinition: extension.personaPackage?.affectDefinition,
      emotionDimensions: extension.personaPackage?.emotionDimensions,
      enabledSections: extension.personaPackage?.enabledSections,
      importedAt: extension.personaPackage?.importedAt,
      importedPackageId: extension.personaPackage?.importedPackageId,
      lastCompiledAt: extension.personaPackage?.lastCompiledAt,
      privacy: extension.personaPackage?.privacy,
      source: options.source ?? 'manual',
    }, now)

    let nextCard = newAiriCard({
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          personaPackage,
        },
      },
    })
    if (id === 'default' && !options.preserveDefaultPersonaSeed && hasPersonaDefinitionChanged(card, nextCard))
      nextCard = replaceDefaultPersonaSeed(nextCard)

    return setAiriCard(id, nextCard)
  }

  function pickPersonaProfileSections(
    profile: AiriPersonaExpandedProfile,
    sectionKeys: AiriPersonaPackageSectionKey[],
  ): Partial<AiriPersonaExpandedProfile> {
    const patch: Partial<AiriPersonaExpandedProfile> = {}

    for (const sectionKey of sectionKeys) {
      if (sectionKey === 'summary')
        patch.summary = profile.summary
      else
        patch[sectionKey] = profile[sectionKey]
    }

    return patch
  }

  function regeneratePersonaPackageAdvancedProfileSections(
    id: string,
    sectionKeys: AiriPersonaPackageSectionKey[],
    options: {
      growthMemories?: string[]
      now?: number
      webSearchInterests?: string[]
    } = {},
  ) {
    if (sectionKeys.length === 0)
      return false

    const card = cards.value.get(id)
    if (!card)
      return false

    const now = options.now ?? Date.now()
    const extension = resolveAiriExtension(card)
    const nextProfile = compilePersonaExpandedProfileFromCard({
      card,
      expressionProfile: extension.expression,
      growthMemories: options.growthMemories,
      includeDefaultAiriSeed: shouldUseDefaultPersonaSeed(id, extension),
      now,
      webSearchInterests: options.webSearchInterests,
    })

    return updatePersonaPackageAdvancedProfile(id, pickPersonaProfileSections(nextProfile, sectionKeys), {
      now,
      source: extension.personaPackage?.source ?? 'compiled-draft',
    })
  }

  function updatePersonaPackageEnabledSections(
    id: string,
    enabledSections: AiriPersonaPackageEnabledSections,
  ) {
    const card = cards.value.get(id)
    if (!card)
      return false

    const extension = resolveAiriExtension(card)
    const personaPackage = normalizeCardPersonaPackage({
      ...extension.personaPackage,
      enabled: extension.personaPackage?.enabled ?? Boolean(extension.personaPackage?.advancedProfile),
      enabledSections: {
        ...extension.personaPackage?.enabledSections,
        ...enabledSections,
      },
      privacy: extension.personaPackage?.privacy,
      source: extension.personaPackage?.source ?? 'manual',
    })

    return setAiriCard(id, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          personaPackage,
        },
      },
    })
  }

  function syncPersonaPackageGrowthMemories(
    id: string,
    growthMemories: string[],
    options: {
      now?: number
    } = {},
  ) {
    const card = cards.value.get(id)
    if (!card)
      return false

    const extension = resolveAiriExtension(card)
    if (!extension.personaPackage?.advancedProfile) {
      return compilePersonaPackageDraft(id, {
        growthMemories,
        now: options.now,
      })
    }

    return updatePersonaPackageAdvancedProfile(id, {
      feedbackCalibration: growthMemories,
      growthMemories,
    }, {
      now: options.now,
      preserveDefaultPersonaSeed: true,
      source: extension.personaPackage.source,
    })
  }

  function exportPersonaPackage(
    id: string,
    options: {
      growthMemories?: AiriPersonaPackageGrowthMemory[]
      now?: number
      packageId?: string
      privacy?: Partial<AiriPersonaPackagePrivacy>
      webSearchProfile?: AiriPersonaPackageWebSearchProfile
    } = {},
  ) {
    const card = cards.value.get(id)
    if (!card)
      return undefined

    const extension = resolveAiriExtension(card)
    const personaPackage = normalizeCardPersonaPackage({
      ...extension.personaPackage,
      emotionDimensions: extension.personaPackage?.emotionDimensions,
      source: extension.personaPackage?.source ?? 'manual',
    })
    return createPersonaPackageFromCard({
      card: {
        ...card,
        extensions: {
          ...card.extensions,
          airi: {
            ...extension,
            personaPackage,
          },
        },
      },
      expressionProfile: extension.expression,
      growthMemories: options.growthMemories,
      now: options.now,
      packageId: options.packageId,
      privacy: options.privacy,
      webSearchProfile: options.webSearchProfile,
    })
  }

  function addPersonaPackage(personaPackage: AiriPersonaPackage) {
    return addCard(createCardFromPersonaPackage(personaPackage))
  }

  function updateCardFromPersonaPackage(id: string, personaPackage: AiriPersonaPackage) {
    return setAiriCard(id, createCardFromPersonaPackage(personaPackage))
  }

  function parsePersonaPackageJson(content: string) {
    try {
      return parsePersonaPackage(JSON.parse(content))
    }
    catch {
      return undefined
    }
  }

  function newAiriCard(card: Card | ccv3.CharacterCardV3): AiriCard {
    // Handle ccv3 format if needed
    if ('data' in card) {
      const ccv3Card = card as ccv3.CharacterCardV3
      return {
        name: ccv3Card.data.name,
        version: ccv3Card.data.character_version ?? '1.0.0',
        description: ccv3Card.data.description ?? '',
        creator: ccv3Card.data.creator ?? '',
        notes: ccv3Card.data.creator_notes ?? '',
        notesMultilingual: ccv3Card.data.creator_notes_multilingual,
        personality: ccv3Card.data.personality ?? '',
        scenario: ccv3Card.data.scenario ?? '',
        greetings: [
          ccv3Card.data.first_mes,
          ...(ccv3Card.data.alternate_greetings ?? []),
        ],
        greetingsGroupOnly: ccv3Card.data.group_only_greetings ?? [],
        systemPrompt: ccv3Card.data.system_prompt ?? '',
        postHistoryInstructions: ccv3Card.data.post_history_instructions ?? '',
        messageExample: ccv3Card.data.mes_example
          ? ccv3Card.data.mes_example
              .split('<START>\n')
              .filter(Boolean)
              .map(example => example.split('\n')
                .map((line) => {
                  if (line.startsWith('{{char}}:') || line.startsWith('{{user}}:'))
                    return line as `{{char}}: ${string}` | `{{user}}: ${string}`
                  throw new Error(`Invalid message example format: ${line}`)
                }))
          : [],
        tags: ccv3Card.data.tags ?? [],
        extensions: {
          ...ccv3Card.data.extensions,
          airi: resolveAiriExtension(ccv3Card),
        },
      }
    }

    return {
      ...card,
      extensions: {
        ...card.extensions,
        airi: resolveAiriExtension(card),
      },
    }
  }

  function createDefaultCard() {
    return newAiriCard({
      name: t('base.resident.default-name'),
      version: SYSTEM_PROMPT_VERSION,
      systemPrompt: '',
      description: t('base.resident.default-description'),
      personality: '',
      extensions: {
        airi: {
          modules: {
            display: {
              modelId: DEFAULT_STAGE_MODEL_ID,
            },
            consciousness: {
              provider: activeConsciousnessProvider.value,
              model: activeConsciousnessModel.value,
            },
            speech: {
              provider: activeSpeechProvider.value,
              model: activeSpeechModel.value,
              voice_id: activeSpeechVoiceId.value,
              language: activeSpeechLanguage.value,
            },
          },
          agents: {},
          expression: createDefaultAiriExpressionProfile(),
          useDefaultPersonaSeed: true,
          personaPackage: normalizeCardPersonaPackage({
            enabled: true,
            source: 'manual',
          }),
        },
      },
    })
  }

  function restoreDefaultCard() {
    const newCards = new Map(cards.value)
    newCards.set('default', createDefaultCard())
    cards.value = newCards
  }

  function initialize() {
    const existingCard = cards.value.get('default')

    if (!existingCard) {
      // Trigger reactivity by creating a new Map
      const newCards = new Map(cards.value)
      newCards.set('default', createDefaultCard())
      cards.value = newCards
    }
    else {
      const normalizedExistingCard = newAiriCard(existingCard)
      if (normalizedExistingCard.extensions.airi.useDefaultPersonaSeed === undefined) {
        const useDefaultPersonaSeed = inferLegacyDefaultPersonaSeed(normalizedExistingCard, createDefaultCard())
        const migratedCard = useDefaultPersonaSeed
          ? {
              ...normalizedExistingCard,
              extensions: {
                ...normalizedExistingCard.extensions,
                airi: {
                  ...normalizedExistingCard.extensions.airi,
                  useDefaultPersonaSeed: true,
                },
              },
            }
          : replaceDefaultPersonaSeed(normalizedExistingCard)
        const newCards = new Map(cards.value)
        newCards.set('default', migratedCard)
        cards.value = newCards
      }
    }

    if (!activeCardId.value)
      activeCardId.value = 'default'
  }

  let isApplyingActiveCard = false
  let hasAppliedInitialDisplayModel = false

  function applyDisplayModelBinding(modelId?: string) {
    // Startup restores the persisted stage selection. Later persona changes
    // apply that persona's binding without changing the startup choice.
    if (!hasAppliedInitialDisplayModel) {
      modelId = stageModelStore.stageModelSelected
      hasAppliedInitialDisplayModel = true
    }
    if (activeDisplayModelApplication && activeDisplayModelId === modelId)
      return activeDisplayModelApplication

    const generation = ++activeDisplayModelApplicationGeneration
    activeDisplayModelId = modelId
    const application = (async () => {
      try {
        // The renderer watches model ID/source changes. Emitting an explicit
        // refresh here also remounts it, bypassing its duplicate-load guard.
        await stageModelStore.applyPersonaDisplayModel(modelId)
      }
      catch (error) {
        console.warn('[AiriCard] Failed to refresh active display model:', error)
      }
      finally {
        if (activeDisplayModelApplicationGeneration === generation) {
          activeDisplayModelApplication = undefined
          activeDisplayModelId = undefined
        }
      }
    })()
    activeDisplayModelApplication = application
    return application
  }

  function applyActiveDisplayModel() {
    if (!activeCard.value)
      return Promise.resolve()

    return applyDisplayModelBinding(stageModelStore.stageModelSelected)
  }

  watch([activeCardId, activeCard], ([nextCardId, newCard], previous) => {
    if (!newCard)
      return

    const extension = resolveAiriExtension(newCard)
    const previousCardId = previous?.[0]
    const previousCard = previous?.[1]
    const previousExtension = previousCard ? resolveAiriExtension(previousCard) : undefined
    const cardChanged = previousCardId !== nextCardId
    const consciousnessChanged = cardChanged
      || previousExtension?.modules.consciousness.provider !== extension.modules.consciousness.provider
      || previousExtension?.modules.consciousness.model !== extension.modules.consciousness.model
    const speechChanged = cardChanged
      || previousExtension?.modules.speech.provider !== extension.modules.speech.provider
      || previousExtension?.modules.speech.model !== extension.modules.speech.model
      || previousExtension?.modules.speech.voice_id !== extension.modules.speech.voice_id
      || previousExtension?.modules.speech.language !== extension.modules.speech.language
    const displayChanged = cardChanged
      || previousExtension?.modules.display?.modelId !== extension.modules.display?.modelId

    isApplyingActiveCard = true
    try {
      if (consciousnessChanged) {
        activeConsciousnessProvider.value = extension.modules.consciousness.provider
        activeConsciousnessModel.value = extension.modules.consciousness.model
      }
      if (speechChanged) {
        speechStore.applySpeechSelection({
          providerId: extension.modules.speech.provider,
          modelId: extension.modules.speech.model,
          voiceId: extension.modules.speech.voice_id,
          language: extension.modules.speech.language,
        })
      }
    }
    finally {
      isApplyingActiveCard = false
    }

    if (displayChanged) {
      void applyDisplayModelBinding(extension.modules.display?.modelId)
    }
  }, { immediate: true, flush: 'sync' })

  if (typeof BroadcastChannel !== 'undefined') {
    runtimeSyncChannel = new BroadcastChannel('airi-active-card-sync')
    runtimeSyncChannel.onmessage = (event: MessageEvent<AiriCardRuntimeSyncEvent>) => {
      const payload = event.data
      if (payload?.type !== 'active-card-updated' || payload.sourceId === runtimeSyncSourceId || !payload.activeCard)
        return

      const signature = JSON.stringify([payload.activeCardId, payload.activeCard])
      lastRuntimeSyncSignature = signature
      applyingRemoteRuntime = true
      try {
        const nextCards = new Map(cards.value)
        nextCards.set(payload.activeCardId, payload.activeCard)
        cards.value = nextCards
        activeCardId.value = payload.activeCardId
      }
      finally {
        applyingRemoteRuntime = false
      }
    }
  }

  watch([activeCardId, activeCard], ([nextCardId, nextCard]) => {
    if (applyingRemoteRuntime || !nextCard)
      return

    const rawCard = toRaw(nextCard)
    const signature = JSON.stringify([nextCardId, rawCard])
    if (signature === lastRuntimeSyncSignature)
      return

    lastRuntimeSyncSignature = signature
    try {
      runtimeSyncChannel?.postMessage({
        type: 'active-card-updated',
        sourceId: runtimeSyncSourceId,
        activeCardId: nextCardId,
        activeCard: rawCard,
      } satisfies AiriCardRuntimeSyncEvent)
    }
    catch (error) {
      console.warn('[AiriCard] Failed to sync active card:', error)
    }
  }, { deep: true, flush: 'sync', immediate: true })

  watch([
    activeSpeechProvider,
    activeSpeechModel,
    activeSpeechVoiceId,
    activeSpeechLanguage,
  ], () => {
    if (isApplyingActiveCard)
      return

    const card = activeCard.value
    if (!card)
      return

    const extension = resolveAiriExtension(card)
    const currentSpeech = extension.modules.speech
    if (currentSpeech.provider === activeSpeechProvider.value
      && currentSpeech.model === activeSpeechModel.value
      && currentSpeech.voice_id === activeSpeechVoiceId.value
      && currentSpeech.language === activeSpeechLanguage.value) {
      return
    }

    setAiriCard(activeCardId.value, {
      ...card,
      extensions: {
        ...card.extensions,
        airi: {
          ...extension,
          modules: {
            ...extension.modules,
            speech: {
              ...currentSpeech,
              provider: activeSpeechProvider.value,
              model: activeSpeechModel.value,
              voice_id: activeSpeechVoiceId.value,
              language: activeSpeechLanguage.value,
            },
          },
        },
      },
    })
  }, { flush: 'sync' })

  function resetState() {
    activeCardId.reset()
    cards.reset()
  }

  return {
    cards,
    activeCard,
    activeCardId,
    applyActiveDisplayModel,
    addCard,
    addPersonaPackage,
    compilePersonaPackageDraft,
    exportPersonaPackage,
    removeCard,
    regeneratePersonaPackageAdvancedProfileSections,
    restoreDefaultCard,
    updateCard,
    setCardDisplayModel,
    updateCardFromPersonaPackage,
    updatePersonaPackageEnabledSections,
    updatePersonaPackageAdvancedProfile,
    getCard,
    getCardRuntime,
    getPersonaPackageExtension,
    parsePersonaPackageJson,
    resetState,
    initialize,
    syncPersonaPackageGrowthMemories,

    currentModels: computed(() => {
      return {
        consciousness: {
          provider: activeConsciousnessProvider.value,
          model: activeConsciousnessModel.value,
        },
        speech: {
          provider: activeSpeechProvider.value,
          model: activeSpeechModel.value,
          voice_id: activeSpeechVoiceId.value,
          language: activeSpeechLanguage.value,
        },
      } satisfies AiriExtension['modules']
    }),

    expressionProfile: computed<AiriExpressionProfile>(() => {
      const card = activeCard.value
      return card
        ? resolveAiriExtension(card).expression
        : createDefaultAiriExpressionProfile()
    }),

    personaEmotionDimensions: computed(() => {
      return getCardRuntime(activeCardId.value)?.emotionDimensions ?? []
    }),

    personaFingerprint: computed(() => {
      const card = activeCard.value
      if (!card)
        return undefined

      const extension = resolveAiriExtension(card)
      return createPersonaFingerprint({
        card,
        expressionProfile: extension.expression,
        extension: extension.personaPackage,
        includeDefaultAiriSeed: shouldUseDefaultPersonaSeed(activeCardId.value, extension),
      })
    }),

    systemPrompt: computed(() => {
      const card = activeCard.value
      if (!card)
        return ''

      const extension = resolveAiriExtension(card)
      return buildCardSystemPrompt(card, extension, activeCardId.value)
    }),
  }
})
