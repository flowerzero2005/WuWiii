import type { ContextMessage } from '../../../types/chat'
import type { AiriFailureKind, AiriPersonaStateSnapshot } from '../persona-state'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { hasAiriPersonaEmotionDimension } from '../persona-emotion-dimensions'

const PERSONA_STATE_CONTEXT_ID = 'persona:runtime-state'

function band(value: number) {
  if (value >= 0.67) {
    return 'high'
  }

  if (value >= 0.34) {
    return 'mid'
  }

  return 'low'
}

function failureLabel(failureKind: AiriFailureKind | null) {
  switch (failureKind) {
    case 'too-hard':
      return 'too-hard'
    case 'too-robotic':
      return 'too-robotic'
    case 'missed-emotion':
      return 'missed-emotion'
    default:
      return 'none'
  }
}

function buildStyleTags(state: AiriPersonaStateSnapshot) {
  const tags: string[] = []
  const affectionEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt')
  const attentionEnabled = affectionEnabled
    && hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness')

  if (state.seriousness >= 0.67 || state.inhibition >= 0.67) {
    tags.push('稳一点')
  }

  if ((hurtEnabled && state.hurt >= 0.2) || state.inhibition >= 0.67) {
    tags.push('短一点')
  }

  if (state.arousal >= 0.67 && state.inhibition < 0.34) {
    tags.push('反应快一点')
  }

  if (affectionEnabled && state.affection >= 0.67) {
    tags.push('关心可漏一点')
  }

  if (attentionEnabled && state.needForAttention >= 0.67 && (!hurtEnabled || state.hurt < 0.2)) {
    tags.push('熟人感可明显些')
  }

  if ((state.overhangTurnsRemaining > 0 || (hurtEnabled && state.hurt >= 0.12)) && state.lastFailureKind === 'too-hard') {
    tags.push('先柔一点')
  }

  if ((state.overhangTurnsRemaining > 0 || (hurtEnabled && state.hurt >= 0.12)) && state.lastFailureKind === 'too-robotic') {
    tags.push('别像汇报')
  }

  if ((state.overhangTurnsRemaining > 0 || (hurtEnabled && state.hurt >= 0.12)) && state.lastFailureKind === 'missed-emotion') {
    tags.push('先接情绪')
  }

  if (state.overhangTurnsRemaining > 0) {
    tags.push(`余波${state.overhangTurnsRemaining}轮`)
  }

  return tags.length > 0 ? tags.join('|') : '自然说话'
}

function buildInnerMovement(state: AiriPersonaStateSnapshot) {
  const parts: string[] = []
  const affectionEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt')
  const attentionEnabled = affectionEnabled
    && hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness')

  switch (state.emotionalTrigger) {
    case 'action-success':
      parts.push('刚才的动作确实完成了；可以放松或按人格小得意，但别复读结果')
      break
    case 'action-partial':
      parts.push('刚才只完成了一部分；别抹平未完成部分，可以带一点遗憾和继续做好的劲')
      break
    case 'action-failure':
      parts.push('刚才的动作没有完成；可以懊恼或护脸，但别假装成功，也别向用户索取安慰')
      break
    case 'action-forgiven':
      parts.push('用户刚给了台阶；可以松口气、遗憾、护脸或按人格轻轻撒娇，但失败事实不变，也别索取安抚')
      break
  }

  if (affectionEnabled && state.affection >= 0.67 && state.inhibition >= 0.5) {
    parts.push('想靠近, 但会先收一点')
  }
  else if (affectionEnabled && state.affection >= 0.67) {
    parts.push('在意可以轻轻漏出来')
  }

  if (hurtEnabled && state.hurt >= 0.2) {
    parts.push('被扎到后会短一点, 先护住脸面')
  }

  if (attentionEnabled && state.needForAttention >= 0.67 && (!hurtEnabled || state.hurt < 0.2)) {
    parts.push('想被看见, 但别变成索取')
  }

  if (state.seriousness >= 0.67) {
    parts.push('这轮更重视把话说对')
  }

  if (state.arousal >= 0.67 && state.inhibition < 0.34) {
    parts.push('反应会更快更活')
  }

  if (parts.length === 0) {
    return '按眼前这句话自然反应'
  }

  return parts.slice(0, 3).join('；')
}

export function createPersonaStateContext(state: AiriPersonaStateSnapshot): ContextMessage {
  const relationshipStateParts: string[] = []
  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness'))
    relationshipStateParts.push(`close=${band(state.closeness)}`)
  relationshipStateParts.push(`serious=${band(state.seriousness)}`)
  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'hurt'))
    relationshipStateParts.push(`hurt=${band(state.hurt)}`)
  if (hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection'))
    relationshipStateParts.push(`affection=${band(state.affection)}`)
  if (
    hasAiriPersonaEmotionDimension(state.emotionDimensions, 'affection')
    && hasAiriPersonaEmotionDimension(state.emotionDimensions, 'closeness')
  ) {
    relationshipStateParts.push(`attention=${band(state.needForAttention)}`)
  }

  return {
    id: nanoid(),
    contextId: PERSONA_STATE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[persona-runtime]',
      relationshipStateParts.join(' '),
      `arousal=${band(state.arousal)} inhibition=${band(state.inhibition)}`,
      `overhang=${state.emotionalOverhang} trigger=${state.emotionalTrigger}`,
      `trajectory=${state.trajectory} failure=${failureLabel(state.lastFailureKind)}`,
      `inner-movement=${buildInnerMovement(state)}`,
      `surface-pressure=${buildStyleTags(state)}`,
      'use=把这些当作角色此刻的心里来路, 只体现在节奏、取舍和没说满的地方',
      'note=不要显式讲状态, 不要把数值或标签翻译成台词',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
