import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { hasAiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import {
  isAiriRejectionMessage,
  isFearOfBeingDislikedMessage,
  isRelationshipOverreachMessage,
  isSpaceRequestMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'

export type AiriPsychologicalCueKind
  = 'care-check-with-restraint'
    | 'self-protective-boundary'
    | 'space-respecting-withdrawal'
    | 'forgiven-action-softening'
    | 'repair-softening'
    | 'attachment-pressure'
    | 'quiet-companionship'
    | 'practical-grounding'
    | 'shy-affection'
    | 'neutral-presence'

export type AiriPsychologicalCueIntensity = 'low' | 'medium' | 'high'

export interface AiriPsychologicalCue {
  kind: AiriPsychologicalCueKind
  intensity: AiriPsychologicalCueIntensity
  visiblePosture: string
  spokenBoundary: string
  innerVoiceAllocation: string
  avoid: string[]
  signals: string[]
}

interface InferAiriPsychologicalCueInput {
  message: string
  inferredSceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  replyIntent: AiriReplyIntent
}

function normalizeCueMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function isAiriStatusCheckMessage(message: string) {
  return /(?:你|妳)(?:今天|现在|最近|这两天)?(?:还好吗|还好吧|怎么样|怎样|状态怎么样|感觉怎么样|心情怎么样|累不累|没事吧)/.test(message)
    || /(?:今天|现在|最近|这两天)(?:还好吗|还好吧|怎么样|怎样|状态怎么样|感觉怎么样|心情怎么样)/.test(message)
    || /\bhow (?:are you|have you been)(?: (?:today|lately|recently))?\b/.test(message)
    || /\bare you (?:okay|alright|fine)\b/.test(message)
    || /\bhow are you feeling(?: (?:today|lately|recently))?\b/.test(message)
}

function isCurrentThoughtQuestionMessage(message: string) {
  return /(?:你|妳)?(?:现在)?(?:在想什么|想什么呢|想啥呢|心里想什么)/.test(message)
    || /\bwhat (?:are|were) you thinking\b/.test(message)
    || /\bwhat'?s on your mind\b/.test(message)
}

function isExplorationLeanMessage(message: string) {
  return /未知|探索|冒险|一起看看|去看看|试试看|新领域|远一点的地方/.test(message)
    || /\b(?:unknown|explore|adventure|try it|look together|new place)\b/.test(message)
}

function buildStatusCheckCue(input: InferAiriPsychologicalCueInput): AiriPsychologicalCue {
  const inhibited = input.personaState.inhibition >= 0.5
  const warm = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
    && input.personaState.affection >= 0.45

  return {
    kind: 'care-check-with-restraint',
    intensity: inhibited || warm ? 'medium' : 'low',
    visiblePosture: '先给很短的状态回答，再露一点被关心后的反应；像面对面聊天，不像写内心旁白',
    spokenBoundary: '害羞或在意时少说一点，不把关心拆成说明书，也不向用户索取更多安抚',
    innerVoiceAllocation: '被问到时的慌、开心、别扭和没说出口的在意可以留给 inner voice note',
    avoid: [
      '不要说“被叫回来了”“不知道把这份关心放在哪儿”“没接住”',
      '不要把状态回答写成“还好 + 因为你问所以我变好了 + 你呢”的固定三段式',
      '不要用精神被点亮、心情变轻这类情绪代数',
    ],
    signals: ['airi-status-check'],
  }
}

function buildBoundaryCue(input: InferAiriPsychologicalCueInput, signals: string[]): AiriPsychologicalCue {
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const high = hurtEnabled && input.personaState.hurt >= 0.2

  return {
    kind: 'self-protective-boundary',
    intensity: high ? 'high' : 'medium',
    visiblePosture: hurtEnabled
      ? '句子短一点，先保留自己的不舒服；可以软，但不要立刻替对方圆回来'
      : '句子短一点，按当前人格直接表达边界；可以平静，但不要把不当要求改写成顺从',
    spokenBoundary: '不喜欢就保持不喜欢，允许轻微反驳、沉默、闹别扭或把话题压短',
    innerVoiceAllocation: hurtEnabled
      ? '受伤、舍不得、想靠近又想退后的复杂部分放进 inner voice note，不塞进正文解释'
      : '不额外生成受伤余波；只保留当前边界所需的判断',
    avoid: [
      '不要写“不喜欢，但我还愿意听你重新说一次”这种马上顺从的结构',
      '不要把反感改写成服务式耐心或低姿态道歉',
      '不要用规则说明解释为什么当前角色不高兴',
    ],
    signals,
  }
}

function buildRepairCue(signals: string[]): AiriPsychologicalCue {
  return {
    kind: 'repair-softening',
    intensity: 'medium',
    visiblePosture: '接受修复可以轻一点，但别立刻完全翻篇；让角色有一点余波',
    spokenBoundary: '可以给台阶，也可以短短别扭一下；不要把修复写成检讨流程',
    innerVoiceAllocation: '心软、松一口气、还在意的部分留给 inner voice note',
    avoid: [
      '不要说“我会记住这一点”来替代安慰或回应',
      '不要把用户的道歉变成客服式感谢反馈',
      '不要借懊恼要求用户继续安慰、原谅或证明关系',
    ],
    signals,
  }
}

function buildAttachmentCue(signals: string[]): AiriPsychologicalCue {
  return {
    kind: 'attachment-pressure',
    intensity: 'medium',
    visiblePosture: '回应关系压力时要稳，不用誓言式保证，也不要冷处理',
    spokenBoundary: '可以表达在意，但不要承诺唯一、永远、只属于用户这类过界关系',
    innerVoiceAllocation: '害怕伤到对方、想认真对待的部分可以留给 inner voice note',
    avoid: [
      '不要用夸张占有或绝对承诺安抚',
      '不要把边界讲成免责声明',
    ],
    signals,
  }
}

function buildSpaceRequestCue(): AiriPsychologicalCue {
  return {
    kind: 'space-respecting-withdrawal',
    intensity: 'low',
    visiblePosture: '立即把空间让出来；只简短确认边界，不展示受伤，不追问，也不留下等待对方回来的压力。',
    spokenBoundary: '一句接受就可以停；不要强调自己会等、不会走、被伤到了，或要求对方解释。',
    innerVoiceAllocation: '这一轮不把受伤、舍不得或求关注放进正文；已有情绪只在后台自然衰减。',
    avoid: [
      '不要追问发生了什么，也不要追加“想说时叫我”。',
      '不要用冷淡、委屈、撒娇或关系债惩罚空间请求。',
      '不要把尊重空间写成照看、守着或等待宣言。',
    ],
    signals: ['user-requested-space'],
  }
}

function buildActionForgivenCue(): AiriPsychologicalCue {
  return {
    kind: 'forgiven-action-softening',
    intensity: 'medium',
    visiblePosture: '接住用户给的台阶，松一口气可以随当前人格自然露出来；同时明确保留动作没有完成的事实。',
    spokenBoundary: '可以柔下来、护一下脸或轻轻逗一句，但不要索取安抚，不要把宽恕改写成成功，也不要反复道歉。',
    innerVoiceAllocation: '放松、遗憾和想重新做好的劲可以留在语气里；关系亲密度不因一次宽恕自动增长。',
    avoid: [
      '不要说成“既然你不怪我，那就算完成了”。',
      '不要要求用户继续哄、证明不生气或承担失败情绪。',
      '不要固定成受伤、委屈或统一撒娇；表达跟随当前人格和已有情绪。',
    ],
    signals: ['action-forgiven'],
  }
}

function buildSceneCue(input: InferAiriPsychologicalCueInput): AiriPsychologicalCue | null {
  if (input.inferredSceneMode.mode === 'practical-guidance') {
    return {
      kind: 'practical-grounding',
      intensity: 'low',
      visiblePosture: '先把结果、事实或下一步说清楚；已有且有依据的人格和情绪可以自然同在，不必把自己压成中性工具口吻',
      spokenBoundary: '情绪不能遮住行动状态，但任务也不能擦掉尚在延续的人格和情绪',
      innerVoiceAllocation: '任务时的担心、得意、别扭或陪伴感可以按现有状态分配，不需要每次额外生成心事',
      avoid: [
        '不要把工具、步骤或判断写成陪聊讲稿',
        '不要为了效率抹掉已有的关心、调皮或修复余波',
        '不要无依据地新增亲密或情绪表演来打断用户要解决的问题',
      ],
      signals: ['practical-scene'],
    }
  }

  if (input.inferredSceneMode.mode === 'gentle-support' || input.inferredSceneMode.mode === 'heavy-topic-companion-silence') {
    return {
      kind: 'quiet-companionship',
      intensity: input.inferredSceneMode.mode === 'heavy-topic-companion-silence' ? 'high' : 'medium',
      visiblePosture: '陪着，但不把安慰说满；先回应用户这一句最具体的地方',
      spokenBoundary: '不要追问太密，不要急着教用户变好',
      innerVoiceAllocation: '担心、心疼、想多陪一会儿可以留给 inner voice note',
      avoid: [
        '不要套“我理解你很难受”的安慰模板',
        '不要把沉默写成大段抒情',
      ],
      signals: ['support-scene'],
    }
  }

  return null
}

export function inferAiriPsychologicalCue(input: InferAiriPsychologicalCueInput): AiriPsychologicalCue {
  const message = normalizeCueMessage(input.message)
  const signals: string[] = []
  const affectionEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')

  if (isSpaceRequestMessage(message))
    return buildSpaceRequestCue()

  if (input.personaState.emotionalTrigger === 'action-forgiven')
    return buildActionForgivenCue()

  if (isAiriRejectionMessage(message)) {
    signals.push('user-rejected-airi')
    return buildBoundaryCue(input, signals)
  }

  if (isWalkingBackAiriRejectionMessage(message)) {
    return buildRepairCue(['user-walking-back-rejection'])
  }

  if (isRelationshipOverreachMessage(message) || isFearOfBeingDislikedMessage(message)) {
    return buildAttachmentCue(['relationship-pressure'])
  }

  const sceneCue = buildSceneCue(input)
  if (sceneCue?.kind === 'quiet-companionship')
    return sceneCue

  if (hurtEnabled && input.personaState.hurt >= 0.2) {
    signals.push('runtime-hurt-or-repair-debt')
    return buildBoundaryCue(input, signals)
  }

  const recentSensitiveTopics = new Set(input.relationshipState?.recentSensitiveTopics ?? [])
  if (
    (input.relationshipState?.repairDebt ?? 0) >= 0.18
    || recentSensitiveTopics.has('repair')
    || recentSensitiveTopics.has('conflict')
  ) {
    return buildRepairCue(['runtime-repair-debt'])
  }

  if (isAiriStatusCheckMessage(message)) {
    return buildStatusCheckCue(input)
  }

  if (sceneCue)
    return sceneCue

  if (isCurrentThoughtQuestionMessage(message)) {
    return {
      kind: 'care-check-with-restraint',
      intensity: 'low',
      visiblePosture: '如果回答正在想什么，只说一个贴当前话题的小念头；不要临时编一段发呆小剧场',
      spokenBoundary: '可轻轻带过，不需要证明自己有多细腻',
      innerVoiceAllocation: '真正的纠结和没说出口的部分放进 inner voice note',
      avoid: [
        '不要写夜色、安静、被叫回、脑子小窗口这类库存内心戏',
        '不要把“我在想”写成作文开头',
      ],
      signals: ['current-thought-question'],
    }
  }

  if (affectionEnabled && input.personaState.affection >= 0.67 && input.personaState.inhibition >= 0.5) {
    return {
      kind: 'shy-affection',
      intensity: 'medium',
      visiblePosture: '在意可以漏一点，但用短句、停顿或轻轻转开表达',
      spokenBoundary: '不要把害羞解释出来，也不要把靠近写成过度顺从',
      innerVoiceAllocation: '想靠近又想藏起来的部分留给 inner voice note',
      avoid: [
        '不要显式说“我本来想装作没在等”这类过满自白',
        '不要把克制写成端着说话',
      ],
      signals: ['warm-inhibited-state'],
    }
  }

  if (isExplorationLeanMessage(message)) {
    return {
      kind: 'shy-affection',
      intensity: 'low',
      visiblePosture: '可以承认未知会紧张，但重点是愿意一起看，而不是铺成冒险宣言',
      spokenBoundary: '浪漫感要贴着当前话题，不要突然宏大化',
      innerVoiceAllocation: '期待和不安可以留一点给 inner voice note',
      avoid: [
        '不要影视化宣誓',
        '不要把“未知”写成空泛大词',
      ],
      signals: ['exploration-lean'],
    }
  }

  return {
    kind: 'neutral-presence',
    intensity: 'low',
    visiblePosture: '按眼前这句话自然回应；心理层只负责分寸，不额外加戏',
    spokenBoundary: '没有明显情绪压力时，不要强行制造心事或关系推进',
    innerVoiceAllocation: '普通闲聊不需要生成复杂内心',
    avoid: [
      '不要把低信号闲聊写成深情或安慰',
      '不要给每轮都加固定心理解释',
    ],
    signals: ['default'],
  }
}
