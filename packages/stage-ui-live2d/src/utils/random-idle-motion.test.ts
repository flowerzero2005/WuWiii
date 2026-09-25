import { describe, expect, it } from 'vitest'

import {
  buildLive2DRandomIdleResources,
  createLive2DRandomIdleActionBinding,
  createLive2DRandomIdleCustomActionKey,
  createLive2DRandomIdleMotionKey,
  normalizeLive2DRandomIdleIntervalRange,
  resolveLive2DRandomIdleDelayMs,
  selectLive2DRandomIdleResource,
} from './random-idle-motion'

describe('live2d random idle motion helpers', () => {
  it('normalizes reversed and out-of-range interval ranges', () => {
    expect(normalizeLive2DRandomIdleIntervalRange(900_000, 1_000)).toEqual({
      minIntervalMs: 5_000,
      maxIntervalMs: 600_000,
    })
  })

  it('resolves a deterministic delay inside the normalized range', () => {
    expect(resolveLive2DRandomIdleDelayMs(30_000, 90_000, () => 0.25)).toBe(45_000)
  })

  it('builds enabled motion and custom action resources only', () => {
    const motionKey = createLive2DRandomIdleMotionKey({ group: 'Wave', index: 1 })
    const customActionKey = createLive2DRandomIdleCustomActionKey('blush-wave')

    const resources = buildLive2DRandomIdleResources({
      availableMotions: [
        { fileName: 'motions/wave.motion3.json', motionIndex: 1, motionName: 'Wave' },
        { fileName: 'motions/jump.motion3.json', motionIndex: 0, motionName: 'Jump' },
      ],
      compositeExpressionPresets: {
        'blush-wave': {
          cleanupMode: 'restore-baseline',
          durationMs: 3200,
          expressions: [{ index: 0, name: 'blush' }],
          id: 'blush-wave',
          name: 'Blush Wave',
        },
      },
      enabledKeys: [motionKey, customActionKey],
    })

    expect(resources.map(resource => resource.key)).toEqual([motionKey, customActionKey])
  })

  it('avoids repeating the previous resource when alternatives exist', () => {
    const resources = buildLive2DRandomIdleResources({
      availableMotions: [
        { fileName: 'motions/a.motion3.json', motionIndex: 0, motionName: 'A' },
        { fileName: 'motions/b.motion3.json', motionIndex: 0, motionName: 'B' },
      ],
      compositeExpressionPresets: {},
      enabledKeys: [
        createLive2DRandomIdleMotionKey({ group: 'A', index: 0 }),
        createLive2DRandomIdleMotionKey({ group: 'B', index: 0 }),
      ],
    })

    expect(selectLive2DRandomIdleResource(resources, resources[0]?.key, () => 0)?.key).toBe(resources[1]?.key)
  })

  it('creates action bindings for motion and custom action resources', () => {
    const motion = buildLive2DRandomIdleResources({
      availableMotions: [{ fileName: 'motions/wave.motion3.json', motionIndex: 1, motionName: 'Wave' }],
      compositeExpressionPresets: {},
      enabledKeys: [createLive2DRandomIdleMotionKey({ group: 'Wave', index: 1 })],
    })[0]
    const customAction = buildLive2DRandomIdleResources({
      availableMotions: [],
      compositeExpressionPresets: {
        action: {
          cleanupMode: 'restore-baseline',
          durationMs: 1200,
          expressions: [],
          id: 'action',
          name: 'Action',
        },
      },
      enabledKeys: [createLive2DRandomIdleCustomActionKey('action')],
    })[0]

    expect(createLive2DRandomIdleActionBinding(motion!)).toMatchObject({
      motion: { group: 'Wave', index: 1 },
      priority: 'low',
    })
    expect(createLive2DRandomIdleActionBinding(motion!)).not.toHaveProperty('cleanupMode')
    expect(createLive2DRandomIdleActionBinding(motion!)).not.toHaveProperty('durationMs')
    expect(createLive2DRandomIdleActionBinding(customAction!)).toMatchObject({
      cleanupMode: 'restore-baseline',
      customActionPresetId: 'action',
      durationMs: 1200,
      priority: 'low',
    })
  })
})
