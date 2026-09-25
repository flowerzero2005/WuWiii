import type { TtsInputChunkOptions } from '@proj-airi/pipelines-audio'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export type SpeechOutputMode = 'fast' | 'balanced' | 'smooth' | 'custom'

export interface SpeechOutputModeConfig {
  boost: number
  minimumWords: number
  maximumWords: number
  mergeShortSentences: boolean
  description: string
}

const modeConfigs: Record<Exclude<SpeechOutputMode, 'custom'>, SpeechOutputModeConfig> = {
  fast: {
    boost: 2,
    minimumWords: 8,
    maximumWords: 18,
    mergeShortSentences: false,
    description: '优先低延迟，尽快生成首段语音，适合中文实时回复',
  },
  balanced: {
    boost: 1,
    minimumWords: 14,
    maximumWords: 32,
    mergeShortSentences: true,
    description: '平衡首段响应速度和自然停顿（推荐）',
  },
  smooth: {
    boost: 0,
    minimumWords: 36,
    maximumWords: 120,
    mergeShortSentences: true,
    description: '等待更完整的句子组，语音更连贯但首段延迟更高',
  },
}

export const useSettingsSpeechOutput = defineStore('settings-speech-output', () => {
  const STORAGE_VERSION_KEY = 'settings/speech-output/version'
  const CURRENT_STORAGE_VERSION = 3

  // State
  const mode = useLocalStorageManualReset<SpeechOutputMode>('settings/speech-output/mode', 'fast')
  const customBoost = useLocalStorageManualReset<number>('settings/speech-output/custom-boost', 2)
  const customMinWords = useLocalStorageManualReset<number>('settings/speech-output/custom-min-words', 8)
  const customMaxWords = useLocalStorageManualReset<number>('settings/speech-output/custom-max-words', 18)
  const customMergeShortSentences = useLocalStorageManualReset<boolean>('settings/speech-output/custom-merge-short-sentences', true)

  function migrateLegacyDefaults() {
    if (typeof localStorage === 'undefined')
      return

    try {
      const storedVersion = Number(localStorage.getItem(STORAGE_VERSION_KEY) || '1')
      if (storedVersion >= CURRENT_STORAGE_VERSION)
        return

      if (
        mode.value === 'balanced'
        && customBoost.value === 0
        && customMinWords.value === 30
        && customMaxWords.value === 100
      ) {
        mode.value = 'fast'
        customBoost.value = 2
        customMinWords.value = 8
        customMaxWords.value = 18
      }

      localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_STORAGE_VERSION))
    }
    catch {}
  }

  migrateLegacyDefaults()

  // Computed
  const currentConfig = computed<SpeechOutputModeConfig>(() => {
    if (mode.value === 'custom') {
      return {
        boost: customBoost.value,
        minimumWords: customMinWords.value,
        maximumWords: customMaxWords.value,
        mergeShortSentences: customMergeShortSentences.value,
        description: '自定义配置',
      }
    }
    return modeConfigs[mode.value]
  })

  const chunkOptions = computed<TtsInputChunkOptions>(() => {
    const minimumWords = Math.max(1, Math.round(currentConfig.value.minimumWords))
    const maximumWords = Math.max(minimumWords, Math.round(currentConfig.value.maximumWords))

    return {
      boost: Math.max(0, Math.round(currentConfig.value.boost)),
      minimumWords,
      maximumWords,
      mergeShortSentences: currentConfig.value.mergeShortSentences,
    }
  })

  // Actions
  function resetState() {
    mode.reset()
    customBoost.reset()
    customMinWords.reset()
    customMaxWords.reset()
    customMergeShortSentences.reset()
  }

  return {
    // State
    mode,
    customBoost,
    customMinWords,
    customMaxWords,
    customMergeShortSentences,

    // Computed
    currentConfig,
    chunkOptions,
    modeConfigs,

    // Actions
    resetState,
  }
})
