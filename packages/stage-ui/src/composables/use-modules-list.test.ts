import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  vision: { customProviderConfigured: true, enabled: false },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    onMounted: (callback: () => void) => callback(),
    onUnmounted: () => {},
  }
})

vi.mock('@proj-airi/stage-shared/beat-sync', () => ({
  getBeatSyncState: vi.fn(async () => undefined),
  listenBeatSyncStateChange: vi.fn(() => () => {}),
}))

vi.mock('../stores/mcp-runtime', () => ({
  useMcpRuntimeStatusStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/consciousness', () => ({
  useConsciousnessStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/discord', () => ({
  useDiscordStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/gaming-factorio', () => ({
  useFactorioStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/hearing', () => ({
  useHearingStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/speech', () => ({
  useSpeechStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/twitter', () => ({
  useTwitterStore: () => ({ configured: false }),
}))
vi.mock('../stores/modules/vision', () => ({
  useVisionStore: () => state.vision,
}))
vi.mock('../stores/modules/web-search', () => ({
  useWebSearchStore: () => ({ configured: false }),
}))

import { useModulesList } from './use-modules-list'

describe('useModulesList', () => {
  beforeEach(() => {
    state.vision.enabled = false
    state.vision.customProviderConfigured = true
  })

  it('lists visual understanding with its configuration state', () => {
    state.vision.enabled = true

    const vision = useModulesList().modulesList.value.find(module => module.id === 'vision')

    expect(vision).toMatchObject({
      category: 'essential',
      configured: true,
      icon: 'i-solar:gallery-bold-duotone',
      to: '/settings/modules/vision',
    })

    expect(useModulesList().modulesList.value.slice(0, 5).map(module => module.id)).toEqual([
      'consciousness',
      'speech',
      'hearing',
      'vision',
      'web-search',
    ])
  })

  it('marks visual understanding unconfigured until it is enabled', () => {
    const vision = useModulesList().modulesList.value.find(module => module.id === 'vision')

    expect(vision?.configured).toBe(false)
  })
})
