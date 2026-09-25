import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { filterLive2DCompositeExpressionPresetsByModel, removeLegacyLive2DCompositeExpressionPresets, useLive2d } from './live2d'

describe('live2d composite expression presets', () => {
  it('keeps composite expression presets scoped to the current model', () => {
    const presets = filterLive2DCompositeExpressionPresetsByModel({
      current: {
        expressions: [{ index: 0, name: 'smile' }],
        id: 'current',
        modelId: 'model-a',
        name: 'Current Model Smile',
      },
      other: {
        expressions: [{ index: 1, name: 'wave' }],
        id: 'other',
        modelId: 'model-b',
        name: 'Other Model Wave',
      },
      legacy: {
        expressions: [{ index: 2, name: 'old' }],
        id: 'legacy',
        name: 'Legacy Global Preset',
      },
    }, 'model-a')

    expect(Object.keys(presets)).toEqual(['current'])
  })

  it('removes legacy composite expression presets that are not bound to a model', () => {
    const presets = removeLegacyLive2DCompositeExpressionPresets({
      current: {
        expressions: [{ index: 0, name: 'smile' }],
        id: 'current',
        modelId: 'model-a',
        name: 'Current Model Smile',
      },
      legacy: {
        expressions: [{ index: 2, name: 'old' }],
        id: 'legacy',
        name: 'Legacy Global Preset',
      },
    })

    expect(Object.keys(presets)).toEqual(['current'])
  })
})

describe('live2d emotion transition track', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('accepts emotion while speaking without taking action ownership', () => {
    const store = useLive2d()
    store.requestLive2DAction('persona:semantic-action', { motion: { group: 'Speaking' } })
    const actionState = { ...store.activeActionState! }

    const request = store.requestEmotionTransition('happy', {
      intensity: 2,
      expression: { name: 'Smile' },
      scopeId: 'session-1',
      turnId: 'turn-1',
    })

    expect(request?.intensity).toBe(1)
    expect(store.activeActionState).toEqual(actionState)
    expect(store.actionRequest?.scene).toBe('persona:semantic-action')
  })

  it('turns neutral into an explicit baseline release', () => {
    const store = useLive2d()
    store.requestEmotionTransition('happy', { scopeId: 'session-1', turnId: 'turn-1' })

    const request = store.requestEmotionTransition('neutral', {
      scopeId: 'session-1',
      transitionMs: 800,
      turnId: 'turn-2',
    })

    expect(request).toMatchObject({
      intensity: 0,
      scopeId: 'session-1',
      transitionMs: 800,
      turnId: 'turn-2',
    })
    expect(request?.expression).toBeUndefined()
  })

  it('uses a declared semantic expression without consulting legacy emotion mappings', () => {
    const store = useLive2d()

    const request = store.requestEmotionTransition('happy', {
      expression: { name: 'ExpressionSmile' },
      scopeId: 'session-1',
      turnId: 'turn-1',
    })

    expect(request?.expression).toEqual({ name: 'ExpressionSmile' })
  })

  it('keeps a non-interruptible semantic action until completion or a force request', () => {
    const store = useLive2d()
    const action = store.requestLive2DAction('persona:semantic-action', {
      durationMs: 2000,
      interruptible: false,
      motion: { group: 'Wave' },
      priority: 'high',
    })

    expect(store.requestLive2DAction('persona:other-action', { motion: { group: 'Jump' }, priority: 'high' })).toBeUndefined()
    expect(store.requestLive2DAction('persona:other-action', { motion: { group: 'Jump' }, priority: 'force' })?.id).toBeGreaterThan(action?.id ?? 0)
  })
})

