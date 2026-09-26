/** Shared persisted setting bounds used by migration and vision UI/runtime. */
export const VISION_SCREENSHOT_INTERVAL_MIN_SECONDS = 15
export const VISION_SCREENSHOT_INTERVAL_MAX_SECONDS = 60 * 60

/** Defaults shared by storage repair and the runtime store. */
export const VISION_DEFAULT_SETTINGS = {
  enabled: false,
  automaticScreenshotEnabled: false,
  automaticScreenshotSourceId: '',
  screenshotIntervalSeconds: 120,
  provider: 'official-cloud',
  aliyunApiKey: '',
  aliyunBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
  aliyunModel: 'qwen-vl-plus',
  openAICompatibleApiKey: '',
  openAICompatibleBaseUrl: '',
  openAICompatibleModel: 'gpt-4o-mini',
  geminiApiKey: '',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  geminiModel: 'gemini-2.0-flash',
} as const
