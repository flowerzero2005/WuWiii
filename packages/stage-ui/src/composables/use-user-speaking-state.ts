import { ref } from 'vue'

import { useSpeechPlaybackSettingsStore } from '../stores/settings/speech-playback'

/**
 * Composable for tracking user's active speaking state
 * Used to implement intelligent interruption strategy with continuous detection
 */

const isUserActivelySpeaking = ref(false)
const shouldInterruptPlayback = ref(false)
let speechEndTimeout: ReturnType<typeof setTimeout> | undefined
let continuousDetectionTimer: ReturnType<typeof setTimeout> | undefined

// State machine: idle → detecting → confirmed → ending
type SpeechDetectionState = 'idle' | 'detecting' | 'confirmed' | 'ending'
const detectionState = ref<SpeechDetectionState>('idle')

export function useUserSpeakingState() {
  // 从设置中获取配置
  const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
  const { settings } = speechPlaybackSettings

  /**
   * Mark user as actively speaking
   * Implements continuous detection state machine
   */
  function markUserSpeaking() {
    if (speechEndTimeout) {
      clearTimeout(speechEndTimeout)
      speechEndTimeout = undefined
    }

    isUserActivelySpeaking.value = true

    // 如果打断功能未启用，直接返回
    if (!settings.interruptionEnabled) {
      return
    }

    // State machine transitions
    if (detectionState.value === 'idle') {
      // Start detecting
      detectionState.value = 'detecting'

      // Start continuous detection timer
      if (continuousDetectionTimer) {
        clearTimeout(continuousDetectionTimer)
      }

      continuousDetectionTimer = setTimeout(() => {
        // Speech has been continuous for threshold duration
        detectionState.value = 'confirmed'
        shouldInterruptPlayback.value = true
        continuousDetectionTimer = undefined
      }, settings.continuousDetectionThreshold)
    }
    else if (detectionState.value === 'ending') {
      // User started speaking again before buffer ended
      detectionState.value = 'detecting'

      // Restart continuous detection timer
      if (continuousDetectionTimer) {
        clearTimeout(continuousDetectionTimer)
      }

      continuousDetectionTimer = setTimeout(() => {
        detectionState.value = 'confirmed'
        shouldInterruptPlayback.value = true
        continuousDetectionTimer = undefined
      }, settings.continuousDetectionThreshold)
    }
    // If already 'detecting' or 'confirmed', keep the state
  }

  /**
   * Mark user speech ended
   * Waits for a buffer period before marking as inactive
   * @param bufferMs - Buffer time in milliseconds (default: from settings)
   */
  function markUserSpeechEnded(bufferMs?: number) {
    const bufferTime = bufferMs ?? settings.speechEndBuffer

    if (speechEndTimeout) {
      clearTimeout(speechEndTimeout)
    }

    // Cancel continuous detection timer if still detecting
    if (detectionState.value === 'detecting' && continuousDetectionTimer) {
      clearTimeout(continuousDetectionTimer)
      continuousDetectionTimer = undefined
      detectionState.value = 'idle'
      return
    }

    // If confirmed, transition to ending state
    if (detectionState.value === 'confirmed') {
      detectionState.value = 'ending'
      // This flag represents an interruption edge, not the speech-end buffer.
      // Reset it now so a new utterance can trigger another false -> true edge.
      shouldInterruptPlayback.value = false
    }

    speechEndTimeout = setTimeout(() => {
      isUserActivelySpeaking.value = false
      shouldInterruptPlayback.value = false
      detectionState.value = 'idle'
      speechEndTimeout = undefined
    }, bufferTime)
  }

  /**
   * Force mark user as not speaking
   * Useful for manual reset
   */
  function resetUserSpeaking() {
    if (speechEndTimeout) {
      clearTimeout(speechEndTimeout)
      speechEndTimeout = undefined
    }
    if (continuousDetectionTimer) {
      clearTimeout(continuousDetectionTimer)
      continuousDetectionTimer = undefined
    }
    isUserActivelySpeaking.value = false
    shouldInterruptPlayback.value = false
    detectionState.value = 'idle'
  }

  /**
   * Get current detection threshold (for configuration)
   */
  function getDetectionThreshold() {
    return settings.continuousDetectionThreshold
  }

  return {
    isUserActivelySpeaking,
    shouldInterruptPlayback,
    detectionState,
    markUserSpeaking,
    markUserSpeechEnded,
    resetUserSpeaking,
    getDetectionThreshold,
  }
}
