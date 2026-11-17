import type { Card } from '@proj-airi/ccc'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import {
  buildPersonaPackageGenerationPrompt,
  createPersonaPackageCompilerGuidance,
  parseGeneratedPersonaExpandedProfile,
} from '@proj-airi/stage-ui/stores/modules/persona-package'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

interface PersonaPackageGeneratorOptions {
  getCard: () => Card | undefined
  getGrowthMemories?: () => string[]
  logLabel: string
}

type PersonaPackageGenerationErrorCode = '' | 'missing-card' | 'missing-description' | 'missing-provider-model' | 'parse-failed' | 'provider-unavailable' | 'request-failed'

export function usePersonaPackageGenerator(options: PersonaPackageGeneratorOptions) {
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const { activeProvider: consciousnessProvider, activeModel: defaultConsciousnessModel } = storeToRefs(consciousnessStore)

  const isGeneratingPersonaPackage = ref(false)
  const personaPackageGenerationError = ref<PersonaPackageGenerationErrorCode>('')
  const personaPackageGenerationErrorDetail = ref('')

  function clearPersonaPackageGenerationError() {
    personaPackageGenerationError.value = ''
    personaPackageGenerationErrorDetail.value = ''
  }

  async function generatePersonaPackageWithCurrentModel() {
    if (isGeneratingPersonaPackage.value)
      return undefined

    clearPersonaPackageGenerationError()

    const card = options.getCard()
    if (!card) {
      personaPackageGenerationError.value = 'missing-card'
      return undefined
    }
    if (!card.description?.trim()) {
      personaPackageGenerationError.value = 'missing-description'
      return undefined
    }

    const providerName = consciousnessProvider.value
    const model = defaultConsciousnessModel.value
    if (!providerName || !model) {
      personaPackageGenerationError.value = 'missing-provider-model'
      return undefined
    }

    try {
      isGeneratingPersonaPackage.value = true

      const provider = await providersStore.getProviderInstance<ChatProvider>(providerName)
      if (!provider?.chat) {
        personaPackageGenerationError.value = 'provider-unavailable'
        return undefined
      }

      const { generateText } = await import('@xsai/generate-text')
      const generationInput = {
        card,
        compilerGuidance: createPersonaPackageCompilerGuidance({
          card,
          growthMemories: options.getGrowthMemories?.(),
        }),
        growthMemories: options.getGrowthMemories?.(),
      }
      const prompt = buildPersonaPackageGenerationPrompt(generationInput)
      const chatConfig = provider.chat(model)
      const request = () => generateText({
        ...chatConfig,
        messages: [
          {
            role: 'system',
            content: prompt.system,
          },
          {
            role: 'user',
            content: prompt.user,
          },
        ],
        model,
      })
      let response
      try {
        response = await request()
      }
      catch (error) {
        const status = (error as { status?: unknown })?.status
        const message = error instanceof Error ? error.message : String(error)
        if (![502, 503, 504].includes(Number(status)) && !/\b50[234]\b/.test(message))
          throw error
        await new Promise(resolve => setTimeout(resolve, 450))
        response = await request()
      }

      const profile = parseGeneratedPersonaExpandedProfile(String(response.text ?? '').trim())
      if (!profile) {
        personaPackageGenerationError.value = 'parse-failed'
        return undefined
      }

      return profile
    }
    catch (error) {
      personaPackageGenerationError.value = 'request-failed'
      personaPackageGenerationErrorDetail.value = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
      console.error(`[${options.logLabel}] Failed to generate persona package:`, error)
    }
    finally {
      isGeneratingPersonaPackage.value = false
    }
  }

  return {
    clearPersonaPackageGenerationError,
    generatePersonaPackageWithCurrentModel,
    isGeneratingPersonaPackage,
    personaPackageGenerationError,
    personaPackageGenerationErrorDetail,
  }
}
