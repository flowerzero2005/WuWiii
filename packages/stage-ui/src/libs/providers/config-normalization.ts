import { VISION_DEFAULT_SETTINGS, VISION_SCREENSHOT_INTERVAL_MAX_SECONDS, VISION_SCREENSHOT_INTERVAL_MIN_SECONDS } from '../vision-settings'

export type ProviderConfigurations = Record<string, Record<string, unknown>>
export const PROVIDER_CONFIGURATION_KEY = 'settings/credentials/providers'
export const PROVIDER_CONFIGURATION_VERSION_KEY = 'settings/credentials/providers-version'
const ADDED_PROVIDERS_KEY = 'settings/providers/added'
const MIGRATION_VERSION = 1
const CONFIGURATION_LOCK = 'airi:provider-configuration-migration'
const SCREEN_SOURCE_ID_RE = /^(?:screen|window):\d+(?::\d+)?$/

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

export function parseStoredProviderConfiguration(raw: string | null): unknown {
  try {
    return raw === null ? undefined : JSON.parse(raw)
  }
  catch {
    return undefined
  }
}

function matchesDefault(value: unknown, fallback: unknown) {
  if (Array.isArray(fallback))
    return Array.isArray(value)
  if (plainRecord(fallback))
    return plainRecord(value)
  return typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))
}

/** Repairs known shapes while retaining user strings and unknown extensions. */
export function normalizeProviderConfigurations(value: unknown, defaults: ProviderConfigurations): ProviderConfigurations {
  const input = plainRecord(value) ? value : {}
  const ids = new Set([...Object.keys(defaults), ...Object.keys(input)])
  return Object.fromEntries(Array.from(ids, (id) => {
    const fallback = Object.hasOwn(defaults, id) && plainRecord(defaults[id]) ? defaults[id] : {}
    const config = plainRecord(input[id]) ? input[id] : {}
    const fields = new Set([...Object.keys(fallback), ...Object.keys(config)])
    return [id, Object.fromEntries(Array.from(fields, (field) => {
      const supplied = config[field]
      const defaultValue = Object.hasOwn(fallback, field) ? fallback[field] : undefined
      if (['apiKey', 'model', 'baseUrl', 'baseURL', 'endpoint'].includes(field))
        return [field, typeof supplied === 'string' ? supplied : typeof defaultValue === 'string' ? defaultValue : '']
      return [field, Object.hasOwn(fallback, field) && !matchesDefault(supplied, defaultValue) ? defaultValue : supplied]
    }))]
  }))
}

export function normalizeAddedProviders(value: unknown): Record<string, boolean> {
  return plainRecord(value) ? Object.fromEntries(Object.entries(value).filter(([, added]) => typeof added === 'boolean')) as Record<string, boolean> : {}
}

type ConfigurationStorage = Pick<Storage, 'getItem' | 'setItem'>
type ConfigurationLock = (name: string, task: () => void) => Promise<unknown>
export type ConfigurationMigrationStatus = 'ready' | 'failed' | 'lock-unavailable' | 'newer-version'

/** Each store shares one promise; no initialization snapshot is used for writes. */
export function createProviderConfigurationMigration(storage: ConfigurationStorage, lock?: ConfigurationLock) {
  let pending: Promise<ConfigurationMigrationStatus> | undefined
  return (defaults: ProviderConfigurations, refresh?: (providers: ProviderConfigurations, added: Record<string, boolean>) => void) => {
    pending ??= (async (): Promise<ConfigurationMigrationStatus> => {
      if (!lock)
        return 'lock-unavailable'
      let status: ConfigurationMigrationStatus = 'ready'
      try {
        await lock(CONFIGURATION_LOCK, () => {
          const version = Number(storage.getItem(PROVIDER_CONFIGURATION_VERSION_KEY) ?? 0)
          if (version > MIGRATION_VERSION) {
            status = 'newer-version'
            return
          }
          const raw = storage.getItem(PROVIDER_CONFIGURATION_KEY)
          const providers = normalizeProviderConfigurations(parseStoredProviderConfiguration(raw), defaults)
          const addedRaw = storage.getItem(ADDED_PROVIDERS_KEY)
          const added = normalizeAddedProviders(parseStoredProviderConfiguration(addedRaw))
          const serialized = JSON.stringify(providers)
          const serializedAdded = JSON.stringify(added)
          if (raw !== serialized)
            storage.setItem(PROVIDER_CONFIGURATION_KEY, serialized)
          if (addedRaw !== serializedAdded)
            storage.setItem(ADDED_PROVIDERS_KEY, serializedAdded)
          // Refresh synchronously under the lock; storage bindings use sync
          // writes, whose serialization now matches these persisted values.
          refresh?.(providers, added)
          storage.setItem(PROVIDER_CONFIGURATION_VERSION_KEY, String(MIGRATION_VERSION))
        })
        return status
      }
      catch {
        // The existing in-memory normalized settings remain editable. A
        // failed read/write must never claim a successful version upgrade.
        return 'failed'
      }
    })()
    return pending
  }
}

