import { useElectronRelativeMouse, useElectronWindowBounds } from '@proj-airi/electron-vueuse'
import { useWindowSize } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { STAGE_DIALOGUE_GUTTER_WIDTH } from '../../shared/stage-window'

export const useWindowStore = defineStore('tamagotchi-window', () => {
  const { width, height } = useWindowSize()
  const centerPos = computed(() => ({ x: Math.max(0, width.value - STAGE_DIALOGUE_GUTTER_WIDTH) / 2, y: height.value / 2 }))
  const { width: boundsWidth, height: boundsHeight } = useElectronWindowBounds()

  // Use window-relative mouse coordinates for Live2D focus
  // Transforms screen coordinates to window-relative coordinates
  const relativeMouse = useElectronRelativeMouse({ initialValue: centerPos.value })
  const hasResolvedWindowBounds = computed(() => boundsWidth.value > 0 && boundsHeight.value > 0)
  const live2dLookAtX = computed(() => hasResolvedWindowBounds.value ? relativeMouse.x.value - STAGE_DIALOGUE_GUTTER_WIDTH : centerPos.value.x)
  const live2dLookAtY = computed(() => hasResolvedWindowBounds.value ? relativeMouse.y.value : centerPos.value.y)

  return {
    width,
    height,
    centerPos,
    live2dLookAtX,
    live2dLookAtY,
  }
})
