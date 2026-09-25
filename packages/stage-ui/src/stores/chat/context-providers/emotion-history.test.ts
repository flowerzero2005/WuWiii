import { describe, expect, it } from 'vitest'

import { createDefaultAiriRelationshipState } from '../persona-relationship-state'
import { createDefaultAiriPersonaState } from '../persona-state'
import { createEmotionHistoryContext } from './emotion-history'

describe('createEmotionHistoryContext', () => {
  it('returns null when there is no emotion history yet', () => {
    const context = createEmotionHistoryContext({
      emotionHistory: [],
      personaState: {
        ...createDefaultAiriPersonaState(),
        updatedAt: 1,
      },
    })

    expect(context).toBeNull()
  })

  it('builds a readable emotion chain with a guarded peak note', () => {
    const context = createEmotionHistoryContext({
      emotionHistory: [
        {
          messageTextPreview: '今天一直不太顺',
          sceneMode: 'gentle-support',
          sceneConfidence: 'high',
          emotionalOverhang: 'concerned',
          emotionalTrigger: 'gentle-distress',
          trajectory: 'guarding',
          closeness: 0.45,
          seriousness: 0.62,
          affection: 0.55,
          hurt: 0.18,
          arousal: 0.64,
          inhibition: 0.58,
          capturedAt: 1,
        },
        {
          messageTextPreview: '那句还是有点扎我',
          sceneMode: 'repair-after-failure',
          sceneConfidence: 'high',
          emotionalOverhang: 'guarded',
          emotionalTrigger: 'repair-request',
          trajectory: 'guarding',
          closeness: 0.5,
          seriousness: 0.71,
          affection: 0.6,
          hurt: 0.24,
          arousal: 0.7,
          inhibition: 0.54,
          capturedAt: 2,
        },
      ],
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.78,
        hurt: 0.22,
        arousal: 0.82,
        seriousness: 0.76,
        trajectory: 'warming',
        emotionalTrigger: 'awkward-intimacy',
        updatedAt: 3,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.22,
        recentSensitiveTopics: ['conflict', 'attachment'],
        updatedAt: 3,
      },
    })

    expect(context?.text).toContain('[emotion-chain]')
    expect(context?.text).toContain('recent=低落/收着 -> 修复/收着 -> 现在:亲近试探/回暖')
    expect(context?.text).toContain('logic=')
    expect(context?.text).toContain('topics=conflict, attachment')
    expect(context?.text).toContain('possible-crest=如果这一轮情绪自然顶到高点')
    expect(context?.text).toContain('priority=人物情绪弧线属于高优先级角色上下文')
    expect(context?.text).toContain('防止的是捏造情绪原因，不是压住有来路的情绪')
  })
})
