import { describe, expect, it, vi } from 'vitest'

import { createNewModuleConfigurationMigration, createProviderConfigurationMigration, normalizeNewModuleConfiguration, normalizeProviderConfigurations, PROVIDER_CONFIGURATION_KEY, PROVIDER_CONFIGURATION_VERSION_KEY } from './config-normalization'

const defaults = { official: { apiKey: '', model: 'default-model', baseUrl: 'https://default.example/', retry: 1, feature: false } }
const lock = async (_name: string, task: () => void) => task()
function storage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn((key: string, value: string) => {
    data.set(key, value)
  }) }
}

describe('provider configuration normalization', () => {
  it('preserves JSON reserved keys as own data without inheriting defaults or polluting prototypes', () => {
    const input = JSON.parse('{"constructor":{"apiKey":"user-key","toString":"extension"},"toString":{"model":"user-model"},"__proto__":{"custom":"data"},"official":{"__proto__":{"custom":"extension"}}}')
    const normalized = normalizeProviderConfigurations(input, defaults)
    expect(normalized.constructor).toEqual({ apiKey: 'user-key', toString: 'extension' })
    expect(normalized.toString).toEqual({ model: 'user-model' })
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
    expect(Object.hasOwn(normalized.official, '__proto__')).toBe(true)
    expect(normalizeProviderConfigurations(normalized, defaults)).toEqual(normalized)
  })
  it.each([null, [], 'broken', 1])('repairs a damaged top-level shape %j', (value) => {
    expect(normalizeProviderConfigurations(value, defaults)).toEqual(defaults)
  })

  it('repairs each provider and known field while retaining valid credentials and extensions idempotently', () => {
    const normalized = normalizeProviderConfigurations({
      official: { apiKey: 'user-key', model: 'user-model', baseUrl: 'https://user.example/path', retry: 'wrong', feature: true, extension: { custom: 'value' } },
      damaged: [],
      future: { apiKey: 'future-key', vendorOption: 42 },
    }, defaults)
    expect(normalized).toEqual({ official: { ...defaults.official, apiKey: 'user-key', model: 'user-model', baseUrl: 'https://user.example/path', feature: true, extension: { custom: 'value' } }, damaged: {}, future: { apiKey: 'future-key', vendorOption: 42 } })
    expect(normalizeProviderConfigurations(normalized, defaults)).toEqual(normalized)
    expect(normalizeProviderConfigurations({ official: { apiKey: {}, model: [], baseUrl: null } }, defaults)).toEqual(defaults)
  })

  it('reads the newest credentials inside the lock and shares the initialization promise', async () => {
    const persisted = storage({ [PROVIDER_CONFIGURATION_KEY]: JSON.stringify({ official: { apiKey: 'old-key' } }) })
    let enter: (() => void) | undefined
    const queuedLock = vi.fn((_name: string, task: () => void) => new Promise<void>((resolve) => {
      enter = () => {
        task()
        resolve()
      }
    }))
    const initialize = createProviderConfigurationMigration(persisted, queuedLock)
    const first = initialize(defaults)
    const second = initialize(defaults)
    expect(first).toBe(second)
    persisted.data.set(PROVIDER_CONFIGURATION_KEY, JSON.stringify({ official: { apiKey: 'latest-key', model: 'latest-model' } }))
    enter!()
    expect(await first).toBe('ready')
    expect(JSON.parse(persisted.getItem(PROVIDER_CONFIGURATION_KEY)!)).toMatchObject({ official: { apiKey: 'latest-key', model: 'latest-model' } })
    expect(queuedLock).toHaveBeenCalledOnce()
    expect(persisted.getItem(PROVIDER_CONFIGURATION_VERSION_KEY)).toBe('1')
  })

  it('does not advance a version after quota failure or without a cross-window lock', async () => {
    const persisted = storage()
    persisted.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(await createProviderConfigurationMigration(persisted, lock)(defaults)).toBe('failed')
    expect(persisted.getItem(PROVIDER_CONFIGURATION_VERSION_KEY)).toBeNull()
    expect(await createProviderConfigurationMigration(persisted)(defaults)).toBe('lock-unavailable')
    expect(persisted.setItem).toHaveBeenCalledTimes(1)
  })

  it('leaves a future schema untouched and does not downgrade its version', async () => {
    const persisted = storage({ [PROVIDER_CONFIGURATION_VERSION_KEY]: '2', [PROVIDER_CONFIGURATION_KEY]: 'future-format' })
    expect(await createProviderConfigurationMigration(persisted, lock)(defaults)).toBe('newer-version')
    expect(persisted.setItem).not.toHaveBeenCalled()
  })

  it('repairs only new module keys and preserves opt-in settings, user service strings and unknown data', async () => {
    const settings = {
      'settings/vision/enabled': 'true',
      'settings/vision/automatic-screenshot-enabled': 'true',
      'settings/vision/automatic-screenshot-source-id': 'screen:1:0',
      'settings/vision/provider': 'aliyun',
      'settings/vision/aliyun-api-key': 'private-user-key',
      'settings/vision/aliyun-model': 'custom-vl',
      'settings/vision/aliyun-base-url': 'https://user.example/v1/',
      'settings/vision/screenshot-interval-seconds': '300',
      'settings/web-search/max-requests-per-turn': 'broken',
      'settings/unknown/extension': 'retained',
    }
    const normalized = normalizeNewModuleConfiguration(settings)
    expect(normalizeNewModuleConfiguration(normalized)).toEqual(normalized)
    expect(normalized).toMatchObject({ ...settings, 'settings/web-search/max-requests-per-turn': '1' })
    const persisted = storage(settings)
    expect(await createNewModuleConfigurationMigration(persisted, lock)()).toBe('ready')
    expect(persisted.getItem('settings/unknown/extension')).toBe('retained')
    expect(persisted.getItem('settings/vision/automatic-screenshot-enabled')).toBe('true')
    expect(persisted.getItem('settings/vision/aliyun-api-key')).toBe('private-user-key')
  })

  it.each([
    ['settings/vision/provider', 'unknown-provider'],
    ['settings/vision/provider', null],
    ['settings/vision/automatic-screenshot-source-id', 'invalid-source'],
    ['settings/vision/automatic-screenshot-source-id', 'screen:'],
    ['settings/vision/automatic-screenshot-source-id', null],
    ['settings/vision/screenshot-interval-seconds', 'broken'],
    ['settings/vision/screenshot-interval-seconds', null],
  ])('disables automatic capture when repairing %s (%s)', (key, value) => {
    const normalized = normalizeNewModuleConfiguration({
      'settings/vision/provider': 'aliyun',
      'settings/vision/automatic-screenshot-enabled': 'true',
      'settings/vision/automatic-screenshot-source-id': 'screen:1:0',
      'settings/vision/screenshot-interval-seconds': '300',
      [key]: value,
    })
    expect(normalized['settings/vision/automatic-screenshot-enabled']).toBe('false')
    expect(normalizeNewModuleConfiguration(normalized)).toEqual(normalized)
  })
})
