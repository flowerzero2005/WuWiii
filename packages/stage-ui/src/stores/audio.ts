import { useDevicesList, useUserMedia } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { useSpeechPlaybackSettingsStore } from './settings/speech-playback'

export function createAudioOutputKeepAlive(audioContext: AudioContext) {
  const source = audioContext.createConstantSource()

  // NOTICE: A continuously active graph keeps Chromium's Windows audio session open.
  // The -140 dBFS level is inaudible and is never inserted into speech PCM buffers.
  source.offset.value = 1e-7
  source.connect(audioContext.destination)
  source.start()

  return () => {
    try {
      source.stop()
    }
    catch {}
    source.disconnect()
  }
}

function calculateVolumeWithLinearNormalize(analyser: AnalyserNode) {
  const dataBuffer = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(dataBuffer)

  const volumeVector: Array<number> = []
  for (let i = 0; i < 700; i += 80)
    volumeVector.push(dataBuffer[i])

  const volumeSum = dataBuffer
    // The volume changes flatten-ly, while the volume is often low, therefore we need to amplify it.
    // Applying a power function to amplify the volume is helpful, for example:
    // v ** 1.2 will amplify the volume by 1.2 times
    .map(v => v ** 1.2)
    // Scale up the volume values to make them more distinguishable
    .map(v => v * 1.2)
    .reduce((acc, cur) => acc + cur, 0)

  return (volumeSum / dataBuffer.length / 100)
}

function calculateVolumeWithMinMaxNormalize(analyser: AnalyserNode) {
  const dataBuffer = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(dataBuffer)

  const volumeVector: Array<number> = []
  for (let i = 0; i < 700; i += 80)
    volumeVector.push(dataBuffer[i])

  // The volume changes flatten-ly, while the volume is often low, therefore we need to amplify it.
  // We can apply a power function to amplify the volume, for example
  // v ** 1.2 will amplify the volume by 1.2 times
  const amplifiedVolumeVector = dataBuffer.map(v => v ** 1.5)

  // Normalize the amplified values using Min-Max scaling
  const min = Math.min(...amplifiedVolumeVector)
  const max = Math.max(...amplifiedVolumeVector)
  const range = max - min

  let normalizedVolumeVector
  if (range === 0) {
    // If range is zero, all values are the same, so normalization is not needed
    normalizedVolumeVector = amplifiedVolumeVector.map(() => 0) // or any default value
  }
  else {
    normalizedVolumeVector = amplifiedVolumeVector.map(v => (v - min) / range)
  }

  // Aggregate the volume values
  const volumeSum = normalizedVolumeVector.reduce((acc, cur) => acc + cur, 0)

  // Average the volume values
  return volumeSum / dataBuffer.length
}

function calculateVolume(analyser: AnalyserNode, mode: 'linear' | 'minmax' = 'linear') {
  switch (mode) {
    case 'linear':
      return calculateVolumeWithLinearNormalize(analyser)
    case 'minmax':
      return calculateVolumeWithMinMaxNormalize(analyser)
  }
}

export const useAudioContext = defineStore('audio-context', () => {
  const audioContext = shallowRef<AudioContext>(new AudioContext())
  const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
  let stopOutputKeepAlive: (() => void) | undefined

  function resumeOutputOnInteraction() {
    if (!speechPlaybackSettings.settings.speechOutputEnabled || audioContext.value.state === 'running')
      return
    void audioContext.value.resume().catch(() => {})
  }

  watch(() => speechPlaybackSettings.settings.speechOutputEnabled, (enabled) => {
    stopOutputKeepAlive?.()
    stopOutputKeepAlive = undefined
    if (!enabled)
      return

    stopOutputKeepAlive = createAudioOutputKeepAlive(audioContext.value)
    void audioContext.value.resume().catch(() => {})
  }, { immediate: true })

  const interactionEvents = ['keydown', 'pointerdown', 'touchstart'] as const
  if (typeof window !== 'undefined') {
    for (const event of interactionEvents)
      window.addEventListener(event, resumeOutputOnInteraction, { passive: true })
  }

  onScopeDispose(() => {
    stopOutputKeepAlive?.()
    if (typeof window !== 'undefined') {
      for (const event of interactionEvents)
        window.removeEventListener(event, resumeOutputOnInteraction)
    }
  })

  return {
    audioContext,
    calculateVolume,
  }
})

