import { describe, expect, it } from 'vitest'

import { createDefaultLive2DModelMotionSettings, normalizeLive2DModelMotionSettingsMap } from './live2d'

describe('live2d model motion settings', () => {
  it('keeps motion settings isolated by model and normalizes duplicate keys', () => {
    expect(normalizeLive2DModelMotionSettingsMap({
      alice: {
        idleMotionKeys: ['idle-a', 'idle-a'],
        activityEnabled: true,
        activityMotionKeys: ['wave'],
      },
      bob: {
        idleMotionKeys: ['idle-b'],
        activityEnabled: false,
        activityMotionKeys: ['jump'],
      },
    })).toEqual({
      alice: {
        authoredIdleMode: 'selected',
        idleMotionKeys: ['idle-a'],
        seamlessIdleLoopEnabled: false,
        activityEnabled: true,
        activityMotionKeys: ['wave'],
      },
      bob: {
        authoredIdleMode: 'selected',
        idleMotionKeys: ['idle-b'],
        seamlessIdleLoopEnabled: false,
        activityEnabled: false,
        activityMotionKeys: ['jump'],
      },
    })
  })

  it('drops invalid model records and values', () => {
    expect(normalizeLive2DModelMotionSettingsMap({
      '': { idleMotionKeys: ['idle'] },
      'alice': { idleMotionKeys: [1, 'idle'], activityEnabled: 'yes', activityMotionKeys: null },
    })).toEqual({
      alice: {
        authoredIdleMode: 'selected',
        idleMotionKeys: ['idle'],
        seamlessIdleLoopEnabled: false,
        activityEnabled: false,
        activityMotionKeys: [],
      },
    })
  })

  it('uses three Idle motions for idling and all remaining motions for activities by default', () => {
    expect(createDefaultLive2DModelMotionSettings([
      { fileName: 'idle0.motion3.json', motionIndex: 0, motionName: 'Idle' },
      { fileName: 'idle1.motion3.json', motionIndex: 1, motionName: 'Idle' },
      { fileName: 'idle2.motion3.json', motionIndex: 2, motionName: 'Idle' },
      { fileName: 'idle3.motion3.json', motionIndex: 3, motionName: 'Idle' },
      { fileName: 'wave.motion3.json', motionIndex: 0, motionName: 'Wave' },
    ])).toEqual({
      authoredIdleMode: 'selected',
      idleMotionKeys: ['["Idle",0]', '["Idle",1]', '["Idle",2]'],
      seamlessIdleLoopEnabled: false,
      activityEnabled: true,
      activityMotionKeys: ['["Idle",3]', '["Wave",0]'],
    })
  })

  it('preserves an explicit no-authored-idle choice', () => {
    expect(normalizeLive2DModelMotionSettingsMap({
      alice: {
        authoredIdleMode: 'none',
        idleMotionKeys: ['idle-a'],
      },
    }).alice).toMatchObject({ authoredIdleMode: 'none', idleMotionKeys: ['idle-a'] })
  })
})
