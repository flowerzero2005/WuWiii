export type WorkbenchModelSelectionMode = 'auto' | 'manual'
export type WorkbenchTaskKind = 'chat' | 'inspect' | 'document' | 'code' | 'game' | 'long-context'

export interface WorkbenchProviderModelOption {
  configured: boolean
  modelId: string
  modelKey: string
  providerId: string
}

export interface WorkbenchRecommendedModelSelection {
  modelId: string
  modelKey: string
  providerId: string
  reasonCode:
    | 'manual-selection'
    | 'official-codex-for-code'
    | 'official-claude-for-long-context'
    | 'official-long-context'
    | 'official-balanced-default'
    | 'configured-provider-fallback'
    | 'chat-model-fallback'
}

interface WorkbenchModelSelectionParams {
  chatActiveModel?: string
  chatActiveProvider?: string
  configuredOptions: WorkbenchProviderModelOption[]
  mode: WorkbenchModelSelectionMode
  selectedModelKey?: string
  selectedProviderId?: string
  taskKind: WorkbenchTaskKind
}

const OFFICIAL_CLOUD_PROVIDER_ID = 'official-cloud'
const OFFICIAL_CODEX_MODEL_ID = 'airi-codex'
const OFFICIAL_CLAUDE_MODEL_ID = 'airi-claude'
const OFFICIAL_LONG_CONTEXT_MODEL_ID = 'airi-long'
const OFFICIAL_BALANCED_MODEL_ID = 'airi-balanced'
const OFFICIAL_DEFAULT_MODEL_ID = 'airi-default'

function parseModelKey(modelKey: string, fallbackProviderId = '') {
  const trimmed = modelKey.trim()
  const separatorIndex = trimmed.indexOf('::')
  if (separatorIndex < 0) {
    return {
      modelId: trimmed,
      providerId: fallbackProviderId,
    }
  }

  return {
    modelId: trimmed.slice(separatorIndex + 2),
    providerId: trimmed.slice(0, separatorIndex),
  }
}

function normalizeModelKey(providerId: string, modelId: string) {
  return providerId && modelId ? `${providerId}::${modelId}` : ''
}

function toSelection(
  option: Pick<WorkbenchProviderModelOption, 'modelId' | 'modelKey' | 'providerId'>,
  reasonCode: WorkbenchRecommendedModelSelection['reasonCode'],
): WorkbenchRecommendedModelSelection {
  return {
    modelId: option.modelId,
    modelKey: option.modelKey || normalizeModelKey(option.providerId, option.modelId),
    providerId: option.providerId,
    reasonCode,
  }
}

function usableOptions(options: WorkbenchProviderModelOption[]) {
  return options.filter(option => option.configured && option.providerId && option.modelId)
}

function findOfficialOption(options: WorkbenchProviderModelOption[], modelId: string) {
  return options.find(option => option.providerId === OFFICIAL_CLOUD_PROVIDER_ID && option.modelId === modelId)
}

export function resolveRecommendedWorkbenchModelSelection(
  params: WorkbenchModelSelectionParams,
): WorkbenchRecommendedModelSelection {
  const options = usableOptions(params.configuredOptions)

  if (params.mode === 'manual' && params.selectedModelKey) {
    const parsed = parseModelKey(params.selectedModelKey, params.selectedProviderId)
    if (parsed.providerId && parsed.modelId) {
      return toSelection({
        modelId: parsed.modelId,
        modelKey: normalizeModelKey(parsed.providerId, parsed.modelId),
        providerId: parsed.providerId,
      }, 'manual-selection')
    }
  }

  if (params.taskKind === 'game' || params.taskKind === 'code') {
    const officialCodex = findOfficialOption(options, OFFICIAL_CODEX_MODEL_ID)
    if (officialCodex)
      return toSelection(officialCodex, 'official-codex-for-code')
  }

  if (params.taskKind === 'long-context') {
    const officialClaude = findOfficialOption(options, OFFICIAL_CLAUDE_MODEL_ID)
    if (officialClaude)
      return toSelection(officialClaude, 'official-claude-for-long-context')

    const officialLongContext = findOfficialOption(options, OFFICIAL_LONG_CONTEXT_MODEL_ID)
    if (officialLongContext)
      return toSelection(officialLongContext, 'official-long-context')
  }

  const officialBalancedOrDefault = findOfficialOption(options, OFFICIAL_BALANCED_MODEL_ID)
    ?? findOfficialOption(options, OFFICIAL_DEFAULT_MODEL_ID)
  if (officialBalancedOrDefault)
    return toSelection(officialBalancedOrDefault, 'official-balanced-default')

  const firstConfigured = options[0]
  if (firstConfigured)
    return toSelection(firstConfigured, 'configured-provider-fallback')

  return toSelection({
    modelId: params.chatActiveModel ?? '',
    modelKey: normalizeModelKey(params.chatActiveProvider ?? '', params.chatActiveModel ?? ''),
    providerId: params.chatActiveProvider ?? '',
  }, 'chat-model-fallback')
}

function includesAny(input: string, keywords: string[]) {
  return keywords.some(keyword => input.includes(keyword))
}

export function inferWorkbenchTaskKind(input: string): WorkbenchTaskKind {
  const normalized = input.trim().toLowerCase()
  if (includesAny(normalized, ['游戏', 'game', '坦克大战', 'canvas', 'html5']))
    return 'game'

  if (includesAny(normalized, ['代码', 'code', '修复', '运行', '项目']))
    return 'code'

  if (includesAny(normalized, ['长文', '总结文件', '很多内容']))
    return 'long-context'

  return 'document'
}