export function useAudioDevice(requestPermission: boolean = false) {
  const devices = useDevicesList({ constraints: { audio: true }, requestPermissions: requestPermission })
  const audioInputs = computed(() => devices.audioInputs.value)
  const selectedAudioInput = ref<string>(devices.audioInputs.value.find(device => device.deviceId === 'default')?.deviceId || '')
  const deviceConstraints = computed<MediaStreamConstraints>(() => ({
    audio: {
      deviceId: selectedAudioInput.value ? { exact: selectedAudioInput.value } : undefined,
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
  }))
  const { stream, stop: stopStream, start: startStream } = useUserMedia({ constraints: deviceConstraints, enabled: false, autoSwitch: true })

  watch(audioInputs, () => {
    if (!selectedAudioInput.value && audioInputs.value.length > 0) {
      selectedAudioInput.value = audioInputs.value.find(input => input.deviceId === 'default')?.deviceId || audioInputs.value[0].deviceId
    }
  })

  function askPermission() {
    return devices.ensurePermissions()
      .then(() => nextTick())
      .then(() => {
        if (audioInputs.value.length > 0 && !selectedAudioInput.value) {
          selectedAudioInput.value = audioInputs.value.find(input => input.deviceId === 'default')?.deviceId || audioInputs.value[0].deviceId
        }
      })
      .catch((error) => {
        console.error('Error ensuring permissions:', error)
        throw error // Re-throw so callers can handle the error
      })
  }

  return {
    audioInputs,
    selectedAudioInput,
    stream,
    deviceConstraints,

    askPermission,
    startStream,
    stopStream,
  }
}

export const useSpeakingStore = defineStore('character-speaking', () => {
  const nowSpeakingAvatarBorderOpacityMin = 30
  const nowSpeakingAvatarBorderOpacityMax = 100
  const mouthOpenSize = ref(0)
  const nowSpeaking = ref(false)
  const textMouthOpenSize = ref(0)
  const textMouthForm = ref(0)
  const textSpeaking = ref(false)

  const nowSpeakingAvatarBorderOpacity = computed<number>(() => {
    if (!nowSpeaking.value)
      return nowSpeakingAvatarBorderOpacityMin

    return ((nowSpeakingAvatarBorderOpacityMin
      + (nowSpeakingAvatarBorderOpacityMax - nowSpeakingAvatarBorderOpacityMin) * mouthOpenSize.value) / 100)
  })

  function clampMouthOpenSize(value: number) {
    if (!Number.isFinite(value))
      return 0

    return Math.max(0, Math.min(1, value))
  }

  function clampMouthForm(value: number) {
    if (!Number.isFinite(value))
      return 0

    return Math.max(-1, Math.min(1, value))
  }

  function startTextSpeaking() {
    textSpeaking.value = true
  }

  function setTextMouthOpenSize(value: number) {
    setTextMouthShape(value, 0)
  }

  function setTextMouthShape(openSize: number, form = 0) {
    textMouthOpenSize.value = clampMouthOpenSize(openSize)
    textMouthForm.value = clampMouthForm(form)
  }

  function setTextSpeakingMouthOpenSize(value: number, form = 0) {
    textSpeaking.value = true
    setTextMouthShape(value, form)
  }

  function stopTextSpeaking() {
    textSpeaking.value = false
    textMouthOpenSize.value = 0
    textMouthForm.value = 0
  }

  return {
    mouthOpenSize,
    nowSpeaking,
    nowSpeakingAvatarBorderOpacity,
    textMouthForm,
    textMouthOpenSize,
    textSpeaking,

    startTextSpeaking,
    setTextMouthShape,
    setTextMouthOpenSize,
    setTextSpeakingMouthOpenSize,
    stopTextSpeaking,
  }
})
