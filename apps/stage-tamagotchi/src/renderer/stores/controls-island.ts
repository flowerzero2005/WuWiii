import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

export type MouseInteractionMode = 'interactive' | 'smart'

export const useControlsIslandStore = defineStore('controls-island', () => {
  // Persist fade-on-hover preference per user
  const fadeOnHoverEnabled = useLocalStorage<boolean>('controls-island/fade-on-hover-enabled', false)
  const dontShowItAgainNoticeFadeOnHover = useLocalStorage<boolean>('preferences/dont-show-it-again/notice/fade-on-hover', false)
  const mouseInteractionMode = useLocalStorage<MouseInteractionMode>('controls-island/mouse-interaction-mode', 'interactive')

  function enableFadeOnHover() {
    fadeOnHoverEnabled.value = true
  }

  function disableFadeOnHover() {
    fadeOnHoverEnabled.value = false
  }

  function setMouseInteractionMode(mode: MouseInteractionMode) {
    mouseInteractionMode.value = mode
  }

  return {
    fadeOnHoverEnabled,
    dontShowItAgainNoticeFadeOnHover,
    enableFadeOnHover,
    disableFadeOnHover,
    mouseInteractionMode,
    setMouseInteractionMode,
  }
})