const moduleDefaults: Record<string, { defaultValue: string, valid: (value: string) => boolean }> = {
  'settings/vision/enabled': { defaultValue: String(VISION_DEFAULT_SETTINGS.enabled), valid: value => value === 'true' || value === 'false' },
  'settings/vision/skip-model-screenshot-confirmation': { defaultValue: 'false', valid: value => value === 'true' || value === 'false' },
  'settings/vision/automatic-screenshot-enabled': { defaultValue: String(VISION_DEFAULT_SETTINGS.automaticScreenshotEnabled), valid: value => value === 'true' || value === 'false' },
  'settings/vision/automatic-screenshot-source-id': { defaultValue: VISION_DEFAULT_SETTINGS.automaticScreenshotSourceId, valid: value => value === '' || SCREEN_SOURCE_ID_RE.test(value) },
  'settings/vision/screenshot-interval-seconds': { defaultValue: String(VISION_DEFAULT_SETTINGS.screenshotIntervalSeconds), valid: value => Number.isInteger(Number(value)) && Number(value) >= VISION_SCREENSHOT_INTERVAL_MIN_SECONDS && Number(value) <= VISION_SCREENSHOT_INTERVAL_MAX_SECONDS },
  'settings/vision/provider': { defaultValue: VISION_DEFAULT_SETTINGS.provider, valid: value => ['official-cloud', 'aliyun', 'openai-compatible', 'gemini'].includes(value) },
  'settings/vision/aliyun-api-key': { defaultValue: VISION_DEFAULT_SETTINGS.aliyunApiKey, valid: () => true },
  'settings/vision/aliyun-base-url': { defaultValue: VISION_DEFAULT_SETTINGS.aliyunBaseUrl, valid: () => true },
  'settings/vision/aliyun-model': { defaultValue: VISION_DEFAULT_SETTINGS.aliyunModel, valid: () => true },
  'settings/vision/openai-compatible-api-key': { defaultValue: VISION_DEFAULT_SETTINGS.openAICompatibleApiKey, valid: () => true },
  'settings/vision/openai-compatible-base-url': { defaultValue: VISION_DEFAULT_SETTINGS.openAICompatibleBaseUrl, valid: () => true },
  'settings/vision/openai-compatible-model': { defaultValue: VISION_DEFAULT_SETTINGS.openAICompatibleModel, valid: () => true },
  'settings/vision/gemini-api-key': { defaultValue: VISION_DEFAULT_SETTINGS.geminiApiKey, valid: () => true },
  'settings/vision/gemini-base-url': { defaultValue: VISION_DEFAULT_SETTINGS.geminiBaseUrl, valid: () => true },
  'settings/vision/gemini-model': { defaultValue: VISION_DEFAULT_SETTINGS.geminiModel, valid: () => true },
  'settings/web-search/enabled': { defaultValue: 'false', valid: value => value === 'true' || value === 'false' },
  'settings/web-search/active-provider': { defaultValue: 'tavily', valid: () => true },
  'settings/web-search/max-requests-per-turn': { defaultValue: '1', valid: value => value === '1' || value === '2' },
  'settings/web-search/max-official-points-per-turn': { defaultValue: '0', valid: value => value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) === Number.parseFloat(value) && Number(value) >= 0 },
}
const MODULE_CONFIGURATION_VERSION_KEY = 'settings/new-module-configuration-version'
let moduleMigration: Promise<ConfigurationMigrationStatus> | undefined

export function normalizeNewModuleConfiguration(values: Record<string, string | null>) {
  const normalized = { ...values }
  for (const [key, rule] of Object.entries(moduleDefaults)) {
    const value = values[key]
    if (value == null || !rule.valid(value))
      normalized[key] = rule.defaultValue
  }
  // Repairing the selected destination, source or cadence must not resume a
  // previously enabled capture loop under a newly chosen configuration.
  const captureConfigurationKeys = ['settings/vision/provider', 'settings/vision/automatic-screenshot-source-id', 'settings/vision/screenshot-interval-seconds']
  if (values['settings/vision/automatic-screenshot-enabled'] === 'true'
    && captureConfigurationKeys.some(key => values[key] == null || !moduleDefaults[key].valid(values[key]!))) {
    normalized['settings/vision/automatic-screenshot-enabled'] = 'false'
  }
  return normalized
}

export function createNewModuleConfigurationMigration(storage: ConfigurationStorage, lock?: ConfigurationLock) {
  return async (): Promise<ConfigurationMigrationStatus> => {
    if (!lock)
      return 'lock-unavailable'
    let status: ConfigurationMigrationStatus = 'ready'
    try {
      await lock(CONFIGURATION_LOCK, () => {
        if (Number(storage.getItem(MODULE_CONFIGURATION_VERSION_KEY) ?? 0) > MIGRATION_VERSION) {
          status = 'newer-version'
          return
        }
        const latest = Object.fromEntries(Object.keys(moduleDefaults).map(key => [key, storage.getItem(key)]))
        const normalized = normalizeNewModuleConfiguration(latest)
        for (const [key, value] of Object.entries(normalized)) {
          if (latest[key] !== value && value !== null)
            storage.setItem(key, value)
        }
        storage.setItem(MODULE_CONFIGURATION_VERSION_KEY, String(MIGRATION_VERSION))
      })
      return status
    }
    catch {
      return 'failed'
    }
  }
}

export function browserConfigurationLock(): ConfigurationLock | undefined {
  return typeof navigator !== 'undefined' && navigator.locks ? (name, task) => navigator.locks.request(name, () => task()) : undefined
}

/** Call before creating the vision/search stores. Failure leaves settings editable. */
export function initializeNewModuleConfigurationStorage(): Promise<ConfigurationMigrationStatus> {
  if (typeof window === 'undefined')
    return Promise.resolve('lock-unavailable')
  try {
    moduleMigration ??= createNewModuleConfigurationMigration(window.localStorage, browserConfigurationLock())()
    return moduleMigration
  }
  catch {
    return Promise.resolve('failed')
  }
}
