import type { CharacterSettingsGenerationSource } from '@proj-airi/stage-ui/stores/modules/character-settings-generator'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import {
  buildCharacterSettingsGenerationPrompt,
  parseGeneratedCharacterSettings,
} from '@proj-airi/stage-ui/stores/modules/character-settings-generator'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

type CharacterSettingsGenerationErrorCode = '' | 'missing-description' | 'missing-provider-model' | 'parse-failed' | 'provider-unavailable' | 'request-failed'

export function useCardCharacterGenerator(options: {
  getSource: () => CharacterSettingsGenerationSource
  logLabel: string
}) {
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
  const isGeneratingCharacterSettings = ref(false)
  const characterSettingsGenerationError = ref<CharacterSettingsGenerationErrorCode>('')

  async function generateCharacterSettingsWithCurrentModel() {
    if (isGeneratingCharacterSettings.value)
      return undefined

    characterSettingsGenerationError.value = ''
    const source = options.getSource()
    if (!source.description.trim()) {
      characterSettingsGenerationError.value = 'missing-description'
      return undefined
    }
    if (!activeProvider.value || !activeModel.value) {
      characterSettingsGenerationError.value = 'missing-provider-model'
      return undefined
    }

    try {
      isGeneratingCharacterSettings.value = true
      const provider = await providersStore.getProviderInstance<ChatProvider>(activeProvider.value)
      if (!provider?.chat) {
        characterSettingsGenerationError.value = 'provider-unavailable'
        return undefined
      }

      const { generateText } = await import('@xsai/generate-text')
      const prompt = buildCharacterSettingsGenerationPrompt(source)
      const providerConfig = providersStore.getProviderConfig(activeProvider.value)
      const providerConfigObject = typeof providerConfig === 'object' && providerConfig !== null
        ? providerConfig as Record<string, any>
        : {}
      const chatConfig = provider.chat(activeModel.value)
      const response = await generateText({
        ...chatConfig,
        ...providerConfigObject,
        headers: {
          ...chatConfig.headers,
          ...(typeof providerConfigObject.headers === 'object' && providerConfigObject.headers !== null
            ? providerConfigObject.headers
            : {}),
        },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        model: activeModel.value,
        temperature: 0.3,
      })
      const result = parseGeneratedCharacterSettings(String(response.text ?? ''))
      if (!result)
        characterSettingsGenerationError.value = 'parse-failed'
      return result
    }
    catch (error) {
      characterSettingsGenerationError.value = 'request-failed'
      console.error(`[${options.logLabel}] Failed to generate character settings:`, error)
    }
    finally {
      isGeneratingCharacterSettings.value = false
    }
  }

  return {
    characterSettingsGenerationError,
    generateCharacterSettingsWithCurrentModel,
    isGeneratingCharacterSettings,
  }
}
