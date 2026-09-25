import type { CharacterPerformanceActionCard } from '../../utils/character-performance-capabilities'

import { Emotion, EMOTION_EmotionMotionName_value } from '../../constants/emotions'

export interface Live2DActionFallbackInput {
  actionCards: Pick<CharacterPerformanceActionCard, 'aiSelectable' | 'emotionTags' | 'id'>[]
  emotion: Emotion
  random?: () => number
}

export interface Live2DActionFallbackSelection {
  actionCardId: string
  reason: 'emotion-matched-motion' | 'emotion-matched-preset' | 'neutral-idle'
}

// NOTICE: 动作兜底（问题 2 治本）。ACT 标记依赖模型自觉输出，官方云模型经常
// 一轮都不给（实测 markers: 0），prompt 反复调频是治标。这里在回合结束时按
// 本轮情绪（deriveLive2DExpressionIntent 主情绪）从动作目录确定性选卡：
// 动作卡 id 是 `motion:["<动作组名>",<index>]`，默认模型动作组名与
// EMOTION_EmotionMotionName_value 对齐（Happy/Sad/.../Idle），直接按组名匹配；
// Neutral 只允许 Idle 系（轻量），其余情绪找不到对应组则不兜底，宁缺毋滥，
// 防止情绪错配的随机动作（如开心回合播 Angry）。
// NOTICE: 兜底扩展——当无 motion: 卡（跨窗口 capabilities 未同步的边缘场景）
// 但有复合表情预设卡时，按 emotionTags 匹配预设，使主舞台仍能动起来。
export function selectFallbackLive2DActionCard(input: Live2DActionFallbackInput): Live2DActionFallbackSelection | undefined {
  const motionName = EMOTION_EmotionMotionName_value[input.emotion]
  if (!motionName)
    return undefined

  // 主路径：motion 资源卡按动作组名匹配。
  // NOTICE: 大小写不敏感——实测模型动作组有 'idle'（小写）也有 'Idle'（大写，
  // 官方 sample），而情绪映射表统一用大写 'Idle'/'Happy'...，原大小写敏感匹配
  // 对小写组名的模型永远兜不上（2026-08-28 第十八轮实测日志实锤）。
  const motionNeedle = `["${motionName.toLowerCase()}",`
  const motionCandidates = input.actionCards.filter((card) => {
    if (card.aiSelectable === false || !card.id.startsWith('motion:'))
      return false
    const idLower = card.id.toLowerCase()
    return idLower.includes(motionNeedle)
  })
  if (motionCandidates.length > 0) {
    const randomIndex = Math.floor((input.random?.() ?? Math.random()) * motionCandidates.length)
    const actionCardId = motionCandidates[Math.min(randomIndex, motionCandidates.length - 1)].id
    return {
      actionCardId,
      reason: input.emotion === Emotion.Neutral ? 'neutral-idle' : 'emotion-matched-motion',
    }
  }

  // 兜底路径：无 motion 卡时按 emotionTags 匹配复合表情预设卡
  // （预设 id 不以 motion:/expression: 开头，是用户在设置里配的 persona:custom-action 等）
  const emotionTag = input.emotion.toLowerCase()
  const presetCandidates = input.actionCards.filter(card => (
    card.aiSelectable !== false
    && !card.id.startsWith('motion:')
    && !card.id.startsWith('expression:')
    && Array.isArray(card.emotionTags)
    && card.emotionTags.some(tag => tag.toLowerCase() === emotionTag)
  ))
  if (presetCandidates.length > 0) {
    const randomIndex = Math.floor((input.random?.() ?? Math.random()) * presetCandidates.length)
    const actionCardId = presetCandidates[Math.min(randomIndex, presetCandidates.length - 1)].id
    return {
      actionCardId,
      reason: input.emotion === Emotion.Neutral ? 'neutral-idle' : 'emotion-matched-preset',
    }
  }

  return undefined
}