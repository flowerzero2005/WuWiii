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
  const characterSettingsGenerationErrorDetail = ref('')

  async function generateCharacterSettingsWithCurrentModel() {
    if (isGeneratingCharacterSettings.value)
      return undefined

    characterSettingsGenerationError.value = ''
    characterSettingsGenerationErrorDetail.value = ''
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
      const chatConfig = provider.chat(activeModel.value)
      const response = await generateText({
        ...chatConfig,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        model: activeModel.value,
      })
      const result = parseGeneratedCharacterSettings(String(response.text ?? ''))
      if (!result)
        characterSettingsGenerationError.value = 'parse-failed'
      return result
    }
    catch (error) {
      characterSettingsGenerationError.value = 'request-failed'
      characterSettingsGenerationErrorDetail.value = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
      console.error(`[${options.logLabel}] Failed to generate character settings:`, error)
    }
    finally {
      isGeneratingCharacterSettings.value = false
    }
  }

  return {
    characterSettingsGenerationError,
    characterSettingsGenerationErrorDetail,
    generateCharacterSettingsWithCurrentModel,
    isGeneratingCharacterSettings,
  }
}
