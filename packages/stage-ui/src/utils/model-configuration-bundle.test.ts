import type { ModelPerformanceConfig } from '@proj-airi/server-shared/types'

import { describe, expect, it } from 'vitest'

import { createModelConfigurationArchive, createModelConfigurationBundle, decodeModelAsset, encodeModelAsset, readModelConfigurationArchive, verifyModelConfigurationBundle } from './model-configuration-bundle'

const testPerformanceConfig: ModelPerformanceConfig = {
  actionCards: [],
  capabilities: { supportsContinuousEmotion: true },
  modelId: 'display-model-a',
  naturalBehavior: {
    authoredIdle: { mode: 'none', motionIds: [], seamlessLoop: false },
    occasionalActions: { actionCardIds: [], allowDuringSpeech: false, cooldownMs: 12000, enabled: false, maxWaitMs: 90000, minWaitMs: 45000, preventImmediateRepeat: true },
    blinkEnabled: true,
    breathingEnabled: true,
    gazeEnabled: true,
  },
  renderer: 'vrm',
  resources: { expressions: [], motions: [], parameters: [] },
  schemaVersion: 2,
  visual: { anchor: 'bottom', position: { x: 12, y: -8 }, scale: 1.7 },
}

describe('model configuration bundle', () => {
  it('round trips a fingerprinted model asset', async () => {
    const asset = await encodeModelAsset(new File(['model-bytes'], 'avatar.vrm', { type: 'model/gltf-binary' }))
    const bundle = await createModelConfigurationBundle([{
      asset,
      configuration: {
        performanceConfig: testPerformanceConfig,
      },
      model: {
        format: 'vrm' as never,
        name: 'Avatar',
        sourceId: 'display-model-a',
      },
    }])

    await expect(verifyModelConfigurationBundle(JSON.parse(JSON.stringify(bundle)))).resolves.toMatchObject({
      entries: [{ configuration: { performanceConfig: { visual: { position: { x: 12, y: -8 }, scale: 1.7 } } } }],
      schemaVersion: 2,
    })
    await expect(decodeModelAsset(asset).text()).resolves.toBe('model-bytes')
  })

  it('rejects a changed asset', async () => {
    const asset = await encodeModelAsset(new File(['original'], 'avatar.zip'))
    const bundle = await createModelConfigurationBundle([{
      asset,
      configuration: { performanceConfig: testPerformanceConfig },
      model: { format: 'live2d-zip' as never, name: 'Avatar', sourceId: 'display-model-a' },
    }])
    bundle.entries[0]!.asset.base64 = btoa('changed')

    await expect(verifyModelConfigurationBundle(bundle)).rejects.toThrow(/fingerprint/i)
  })

  it('stores the original model file beside its versioned configuration manifest', async () => {
    const file = new File(['model-bytes'], 'avatar.vrm', { type: 'model/gltf-binary' })
    const asset = await encodeModelAsset(file, {
      schemaVersion: 1,
      author: 'Test Author',
      licenseName: 'Test redistribution grant',
      evidenceNote: 'Test permission record',
      redistribution: 'allowed',
    })
    const archive = await createModelConfigurationArchive([{
      entry: {
        asset,
        configuration: { performanceConfig: testPerformanceConfig },
        model: { format: 'vrm' as never, name: 'Avatar', sourceId: 'display-model-a' },
      },
      file,
    }])

    const restored = await readModelConfigurationArchive(new File([archive], 'avatar.airi.zip', { type: 'application/zip' }))

    expect(restored.entries[0]?.model.name).toBe('Avatar')
    expect(restored.entries[0]?.asset.provenance.redistribution).toBe('allowed')
    await expect(decodeModelAsset(restored.entries[0]!.asset).text()).resolves.toBe('model-bytes')
  })

  it('preserves unknown provenance for community review', async () => {
    const file = new File(['model-bytes'], 'private.vrm')
    const asset = await encodeModelAsset(file)

    const archive = await createModelConfigurationArchive([{
      entry: {
        asset,
        configuration: { performanceConfig: testPerformanceConfig },
        model: { format: 'vrm' as never, name: 'Private', sourceId: 'private-model' },
      },
      file,
    }])
    const restored = await readModelConfigurationArchive(new File([archive], 'unknown.airi.zip'))

    expect(restored.entries[0]?.asset.provenance.redistribution).toBe('unknown')
  })

  it('refuses to share assets explicitly marked local-only', async () => {
    const file = new File(['model-bytes'], 'local-only.vrm')
    const asset = await encodeModelAsset(file, {
      redistribution: 'local-only',
      schemaVersion: 1,
    })

    await expect(createModelConfigurationArchive([{
      entry: {
        asset,
        configuration: { performanceConfig: testPerformanceConfig },
        model: { format: 'vrm' as never, name: 'Local only', sourceId: 'local-only-model' },
      },
      file,
    }])).rejects.toThrow(/local-only/i)
  })
})
