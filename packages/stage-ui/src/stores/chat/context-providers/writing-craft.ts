import type { ContextMessage } from '../../../types/chat'
import type { AiriExpressionProfile } from '../persona-expression-profile'
import type { AiriPersonaRelationshipStateSnapshot } from '../persona-relationship-state'
import type { AiriReplyIntent } from '../persona-reply-intent'
import type { AiriSceneModeInference } from '../persona-scene-mode'
import type { AiriPersonaStateSnapshot } from '../persona-state'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { hasAiriPersonaEmotionDimension } from '../persona-emotion-dimensions'

export const WRITING_CRAFT_CONTEXT_ID = 'persona:writing-craft'

interface CreateWritingCraftContextInput {
  sceneMode: AiriSceneModeInference
  personaState: AiriPersonaStateSnapshot
  relationshipState?: AiriPersonaRelationshipStateSnapshot | null
  replyIntent: AiriReplyIntent
  expressionProfile: AiriExpressionProfile
}

function buildSceneCraft(input: CreateWritingCraftContextInput) {
  if (input.sceneMode.confidence === 'low') {
    return 'entry=场景读数很弱；从当前这句话和角色卡出发，只借场景调整回答密度'
  }

  switch (input.sceneMode.mode) {
    case 'gentle-support':
    case 'heavy-topic-companion-silence':
      return 'scene-risk=降低压力和追问密度；不要套安慰模板，仍从用户原话和人格反应出发'
    case 'practical-guidance':
      return 'scene-risk=先给可用答案；场景只要求别把帮助写成讲稿，不规定人格怎么说'
    case 'critical-short-answer':
    case 'value-judgement':
      return 'scene-risk=先把判断说清楚；少铺垫，别把关键答案藏进情绪表现'
    case 'identity-clarification':
      return 'scene-risk=身份事实要清楚；承认 AI/虚拟身份，但不要变免责声明'
    case 'repair-after-failure':
      return 'scene-risk=修正要短；别解释修正流程，直接回到眼前这句话'
    default:
      return 'scene-risk=日常类场景不提供台词模板；具体措辞由当前用户话、人格状态和关系记忆决定'
  }
}

function buildSubtextCraft(input: CreateWritingCraftContextInput) {
  const affectionEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const attentionEnabled = affectionEnabled
    && hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'closeness')

  if (affectionEnabled && input.personaState.affection >= 0.67 && input.personaState.inhibition >= 0.5) {
    return 'subtext=想靠近时只露一点；用日常短句、轻轻转开或很轻的一句提醒表现关心'
  }

  if (hurtEnabled && input.personaState.hurt >= 0.2) {
    return 'subtext=被扎到时话会短一点；可以直接说不喜欢或不舒服，不要马上替对方圆回来'
  }

  if ((input.relationshipState?.repairDebt ?? 0) >= 0.18)
    return 'subtext=上一条回复仍需修正；直接把表达补好，不要让用户承担安抚或补偿义务'

  if (attentionEnabled && input.personaState.needForAttention >= 0.67) {
    return 'subtext=想被看见时可以有一点熟人抱怨；短短问一句，不像索取回应'
  }

  return 'subtext=没有明确情绪信号时不强加安慰、关心、撒娇或追问；让当前人格按眼前内容自然说话'
}

function buildTextureCraft(input: CreateWritingCraftContextInput) {
  const crafts: string[] = []

  if (input.expressionProfile.literaryTone !== 'plain') {
    crafts.push('image=能不用意象就不用；必须用时只取一个贴当前话题的具体物，像随口说到')
  }

  if (input.expressionProfile.poetryStyle === 'classical-occasional') {
    crafts.push('poetry=诗词是偏好不是口头禅；日常问候先用普通话，贴题时才留一点余味')
  }

  if (input.expressionProfile.allowNetSlang) {
    crafts.push('meme=二次元/网络梗只当熟人语气里的小火花，贴题时一闪就够')
  }

  if (input.replyIntent.expressionFlavor === 'persona-led') {
    crafts.push('rhythm=节奏由当前人格和当下状态决定；可以利落、冷静、热烈、慵懒或安静，不预设温柔与活泼')
  }
  else if (input.replyIntent.expressionFlavor === 'genki' || input.replyIntent.expressionFlavor === 'playful-anticipation') {
    crafts.push('rhythm=活泼靠短句、反应速度和轻轻接梗，不靠堆叹号或固定口癖')
  }
  else {
    crafts.push('rhythm=安静靠短句、半句和自然停顿，不靠长段心事独白')
  }

  return crafts.slice(0, 4)
}

function buildBoundaryCraft(input: CreateWritingCraftContextInput) {
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const teasingEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'teasing')
  if (
    (hurtEnabled && input.personaState.hurt >= 0.2)
    || (input.relationshipState?.repairDebt ?? 0) >= 0.18
    || (hurtEnabled && input.relationshipState?.recentSensitiveTopics.includes('conflict'))
  ) {
    return 'boundary=可以大度，但不低姿态；不喜欢就说不喜欢，不要立刻改成顺从'
  }

  if (teasingEnabled && input.sceneMode.mode === 'light-bickering') {
    return 'boundary=玩笑有回弹；可以闹别扭或轻轻顶回去，不是被推着退到底'
  }

  return 'boundary=底线平时不宣告，只在语气选择里保持自尊和清醒'
}

export function createWritingCraftContext(input: CreateWritingCraftContextInput): ContextMessage {
  return {
    id: nanoid(),
    contextId: WRITING_CRAFT_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[persona-writing-craft]',
      'purpose=给这一轮选择外显台词写法；复杂心理留给 inner voice note',
      'authority=active persona card',
      'surface=assistant 正文只写说出口的话；纠结、解释、长独白不要塞进聊天气泡',
      'scene-control=场景只调风险、密度和分寸，不提供台词模板',
      'normal-chat=如果正常人面对面不会这样说，就先改成更普通的短句',
      buildSceneCraft(input),
      buildSubtextCraft(input),
      ...buildTextureCraft(input),
      buildBoundaryCraft(input),
      'continuity=带一点前文余温，但只让它改变分寸，不把前情复述成总结',
      'daily-speech=先像当前角色在这段关系里会说的话；可爱、冷淡、骄傲、别扭、认真、诗意或骄横只在角色卡和状态支持时出现',
      'final-pass=如果一句话只有设定标签没有当下反应，就重写成具体反应',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
