import type { ChatSessionsExport } from '../types/chat-session'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { filterLive2DCompositeExpressionPresetsByModel, useLive2d } from '@proj-airi/stage-ui-live2d'

import { useChatOrchestratorStore } from '../stores/chat'
import { useChatSessionStore } from '../stores/chat/session-store'
import { DisplayModelFormat, useDisplayModelsStore } from '../stores/display-models'
import { useMcpStore } from '../stores/mcp'
import { useAiriCardStore } from '../stores/modules/airi-card'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useMinecraftStore } from '../stores/modules/gaming-minecraft'
import { useHearingStore } from '../stores/modules/hearing'
import { useSpeechStore } from '../stores/modules/speech'
import { useTwitterStore } from '../stores/modules/twitter'
import { useOnboardingStore } from '../stores/onboarding'
import { useProvidersStore } from '../stores/providers'
import { useSettings, useSettingsAudioDevice, useSettingsLive2d } from '../stores/settings'
import { clearBrowserApplicationData } from '../utils/clear-browser-application-data'
import { createLocalModelPerformanceConfig, restoreLive2DPerformanceConfig } from '../utils/local-model-performance-config'
import { createModelConfigurationArchive, decodeModelAsset, encodeModelAsset, readModelConfigurationArchive, verifyModelConfigurationBundle } from '../utils/model-configuration-bundle'

export function useDataMaintenance() {
  const chatStore = useChatSessionStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const displayModelsStore = useDisplayModelsStore()
  const providersStore = useProvidersStore()
  const settingsStore = useSettings()
  const live2dSettingsStore = useSettingsLive2d()
  const audioSettingsStore = useSettingsAudioDevice()
  const live2dStore = useLive2d()
  const hearingStore = useHearingStore()
  const speechStore = useSpeechStore()
  const consciousnessStore = useConsciousnessStore()
  const twitterStore = useTwitterStore()
  const discordStore = useDiscordStore()
  const factorioStore = useFactorioStore()
  const minecraftStore = useMinecraftStore()
  const mcpStore = useMcpStore()
  const onboardingStore = useOnboardingStore()
  const airiCardStore = useAiriCardStore()

  async function deleteAllModels() {
    await displayModelsStore.resetDisplayModels()
    settingsStore.stageModelSelected = 'preset-live2d-1'
    await settingsStore.updateStageModel()
  }

  async function resetProvidersSettings() {
    await providersStore.resetProviderSettings()
  }

  function resetModulesSettings() {
    hearingStore.resetState()
    speechStore.resetState()
    consciousnessStore.resetState()
    twitterStore.resetState()
    discordStore.resetState()
    factorioStore.resetState()
    minecraftStore.resetState()
  }

  async function deleteAllChatSessions() {
    chatOrchestrator.cancelPendingSends()
    await chatStore.resetAllSessions()
  }

  async function exportChatSessions() {
    const data = await chatStore.exportSessions()
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }

  async function exportModelConfigurations() {
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    const entries = await Promise.all(displayModelsStore.displayModels.flatMap(model => model.type === 'file'
      ? [encodeModelAsset(model.file, model.provenance).then(asset => ({
          entry: {
            asset,
            configuration: {
              performanceConfig: createLocalModelPerformanceConfig({
                modelId: model.id,
                renderer: model.format === DisplayModelFormat.Live2dZip ? 'live2d' : model.format === DisplayModelFormat.PictureOcZip ? 'picture-oc' : 'vrm',
                presets: Object.values(filterLive2DCompositeExpressionPresetsByModel(live2dStore.compositeExpressionPresets, model.id)),
                resourceMetadata: live2dStore.performanceResourceMetadataByModel[model.id],
                motionSettings: live2dSettingsStore.live2dModelMotionSettings[model.id],
                pictureActions: model.pictureOc?.actions,
                visual: live2dStore.modelVisualSettings[model.id],
                parameterCalibration: live2dStore.modelVisualSettings[model.id]?.parameters,
              }),
            },
            model: {
              format: model.format,
              name: model.name,
              pictureOc: model.pictureOc,
              sourceId: model.id,
            },
          },
          file: model.file,
        }))]
      : []))
    return createModelConfigurationArchive(entries)
  }

  async function importModelConfigurations(payload: unknown | File) {
    const bundle = payload instanceof File
      ? await readModelConfigurationArchive(payload)
      : await verifyModelConfigurationBundle(payload)
    const supportedFormats = new Set(Object.values(DisplayModelFormat))
    let imported = 0
    for (const entry of bundle.entries) {
      if (!supportedFormats.has(entry.model.format))
        throw new Error(`Unsupported display model format: ${entry.model.format}`)
      const file = decodeModelAsset(entry.asset)
      const model = entry.model.format === DisplayModelFormat.PictureOcZip
        ? await displayModelsStore.addPictureOcPackage(file, entry.asset.provenance)
        : await displayModelsStore.addDisplayModel(entry.model.format, file, entry.asset.provenance)
      if (entry.model.name !== model.name)
        await displayModelsStore.renameDisplayModel(model.id, entry.model.name)
      const restored = restoreLive2DPerformanceConfig(entry.configuration.performanceConfig, model.id)
      live2dStore.importModelConfiguration(model.id, {
        presets: restored.presets,
        visualSettings: restored.visualSettings,
      })
      for (const [resourceId, metadata] of Object.entries(restored.resourceMetadata.motions))
        live2dStore.setPerformanceResourceMetadata(model.id, 'motions', resourceId, metadata)
      for (const [resourceId, metadata] of Object.entries(restored.resourceMetadata.expressions))
        live2dStore.setPerformanceResourceMetadata(model.id, 'expressions', resourceId, metadata)
      live2dSettingsStore.setModelMotionSettings(model.id, restored.motionSettings)
      imported += 1
    }
    live2dStore.shouldUpdateView()
    return imported
  }

  function isChatSessionsPayload(payload: unknown): payload is ChatSessionsExport {
    if (!payload || typeof payload !== 'object')
      return false
    return (payload as { format?: string }).format === 'chat-sessions-index:v1'
  }

  async function importChatSessions(payload: Record<string, unknown>) {
    if (!isChatSessionsPayload(payload))
      throw new Error('Invalid chat session export format')
    await chatStore.importSessions(payload)
  }

  async function resetSettingsState() {
    await settingsStore.resetState()
    audioSettingsStore.resetState()
    live2dStore.resetState()
    mcpStore.resetState()
    onboardingStore.resetSetupState()
    airiCardStore.resetState()
  }

  async function deleteAllData() {
    await deleteAllModels()
    await resetProvidersSettings()
    resetModulesSettings()
    await deleteAllChatSessions()
    await resetSettingsState()
    await clearBrowserApplicationData({ includeIndexedDB: !isStageTamagotchi() })
  }

  async function resetDesktopApplicationState() {
    if (!isStageTamagotchi())
      return

    await resetSettingsState()
    resetModulesSettings()
  }

  return {
    deleteAllModels,
    resetProvidersSettings,
    resetModulesSettings,
    deleteAllChatSessions,
    exportChatSessions,
    importChatSessions,
    exportModelConfigurations,
    importModelConfigurations,
    deleteAllData,
    resetDesktopApplicationState,
  }
}
