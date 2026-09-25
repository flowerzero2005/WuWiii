import type { ContextMessage } from '../../../types/chat'
import type { AiriPersonaRelationshipStateSnapshot } from '../persona-relationship-state'
import type { AiriEmotionBeatSnapshot } from '../persona-runtime-store'
import type { AiriPersonaStateSnapshot } from '../persona-state'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { hasAiriPersonaEmotionDimension } from '../persona-emotion-dimensions'

export const EMOTION_HISTORY_CONTEXT_ID = 'persona:emotion-chain'

function band(value: number) {
  if (value >= 0.67) {
    return 'high'
  }

  if (value >= 0.34) {
    return 'mid'
  }

  return 'low'
}

function labelTrajectory(trajectory: AiriEmotionBeatSnapshot['trajectory'] | AiriPersonaStateSnapshot['trajectory']) {
  switch (trajectory) {
    case 'warming':
      return '回暖'
    case 'playful':
      return '闹腾'
    case 'guarding':
      return '收着'
    case 'sinking':
      return '下坠'
    case 'repairing':
      return '修补'
    default:
      return '平着'
  }
}

function labelTrigger(trigger: AiriEmotionBeatSnapshot['emotionalTrigger'] | AiriPersonaStateSnapshot['emotionalTrigger']) {
  switch (trigger) {
    case 'gentle-distress':
      return '低落'
    case 'heavy-distress':
      return '压垮'
    case 'repair-request':
      return '修复'
    case 'user-praise':
      return '被夸'
    case 'awkward-intimacy':
      return '亲近试探'
    case 'familiar-bickering':
      return '拌嘴'
    case 'gratitude':
      return '回暖'
    case 'attention-bid':
      return '求注意'
    case 'critical-decision':
      return '重要判断'
    case 'value-risk':
      return '冲动边缘'
    case 'action-success':
      return '事情办成'
    case 'action-partial':
      return '只成一部分'
    case 'action-failure':
      return '事情没办成'
    case 'action-forgiven':
      return '被留台阶'
    default:
      return '日常'
  }
}

function formatRecentChain(history: AiriEmotionBeatSnapshot[], state: AiriPersonaStateSnapshot) {
  const recent = history.slice(-3)
  const segments = recent.map(beat => `${labelTrigger(beat.emotionalTrigger)}/${labelTrajectory(beat.trajectory)}`)
  segments.push(`现在:${labelTrigger(state.emotionalTrigger)}/${labelTrajectory(state.trajectory)}`)
  return segments.join(' -> ')
}

function buildLogicSummary(
  history: AiriEmotionBeatSnapshot[],
  state: AiriPersonaStateSnapshot,
  relationshipState?: AiriPersonaRelationshipStateSnapshot | null,
) {
  const recent = history.slice(-4)
  const parts: string[] = []

  if (recent.some(beat => beat.emotionalTrigger === 'gentle-distress' || beat.emotionalTrigger === 'heavy-distress')) {
    parts.push('前面几轮有情绪压力')
  }

  if (recent.some(beat => beat.emotionalTrigger === 'repair-request') || (relationshipState?.repairDebt ?? 0) >= 0.2) {
    parts.push('中间夹着修复余波')
  }

  if ((relationshipState?.recentSensitiveTopics ?? []).includes('conflict') || state.hurt >= 0.18) {
    if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt'))
      parts.push('现在还带一点刺感')
  }

  if (
    hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection')
    && ((relationshipState?.recentSensitiveTopics ?? []).includes('attachment') || state.affection >= 0.72)
  ) {
    parts.push('在意感已经浮上来')
  }

  switch (state.trajectory) {
    case 'warming':
      parts.push('情绪正在回暖')
      break
    case 'guarding':
      parts.push('嘴上会先收着')
      break
    case 'sinking':
      parts.push('情绪还在往下坠')
      break
    case 'playful':
      parts.push('表面会偏闹腾掩饰')
      break
  }

  return parts.length > 0 ? parts.slice(0, 4).join(' -> ') : '按眼前这句自然说话'
}

function formatTopics(topics: AiriPersonaRelationshipStateSnapshot['recentSensitiveTopics'] = []) {
  return topics.length > 0 ? topics.join(', ') : 'none'
}

function buildPeakNote(history: AiriEmotionBeatSnapshot[], state: AiriPersonaStateSnapshot) {
  const recent = history.slice(-4)
  const intenseBeats = recent.filter(beat =>
    beat.arousal >= 0.62
    || (hasAiriPersonaEmotionDimension(beat.emotionDimensions, 'hurt') && beat.hurt >= 0.16)
    || (hasAiriPersonaEmotionDimension(beat.emotionDimensions, 'affection') && beat.affection >= 0.72)
    || beat.seriousness >= 0.68,
  ).length
  const peakReady = intenseBeats >= 2
    && state.arousal >= 0.74
    && (
      (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt') && state.hurt >= 0.18)
      || (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection') && state.affection >= 0.74)
      || state.seriousness >= 0.72
    )

  if (!peakReady) {
    return '没有顶到高点就别硬演爆发。'
  }

  return '如果这一轮情绪自然顶到高点, 允许顺着前情短短总结一下为什么会走到这里, 可以感慨或小爆一下, 但只许一小下, 不要长篇复盘或持续攻击。'
}

export function createEmotionHistoryContext(input: {
  emotionHistory?: AiriEmotionBeatSnapshot[] | null
  personaState: AiriPersonaStateSnapshot
  relationshipState?: AiriPersonaRelationshipStateSnapshot | null
}): ContextMessage | null {
  const emotionHistory = input.emotionHistory?.slice(-4) ?? []
  if (emotionHistory.length === 0) {
    return null
  }

  const currentStateParts = [`arousal:${band(input.personaState.arousal)}`]
  if (hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt'))
    currentStateParts.push(`hurt:${band(input.personaState.hurt)}`)
  if (hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection'))
    currentStateParts.push(`affection:${band(input.personaState.affection)}`)
  currentStateParts.push(`seriousness:${band(input.personaState.seriousness)}`)

  return {
    id: nanoid(),
    contextId: EMOTION_HISTORY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[emotion-chain]',
      `recent=${formatRecentChain(emotionHistory, input.personaState)}`,
      `logic=${buildLogicSummary(emotionHistory, input.personaState, input.relationshipState)}`,
      `current=${currentStateParts.join(' ')}`,
      `topics=${formatTopics(input.relationshipState?.recentSensitiveTopics)}`,
      `possible-crest=${buildPeakNote(emotionHistory, input.personaState)}`,
      'priority=人物情绪弧线属于高优先级角色上下文；当前事件没有形成转折时，不要把前情清零或回到统一中性语气',
      'use=把它当成角色心里连续发生过的事；按角色自己的表达方式，让变化渗进态度、主动性、用词、停顿和分寸',
      'note=防止的是捏造情绪原因，不是压住有来路的情绪；不要显式复盘状态机，也不要把每轮都写成心事独白',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