describe('live2d model-scoped performance configuration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setActivePinia(createPinia())
  })

  it('normalizes multi-tag metadata and advanced AI descriptions', () => {
    const store = useLive2d()
    store.setCompositeExpressionPreset({
      aiDescription: '  Use for a small, shy greeting.  ',
      aiSelectable: false,
      emotionTags: [' shy ', 'warm'],
      expressions: [{ index: 0, name: 'smile' }],
      id: 'shy-wave',
      modelId: 'model-a',
      name: 'Shy wave',
      sceneTags: [' greeting ', 'reunion'],
    })

    expect(store.compositeExpressionPresets['shy-wave']).toMatchObject({
      aiDescription: 'Use for a small, shy greeting.',
      aiSelectable: false,
      emotionTags: ['shy', 'warm'],
      sceneTags: ['greeting', 'reunion'],
    })
  })

  it('keeps raw motion and expression semantics scoped to their model', () => {
    const store = useLive2d()
    store.setPerformanceResourceMetadata('model-a', 'motions', 'motion:["Wave",0]', {
      aiDescription: '  A small wave.  ',
      aiSelectable: true,
      avoidWhen: [],
      emotionTags: [' warm ', 'warm'],
      label: ' Wave ',
      parameterClaims: [],
      sceneTags: [' greeting '],
      suitableWhen: [],
    })

    expect(store.performanceResourceMetadataByModel['model-a']?.motions['motion:["Wave",0]']).toMatchObject({
      aiDescription: 'A small wave.',
      emotionTags: ['warm'],
      label: 'Wave',
      sceneTags: ['greeting'],
    })
    expect(store.performanceResourceMetadataByModel['model-b']).toBeUndefined()
  })

  it('removes visual settings and presets owned by a deleted model', () => {
    const store = useLive2d()
    store.setActiveActionModel('model-a')
    store.scale = 1.4
    store.setCompositeExpressionPreset({
      expressions: [{ index: 0, name: 'smile' }],
      id: 'preset-a',
      modelId: 'model-a',
      name: 'Smile',
    })

    store.removeModelConfiguration('model-a')

    expect(store.modelVisualSettings['model-a']).toBeUndefined()
    expect(store.compositeExpressionPresets['preset-a']).toBeUndefined()
    expect(store.activeActionModelId).toBeUndefined()
  })

  it('bumps the preset revision when refreshing changed storage', () => {
    const store = useLive2d()
    const revision = store.compositeExpressionPresetRevision
    const storedPresets = JSON.stringify({
      external: {
        expressions: [{ index: 1, name: 'external' }],
        id: 'external',
        modelId: 'model-a',
        name: 'External',
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === 'settings/live2d/composite-expression-presets' ? storedPresets : null),
    })

    store.refreshFromStorage()

    expect(store.compositeExpressionPresetRevision).toBe(revision + 1)
    expect(store.compositeExpressionPresets.external?.name).toBe('External')
  })

  it('migrates legacy visual settings once and isolates later models', () => {
    const values = new Map<string, string>([
      ['settings/live2d/position', JSON.stringify({ x: 12, y: -8 })],
      ['settings/live2d/scale', '1.7'],
      ['settings/live2d/parameters', JSON.stringify({ mouthOpen: 0.4 })],
    ])
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage })
    const store = useLive2d()
    store.refreshFromStorage()

    store.setActiveActionModel('model-a')
    expect(store.position).toEqual({ x: 12, y: -8 })
    expect(store.scale).toBe(1.7)
    expect(store.modelParameters.mouthOpen).toBe(0.4)

    store.setActiveActionModel('model-b')
    expect(store.position).toEqual({ x: 0, y: 0 })
    expect(store.scale).toBe(1)
    expect(store.modelParameters.mouthOpen).toBe(0)
  })

  it('keeps a local preset when an official preset has the same id', () => {
    const store = useLive2d()
    store.setCompositeExpressionPreset({ expressions: [{ name: 'local' }], id: 'wave', modelId: 'model-a', name: 'Local Wave' })

    store.syncOfficialCompositeExpressionPresets('model-a', [{ expressions: [{ name: 'official' }], id: 'wave', name: 'Official Wave', source: 'official' }])

    expect(store.compositeExpressionPresets.wave?.name).toBe('Local Wave')
    expect(store.compositeExpressionPresets.wave?.source).toBeUndefined()
  })

  it('imports visual settings for the destination model', () => {
    const store = useLive2d()
    store.importModelConfiguration('model-a', {
      visualSettings: {
        parameters: { mouthOpen: 0.6 },
        position: { x: 24, y: -16 },
        scale: 1.8,
      },
    })
    store.setActiveActionModel('model-a')

    expect(store.position).toEqual({ x: 24, y: -16 })
    expect(store.scale).toBe(1.8)
    expect(store.modelParameters.mouthOpen).toBe(0.6)
  })
})
