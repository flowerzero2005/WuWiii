import { describe, expect, it } from 'vitest'

import { createLive2DMotionKey } from '../stores/live2d'
import { buildLive2DIdleMotionPool, resolveLegacyLive2DIdleMotionKey, selectNextLive2DIdleMotion } from './idle-motion-scheduler'

const motions = [
  { fileName: 'idle-a.motion3.json', motionIndex: 0, motionName: 'Idle' },
  { fileName: 'idle-b.motion3.json', motionIndex: 1, motionName: 'Idle' },
  { fileName: 'wave.motion3.json', motionIndex: 0, motionName: 'Wave' },
]

describe('live2d idle motion scheduler', () => {
  it('uses configured order, removes duplicates, and filters missing keys', () => {
    expect(buildLive2DIdleMotionPool(motions, [
      createLive2DMotionKey('Wave', 0),
      createLive2DMotionKey('Missing', 0),
      createLive2DMotionKey('Idle', 1),
      createLive2DMotionKey('Wave', 0),
    ])).toEqual([{
      group: 'Wave',
      index: 0,
      key: createLive2DMotionKey('Wave', 0),
    }, {
      group: 'Idle',
      index: 1,
      key: createLive2DMotionKey('Idle', 1),
    }])
  })

  it('keeps an explicitly empty pool empty', () => {
    expect(buildLive2DIdleMotionPool(motions, [])).toEqual([])
  })

  it('does not select a fallback motion from an empty pool', () => {
    expect(selectNextLive2DIdleMotion([], undefined, 'sequential')).toBeUndefined()
  })

  it('rotates sequentially in configured order and wraps to the first motion', () => {
    const pool = buildLive2DIdleMotionPool(motions, [
      createLive2DMotionKey('Wave', 0),
      createLive2DMotionKey('Idle', 0),
      createLive2DMotionKey('Idle', 1),
    ])
    expect(selectNextLive2DIdleMotion(pool, undefined, 'sequential')?.key).toBe(pool[0]?.key)
    expect(selectNextLive2DIdleMotion(pool, pool[0]?.key, 'sequential')?.key).toBe(pool[1]?.key)
    expect(selectNextLive2DIdleMotion(pool, pool[2]?.key, 'sequential')?.key).toBe(pool[0]?.key)
  })

  it('avoids an immediate repeat in random mode when another idle motion exists', () => {
    const pool = buildLive2DIdleMotionPool(motions, [
      createLive2DMotionKey('Idle', 0),
      createLive2DMotionKey('Idle', 1),
    ])
    expect(selectNextLive2DIdleMotion(pool, pool[0]?.key, 'random', () => 0)?.key).toBe(pool[1]?.key)
  })

  it('allows the only random idle motion to repeat', () => {
    const pool = buildLive2DIdleMotionPool(motions.slice(0, 1), [createLive2DMotionKey('Idle', 0)])
    expect(selectNextLive2DIdleMotion(pool, pool[0]?.key, 'random', () => 0)?.key).toBe(pool[0]?.key)
  })

  it('always selects the first configured motion in single mode', () => {
    const pool = buildLive2DIdleMotionPool(motions, [
      createLive2DMotionKey('Wave', 0),
      createLive2DMotionKey('Idle', 0),
    ])
    expect(selectNextLive2DIdleMotion(pool, pool[1]?.key, 'single')?.key).toBe(pool[0]?.key)
  })

  it('migrates a matching legacy selection only', () => {
    expect(resolveLegacyLive2DIdleMotionKey(motions, { group: 'Wave', index: 0 })).toBe(createLive2DMotionKey('Wave', 0))
    expect(resolveLegacyLive2DIdleMotionKey(motions, { group: 'Missing', index: 0 })).toBeUndefined()
  })
})
