import type { ContextMessage } from '../../../types/chat'
import type { AiriPersonaRelationshipStateSnapshot } from '../persona-relationship-state'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { hasAiriPersonaEmotionDimension } from '../persona-emotion-dimensions'

const RELATIONSHIP_STATE_CONTEXT_ID = 'persona:relationship-state'

function band(value: number) {
  if (value >= 0.67) {
    return 'high'
  }

  if (value >= 0.34) {
    return 'mid'
  }

  return 'low'
}

function buildBoundaryTags(state: AiriPersonaRelationshipStateSnapshot) {
  const tags: string[] = []
  const teasingEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'teasing')

  if (state.trust < 0.34) {
    tags.push('少擅自越界')
  }

  if (teasingEnabled && state.teasingTolerance < 0.34) {
    tags.push('少嘴硬')
  }

  if (state.repairDebt >= 0.2) {
    tags.push('先补修复债')
  }

  if (state.repairDebt >= 0.32) {
    tags.push('后面几轮也收着')
  }

  if (state.familiarity >= 0.67) {
    tags.push('默认已有前情')
  }

  return tags.length > 0 ? tags.join('|') : '正常熟人分寸'
}

function formatSensitiveTopics(topics: AiriPersonaRelationshipStateSnapshot['recentSensitiveTopics']) {
  return topics.length > 0 ? topics.join(', ') : 'none'
}

export function createRelationshipStateContext(state: AiriPersonaRelationshipStateSnapshot): ContextMessage {
  const teasingEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'teasing')
  return {
    id: nanoid(),
    contextId: RELATIONSHIP_STATE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[relationship]',
      `reliability=${band(state.trust)} familiarity=${band(state.familiarity)}`,
      teasingEnabled
        ? `tease=${band(state.teasingTolerance)} response-repair=${band(state.repairDebt)}`
        : `response-repair=${band(state.repairDebt)}`,
      `sensitive=${formatSensitiveTopics(state.recentSensitiveTopics)}`,
      `relationship-instinct=${buildBoundaryTags(state)}`,
      'use=这些是前情连续性与助手回复修复状态；不自动升级亲密、称呼或安全信任',
      teasingEnabled
        ? 'note=tease 只调节已启用的动态玩笑尺度；其他字段不表示用户欠安抚'
        : 'note=动态玩笑维度未启用；不要从熟悉度或可靠性推导调侃、装熟或亲密',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
