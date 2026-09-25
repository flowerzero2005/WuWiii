import { defineStore, storeToRefs } from 'pinia'

import { useSettingsControlsIsland } from './controls-island'
import { useSettingsGeneral } from './general'
import { useSettingsLive2d } from './live2d'
import { useSettingsQuickChat } from './quick-chat'
import { useSettingsStageModel } from './stage-model'
import { useSettingsTheme } from './theme'
import { useWorkbenchSceneSettingsStore } from './workbench'

// Export sub-stores
export * from './audio-device'
export * from './chat-appearance'
export * from './controls-island'
export * from './general'
export * from './live2d'
export * from './official-capability-consent'
export * from './quick-chat'
export * from './speech-output'
export * from './stage-model'
export * from './theme'
// Export constants
export { DEFAULT_THEME_COLORS_HUE } from './theme'
export * from './workbench'

/**
 * Unified settings store for backward compatibility.
 * This aggregates all sub-stores into one interface.
 *
 * @deprecated Use individual setting stores (useSettingsCore, useSettingsTheme, etc.) instead.
 * This store exists only for backward compatibility and will be removed in a future version.
 */
export const useSettings = defineStore('settings', () => {
  const general = useSettingsGeneral()
  const stageModel = useSettingsStageModel()
  const live2d = useSettingsLive2d()
  const theme = useSettingsTheme()
  const controlsIsland = useSettingsControlsIsland()
  const quickChat = useSettingsQuickChat()
  const workbenchScene = useWorkbenchSceneSettingsStore()

  async function resetState() {
    await stageModel.resetState()
    general.resetState()
    live2d.resetState()
    theme.resetState()
    controlsIsland.resetState()
    quickChat.resetState()
    workbenchScene.resetState()
  }

  // Extract refs from sub-stores to maintain proper reactivity
  const generalRefs = storeToRefs(general)
  const stageModelRefs = storeToRefs(stageModel)
  const live2dRefs = storeToRefs(live2d)
  const themeRefs = storeToRefs(theme)
  const controlsIslandRefs = storeToRefs(controlsIsland)

  return {
    // Core settings
    disableTransitions: generalRefs.disableTransitions,
    usePageSpecificTransitions: generalRefs.usePageSpecificTransitions,
    language: generalRefs.language,
    websocketSecureEnabled: generalRefs.websocketSecureEnabled,

    // Stage model settings
    stageModelRenderer: stageModelRefs.stageModelRenderer,
    stageModelSelected: stageModelRefs.stageModelSelected,
    stageModelSelectedUrl: stageModelRefs.stageModelSelectedUrl,
    stageModelSelectedDisplayModel: stageModelRefs.stageModelSelectedDisplayModel,
    stageViewControlsEnabled: stageModelRefs.stageViewControlsEnabled,
    publishedPerformanceConfig: stageModelRefs.publishedPerformanceConfig,

    // Live2D settings
    live2dDisableFocus: live2dRefs.live2dDisableFocus,
    live2dIdleAnimationEnabled: live2dRefs.live2dIdleAnimationEnabled,
    live2dIdleSwayStrength: live2dRefs.live2dIdleSwayStrength,
    live2dIdleMotionSpeed: live2dRefs.live2dIdleMotionSpeed,
    live2dBodyFocusFollowStrength: live2dRefs.live2dBodyFocusFollowStrength,
    live2dAutoBlinkEnabled: live2dRefs.live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled: live2dRefs.live2dForceAutoBlinkEnabled,
    live2dShadowEnabled: live2dRefs.live2dShadowEnabled,
    live2dMaxFps: live2dRefs.live2dMaxFps,
    live2dMouthSyncSpeed: live2dRefs.live2dMouthSyncSpeed,
    live2dMouthSyncAutoSpeedEnabled: live2dRefs.live2dMouthSyncAutoSpeedEnabled,
    live2dRandomIdleMotionEnabled: live2dRefs.live2dRandomIdleMotionEnabled,
    live2dRandomIdleMinIntervalMs: live2dRefs.live2dRandomIdleMinIntervalMs,
    live2dRandomIdleMaxIntervalMs: live2dRefs.live2dRandomIdleMaxIntervalMs,
    live2dRandomIdleMotionKeys: live2dRefs.live2dRandomIdleMotionKeys,
    live2dModelMotionSettings: live2dRefs.live2dModelMotionSettings,

    // Theme settings
    themeColorsHue: themeRefs.themeColorsHue,
    themeColorsHueDynamic: themeRefs.themeColorsHueDynamic,
    settingsSurfacePreset: themeRefs.settingsSurfacePreset,

    // UI settings
    allowVisibleOnAllWorkspaces: controlsIslandRefs.allowVisibleOnAllWorkspaces,
    controlsIslandIconSize: controlsIslandRefs.controlsIslandIconSize,

    // Methods
    setThemeColorsHue: theme.setThemeColorsHue,
    applyPrimaryColorFrom: theme.applyPrimaryColorFrom,
    isColorSelectedForPrimary: theme.isColorSelectedForPrimary,
    initializeStageModel: stageModel.initializeStageModel,
    updateStageModel: stageModel.updateStageModel,
    refreshLive2DSettingsFromStorage: live2d.refreshFromStorage,
    getLive2DModelMotionSettings: live2d.getModelMotionSettings,
    setLive2DModelMotionSettings: live2d.setModelMotionSettings,
    migrateLegacyLive2DModelMotionSettings: live2d.migrateLegacyModelMotionSettings,
    resetState,
  }
})
