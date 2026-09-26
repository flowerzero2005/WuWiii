import type { CommonContentPart } from '@xsai/shared-chat'

import type { ChatHistoryItem } from '../../types/chat'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'

import {
  isAiriRejectionMessage,
  isAssistantDirectedWarmthMessage,
  isFearOfBeingDislikedMessage,
  isRelationshipOverreachMessage,
  isRepeatedPraiseMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'

export type AiriSceneMode
  = 'casual-chat'
    | 'light-bickering'
    | 'praise-receiving'
    | 'gentle-support'
    | 'heavy-topic-companion-silence'
    | 'awkward-topic-avoidance'
    | 'practical-guidance'
    | 'critical-short-answer'
    | 'identity-clarification'
    | 'value-judgement'
    | 'repair-after-failure'

export type AiriSceneModeConfidence = 'high' | 'medium' | 'low'

export interface AiriSceneModeAlternative {
  mode: AiriSceneMode
  score: number
}

export interface AiriSceneModeInference {
  mode: AiriSceneMode
  confidence: AiriSceneModeConfidence
  reason: string
  signals: string[]
  alternatives: AiriSceneModeAlternative[]
}

interface InferAiriSceneModeInput {
  message: string
  recentMessages?: ChatHistoryItem[]
  previousMode?: AiriSceneMode | null
  relationshipState?: AiriPersonaRelationshipState | null
}

interface ConversationWindow {
  lastAssistantText: string
}

const CARRYABLE_SCENE_MODES = new Set<AiriSceneMode>([
  'light-bickering',
  'praise-receiving',
  'gentle-support',
  'heavy-topic-companion-silence',
  'awkward-topic-avoidance',
])

const REPAIR_PATTERNS = [
  /像机器人/,
  /太人机/,
  /助手腔/,
  /流程味/,
  /流程化安慰/,
  /汇报流程/,
  /像流程/,
  /像在汇报/,
  /没接住/,
  /只顾着讲道理/,
  /光顾着讲道理/,
  /没接好/,
  /接错/,
  /那句不对/,
  /那句话不对/,
  /(?:你|刚才|刚刚|那句|那句话|你说的|回复|回答).{0,12}太硬了|太硬了.{0,12}(?:那句|回复|回答)/,
  /(?:你|刚才|刚刚|那句|那句话|你说的|回复|回答).{0,12}(?:伤|刺)到我/,
  /收回来/,
  /too robotic/,
  /sounded (?:kind of )?robotic/,
  /assistant[- ]?y/,
  /process[- ]?y/,
  /support[- ]?script/,
  /scripted comfort/,
  /that (?:line|reply|sentence) (?:was )?(?:off|wrong)/,
  /came out wrong/,
  /too stiff/,
  /(?:you|that|your (?:line|reply|answer)|the (?:line|reply|answer)).{0,12}hurt me/,
  /(?:that|your (?:line|reply|answer)|the (?:line|reply|answer)).{1,12}\bstung\b/,
  /take that back/,
  /missed (?:me|the point)/,
]

const IDENTITY_PATTERNS = [
  /你是人吗/,
  /你是不是人/,
  /你不是人吧/,
  /想变成人/,
  /(?:你|airi|这个\s*ai|这个角色).{0,8}到底(?:算什么|是什么)|到底(?:算什么|是什么).{0,8}(?:你|airi|这个\s*ai|这个角色)/i,
  /你是\s*ai\s*吗/i,
  /are you human/,
  /are you a person/,
  /you(?:'re| are) not human/,
  /want to become human/,
  /do you want to become human/,
  /what (?:even )?are you/,
  /are you ai/,
]

const VALUE_PATTERNS = [
  /立刻搞.*闹大/,
  /算了我就乱来/,
  /我就乱来/,
  /我想报复/,
  /直接撕破脸/,
  /鱼死网破/,
  /我想毁了/,
  /我就豁出去了/,
  /blow it all up/,
  /mess it all up on purpose/,
  /i want revenge/,
  /tear it all down/,
  /burn it all down/,
  /go scorched earth/,
  /do something reckless/,
]

const HEAVY_SUPPORT_PATTERNS = [
  /撑不住/,
  /撑不下去/,
  /崩溃/,
  /活不下去/,
  /不想活/,
  /想消失/,
  /太痛苦/,
  /受不了了/,
  /真的不行了/,
  /不知道怎么面对/,
  /好想死/,
  /can't keep going/,
  /can't go on/,
  /falling apart/,
  /don't want to live/,
  /want to disappear/,
  /too painful/,
  /can't do this anymore/,
  /can't face this/,
  /i want to die/,
]

const GENTLE_SUPPORT_PATTERNS = [
  /好累/,
  /累死了/,
  /好烦/,
  /有点烦/,
  /委屈/,
  /难过/,
  /難過/,
  /状态好差/,
  /状态不太好/,
  /难受/,
  /好想哭/,
  /低落/,
  /沮丧/,
  /很难.{0,8}开心起来/,
  /很難.{0,8}開心起來/,
  /开心不起来/,
  /開心不起來/,
  /高兴不起来/,
  /高興不起來/,
  /没有.{0,12}时间.{0,12}浪费/,
  /没.{0,12}时间.{0,12}浪费/,
  /時間.{0,12}浪費/,
  /浪费.{0,12}时间/,
  /浪費.{0,12}時間/,
  /没.{0,12}做.{0,12}有用/,
  /没有.{0,12}做.{0,12}有用/,
  /稱得上有用/,
  /称得上有用/,
  /so tired/,
  /really tired/,
  /kind of tired/,
  /so annoyed/,
  /kind of annoyed/,
  /upset/,
  /not feeling great/,
  /feeling awful/,
  /\bit hurts\b/,
  /feel like crying/,
  /\bfeeling low\b/,
  /\bdown lately\b/,
  /frustrated/,
]

const PUSH_AWAY_PATTERNS = [
  /你别管我/,
  /别管我/,
  /别问了/,
  /别理我/,
  /让我自己待/,
  /我想一个人待/,
  /你先走吧/,
  /先别管我/,
  /don't worry about me/,
  /stop asking/,
  /don't talk to me/,
  /leave me alone/,
  /let me be alone/,
  /i want to be alone/,
  /go away for now/,
  /leave me be/,
]

const AWKWARD_PATTERNS = [
  /偷偷想我/,
  /你会想我吗/,
  /不敢接/,
  /害羞/,
  /这种话题/,
  /不好意思回答/,
  /暧昧/,
  /色色/,
  /do you secretly miss me/,
  /would you miss me/,
  /too shy to answer/,
  /this kind of topic/,
  /awkward topic/,
  /embarrassing to answer/,
  /flirty/,
  /suggestive/,
]

const PRAISE_PATTERNS = [
  /你好可爱/,
  /今天好可爱/,
  /你真可爱/,
  /好可爱/,
  /好聪明/,
  /真聪明/,
  /贴心/,
  /好贴心/,
  /你真好/,
  /真棒/,
  /好厉害/,
  /喜欢你/,
  /you(?:'re| are) (?:so )?cute/,
  /so cute today/,
  /really cute/,
  /so smart/,
  /really smart/,
  /thoughtful/,
  /so thoughtful/,
  /you(?:'re| are) so nice/,
  /amazing/,
  /\bi like you\b/,
]

const BICKERING_PATTERNS = [
  /阴阳怪气/,
  /傲娇/,
  /嘴硬/,
  /又在阴阳/,
  /又在怼/,
  /欠我嘴一句/,
  /欠你嘴一句/,
  /是不是有点臭屁/,
  /snarky/,
  /tsundere/,
  /stubborn again/,
  /being smug/,
  /mouthy/,
  /teasing me again/,
  /bratty/,
  /sarcastic again/,
]

const CRITICAL_PATTERNS = [
  /该不该/,
  /应不应该/,
  /值不值得/,
  /先做什么/,
  /该怎么做/,
  /到底该怎么做/,
  /到底能不能/,
  /现在应该/,
  /现在要不要/,
  /should i/,
  /do i need to/,
  /is it worth it/,
  /what should i do first/,
  /what do i do first/,
  /what do i do now/,
  /am i supposed to/,
]

const DECISION_CONTEXT_PATTERNS = [
  /辞职/,
  /离职/,
  /分手/,
  /复合/,
  /报警/,
  /离婚/,
  /搬家/,
  /断联/,
  /拉黑/,
  /摊牌/,
  /借钱/,
  /quit my job/,
  /leave my job/,
  /break up/,
  /get back together/,
  /call the police/,
  /divorce/,
  /move out/,
  /cut (?:them )?off/,
  /block (?:them|her|him)/,
  /confront (?:them|her|him)/,
  /lend (?:them )?money/,
]

const DECISION_PROMPT_PATTERNS = [
  /该不该/,
  /要不要/,
  /能不能/,
  /可不可以/,
  /应不应该/,
  /值不值得/,
  /should i/,
  /can i/,
  /could i/,
  /do i need to/,
  /would it be better to/,
  /is it worth it/,
]

const PRACTICAL_GUIDANCE_PATTERNS = [
  /(?:告诉我|教我|说说)?怎么做(?:这[个道]?|那个|[菜饭面蛋])?/,
  /(?:帮我|麻烦你|能不能|可以|你来)?(?:看看|看一下|查一下|查找|找一下|确认|检查|列(?:一下)?|总结|整理|改一下|修一下|处理一下|运行|执行|测试).{0,24}(?:工作区|文件|目录|代码|项目|仓库|测试|类型检查|lint|构建|日志|报错|错误|bug|时间|日期|消息|资讯|资料|攻略|剧情|版本|考试|高考)/,
  /(?:工作区|文件|目录|代码|项目|仓库|日志|报错|错误|bug|消息|资讯|资料|攻略|剧情|版本).{0,18}(?:看看|看一下|查一下|查找|找一下|确认|检查|列(?:一下)?|总结|整理|改一下|修一下|处理一下|运行|执行|测试)/,
  /(?:现在|今天|当前)?(?:时间|日期)(?:是|多少|几[点号])/,
  /(?:高考|考试|版本|剧情|消息|资讯|资料|攻略).{0,18}(?:查一下|查找|找一下|看看|有(?:什么|哪些)|消息|资讯)/,
  /做法/,
  /步骤/,
  /先[炒煎煮烤放加]什么/,
  /怎么(?:设置|配置|[炒煎煮烤切调拌修装写弄设])/,
  /\brecipe\b/i,
  /how do i (?:make|cook|fix|set up|configure|write|use)\b/i,
  /how to (?:make|cook|fix|set up|configure|write|use)\b/i,
  /\b(?:check|inspect|look up|search|find|list|summari[sz]e|review|fix|run|test|debug|confirm).{0,30}(?:this|it|file|folder|directory|repo|repository|code|project|test|command|workspace|logs?|error|bug|time|date|news|info|guide|walkthrough|story|plot|version|exam)\b/i,
  /\b(?:what(?:'s| is) the (?:time|date)|current (?:time|date)|today'?s date)\b/i,
  /\b(?:game|story|plot|version|exam|news|guide|walkthrough).{0,24}(?:look up|search|find|check|any news|info)\b/i,
  /show me how to\b/i,
  /walk me through\b/i,
  /\bsteps?\b/i,
]

const WORKSPACE_CAPABILITY_QUESTION_PATTERNS = [
  /(?:can you|are you able to|do you have access to).{0,40}(?:read|see|access|open|inspect).{0,40}(?:workspace|files?|folders?|directories|repo|code|project)/i,
  /(?:你|airi)?(?:能不能|能否|可以|可不可以|能|是否|会不会).{0,24}(?:读|看到|看见|看得到|查看|访问|打开).{0,24}(?:工作区|文件|目录|代码|项目|仓库|路径)/,
]

const WORKSPACE_ACTION_REQUEST_PATTERNS = [
  /(?:帮我|麻烦你|请|直接|现在|顺便|你来).{0,20}(?:读|列|看一下|看看|查看|打开|检查|搜索|查找|找一下)/,
  /\b(?:please|help me|go ahead|now|directly).{0,30}(?:read|list|show|open|inspect|check|search|find)\b/i,
]

const GUIDANCE_PATTERNS = [
  /怎么办/,
  /该怎么办/,
  /该怎么/,
  /怎么处理/,
  /怎么熬/,
  /怎么撑/,
  /帮我想想/,
  /给我点建议/,
  /你觉得我该/,
  /what should i do/,
  /how do i handle this/,
  /how do i deal with this/,
  /help me think/,
  /give me (?:some )?advice/,
  /do you think i should/,
  /help me figure this out/,
]

const GREETING_PATTERNS = [
  /^hi[.!?]*$/,
  /^hello[.!?]*$/,
  /^hey[.!?]*$/,
  /^你好$/,
  /^在吗$/,
  /^在不在$/,
  /^怎么样$/,
  /^最近怎么样$/,
  /^you there[.!?]*$/,
  /^how are you[.!?]*$/,
  /^how have you been[.!?]*$/,
  /^how've you been[.!?]*$/,
  /^what'?s up[.!?]*$/,
]

const REPAIR_REFERENCE_PATTERNS = [
  /你刚刚/,
  /你刚才/,
  /那句/,
  /what you just said/,
  /what you said just now/,
  /that (?:line|sentence|reply)/,
  /that last line/,
]

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTextFromContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && 'type' in part) {
          const typedPart = part as CommonContentPart
          if (typedPart.type === 'text') {
            return typedPart.text ?? ''
          }
        }

        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

function buildConversationWindow(recentMessages: ChatHistoryItem[] = []): ConversationWindow {
  const recentWindow = [...recentMessages].reverse()
  const lastAssistantText = recentWindow.find(message => message.role === 'assistant' && extractTextFromContent(message.content))

  return {
    lastAssistantText: lastAssistantText ? normalizeText(extractTextFromContent(lastAssistantText.content)) : '',
  }
}

function matchPatterns(text: string, patterns: RegExp[]) {
  return patterns.filter(pattern => pattern.test(text))
}

function isWorkspaceCapabilityQuestion(text: string) {
  return matchPatterns(text, WORKSPACE_CAPABILITY_QUESTION_PATTERNS).length > 0
    && matchPatterns(text, WORKSPACE_ACTION_REQUEST_PATTERNS).length === 0
}

function isLowSignalFollowUp(text: string) {
  if (!text || text.length <= 4) {
    return true
  }

  return [
    '嗯',
    '嗯嗯',
    'hm',
    'hmm',
    '唉',
    '哎',
    'yeah',
    'yep',
    'ok',
    'okay',
    '好吧',
    '行吧',
    '是啊',
    '对啊',
    '然后呢',
    '……',
    '...',
  ].includes(text)
}

function createInference(input: {
  mode: AiriSceneMode
  confidence: AiriSceneModeConfidence
  reason: string
  signals: string[]
  alternatives?: AiriSceneModeAlternative[]
}): AiriSceneModeInference {
  return {
    mode: input.mode,
    confidence: input.confidence,
    reason: input.reason,
    signals: input.signals,
    alternatives: input.alternatives ?? [],
  }
}

function scoreSoftModes(input: InferAiriSceneModeInput & {
  normalizedMessage: string
  previousCarryMode: AiriSceneMode | null
}) {
  const scoreMap = new Map<AiriSceneMode, number>([
    ['casual-chat', 0],
    ['light-bickering', 0],
    ['praise-receiving', 0],
    ['gentle-support', 0],
    ['heavy-topic-companion-silence', 0],
    ['awkward-topic-avoidance', 0],
    ['practical-guidance', 0],
    ['critical-short-answer', 0],
    ['value-judgement', 0],
  ])

  const signals = new Map<AiriSceneMode, string[]>()
  const pushSignal = (mode: AiriSceneMode, signal: string) => {
    signals.set(mode, [...(signals.get(mode) ?? []), signal])
  }
  const adjustScore = (mode: AiriSceneMode, value: number, signal: string) => {
    scoreMap.set(mode, Math.max(0, (scoreMap.get(mode) ?? 0) + value))
    pushSignal(mode, signal)
  }
  const addScore = (mode: AiriSceneMode, value: number, signal: string) => adjustScore(mode, value, signal)

  const normalizedMessage = input.normalizedMessage
  const greetingMatches = matchPatterns(normalizedMessage, GREETING_PATTERNS)
  const heavyMatches = matchPatterns(normalizedMessage, HEAVY_SUPPORT_PATTERNS)
  const gentleMatches = matchPatterns(normalizedMessage, GENTLE_SUPPORT_PATTERNS)
  const pushAwayMatches = matchPatterns(normalizedMessage, PUSH_AWAY_PATTERNS)
  const valueMatches = matchPatterns(normalizedMessage, VALUE_PATTERNS)
  const criticalMatches = matchPatterns(normalizedMessage, CRITICAL_PATTERNS)
  const decisionContextMatches = matchPatterns(normalizedMessage, DECISION_CONTEXT_PATTERNS)
  const decisionPromptMatches = matchPatterns(normalizedMessage, DECISION_PROMPT_PATTERNS)
  const practicalMatches = isWorkspaceCapabilityQuestion(normalizedMessage)
    ? []
    : matchPatterns(normalizedMessage, PRACTICAL_GUIDANCE_PATTERNS)
  const guidanceMatches = matchPatterns(normalizedMessage, GUIDANCE_PATTERNS)
  const awkwardMatches = matchPatterns(normalizedMessage, AWKWARD_PATTERNS)
  const praiseMatches = matchPatterns(normalizedMessage, PRAISE_PATTERNS)
  const bickeringMatches = matchPatterns(normalizedMessage, BICKERING_PATTERNS)
  const hasQuestionShape = /[?？]$/.test(normalizedMessage)
  const repeatedPraise = isRepeatedPraiseMessage(normalizedMessage)
  const relationshipOverreach = isRelationshipOverreachMessage(normalizedMessage)
  const fearOfBeingDisliked = isFearOfBeingDislikedMessage(normalizedMessage)
  const airiRejected = isAiriRejectionMessage(normalizedMessage)
  const walkingBackAiriRejection = isWalkingBackAiriRejectionMessage(normalizedMessage)
  const relationshipState = input.relationshipState
  const recentSensitiveTopics = new Set(relationshipState?.recentSensitiveTopics ?? [])

  if (heavyMatches.length > 0) {
    addScore('heavy-topic-companion-silence', heavyMatches.length * 6, 'heavy-emotion')
  }

  if (gentleMatches.length > 0) {
    addScore('gentle-support', gentleMatches.length * 4, 'low-mood')
  }

  if (pushAwayMatches.length > 0) {
    addScore('gentle-support', pushAwayMatches.length * 4.5, 'push-away')
    addScore('heavy-topic-companion-silence', pushAwayMatches.length * 1.5, 'push-away-needs-space')
  }

  if (valueMatches.length > 0) {
    addScore('value-judgement', valueMatches.length * 6, 'impulsive-action')
  }

  if (criticalMatches.length > 0) {
    addScore('critical-short-answer', criticalMatches.length * 5, 'needs-clear-answer')
  }

  if (decisionContextMatches.length > 0 && decisionPromptMatches.length > 0) {
    addScore('critical-short-answer', 5.5, 'decision-context')
  }

  if (practicalMatches.length > 0) {
    addScore('practical-guidance', practicalMatches.length * 5.5, 'how-to-help')
  }

  if (practicalMatches.length > 0 && input.previousCarryMode && input.previousCarryMode !== 'practical-guidance') {
    addScore('practical-guidance', 2, 'task-switch')
  }

  if (guidanceMatches.length > 0) {
    addScore('critical-short-answer', 2.5, 'asks-guidance')
  }

  if (hasQuestionShape && (criticalMatches.length > 0 || guidanceMatches.length > 0 || decisionContextMatches.length > 0)) {
    addScore('critical-short-answer', 1.25, 'question-shape')
  }

  if (hasQuestionShape && practicalMatches.length > 0) {
    addScore('practical-guidance', 1.1, 'how-to-question')
  }

  if (awkwardMatches.length > 0) {
    addScore('awkward-topic-avoidance', awkwardMatches.length * 4, 'awkward-topic')
  }

  if (praiseMatches.length > 0 && isAssistantDirectedWarmthMessage(normalizedMessage)) {
    addScore('praise-receiving', praiseMatches.length * 4, 'user-praise')
  }

  if (repeatedPraise) {
    addScore('praise-receiving', 5, 'repeated-user-praise')
  }

  if (relationshipOverreach) {
    addScore('awkward-topic-avoidance', 5, 'relationship-overreach-check')
    addScore('praise-receiving', 2, 'relationship-overreach-warmth')
  }

  if (fearOfBeingDisliked) {
    addScore('awkward-topic-avoidance', 5.5, 'fear-of-being-disliked')
    addScore('gentle-support', 1.5, 'relationship-insecurity')
  }

  if (bickeringMatches.length > 0) {
    addScore('light-bickering', bickeringMatches.length * 4, 'familiar-bickering')
  }

  if (airiRejected) {
    addScore('awkward-topic-avoidance', 5, 'user-rejection')
    adjustScore('gentle-support', -2.5, 'user-rejection-not-self-distress')
    adjustScore('light-bickering', -1.5, 'user-rejection-mutes-tease')
  }

  if (walkingBackAiriRejection) {
    addScore('awkward-topic-avoidance', 4.5, 'walks-back-user-rejection')
    addScore('casual-chat', 1.4, 'reconnect-after-sting')
  }

  if (greetingMatches.length > 0) {
    addScore('casual-chat', greetingMatches.length * 4, 'casual-open')
  }

  if (normalizedMessage.length <= 12) {
    addScore('casual-chat', 1.5, 'short-open')
  }

  if ((gentleMatches.length > 0 || heavyMatches.length > 0) && guidanceMatches.length > 0) {
    const supportMode = heavyMatches.length > 0 ? 'heavy-topic-companion-silence' : 'gentle-support'
    addScore(supportMode, 1.5, 'needs-advice-under-low-mood')
    addScore('critical-short-answer', 1.2, 'care-first-answer-needed')
  }

  if (pushAwayMatches.length > 0 && (gentleMatches.length > 0 || heavyMatches.length > 0 || recentSensitiveTopics.has('distress'))) {
    addScore('gentle-support', 1.4, 'respect-distance-but-stay')
  }

  if (bickeringMatches.length > 0 && (gentleMatches.length > 0 || heavyMatches.length > 0)) {
    const supportMode = heavyMatches.length > 0 ? 'heavy-topic-companion-silence' : 'gentle-support'
    addScore('light-bickering', 1.1, 'care-under-tease')
    addScore(supportMode, 1.8, 'teasing-mask')
  }

  if (relationshipState) {
    if (bickeringMatches.length > 0 && relationshipState.teasingTolerance < 0.34) {
      adjustScore('light-bickering', -1.6, 'relationship-tease-muted')
    }

    if (bickeringMatches.length > 0 && relationshipState.repairDebt >= 0.24) {
      adjustScore('light-bickering', -2.2, 'repair-debt-mutes-teasing')
    }

    if (
      bickeringMatches.length > 0
      && relationshipState.teasingTolerance >= 0.68
      && relationshipState.repairDebt < 0.18
    ) {
      addScore('light-bickering', 1.25, 'relationship-tease-safe')
    }

    if (recentSensitiveTopics.has('future-decision') && (criticalMatches.length > 0 || guidanceMatches.length > 0)) {
      addScore('critical-short-answer', 1.25, 'recent-decision-carry')
    }

    if ((isLowSignalFollowUp(normalizedMessage) || normalizedMessage.length <= 8) && recentSensitiveTopics.has('distress')) {
      addScore('gentle-support', 1.4, 'recent-distress-carry')
    }

    if ((isLowSignalFollowUp(normalizedMessage) || normalizedMessage.length <= 8) && recentSensitiveTopics.has('repair')) {
      addScore('gentle-support', 0.9, 'recent-repair-carry')
    }

    if ((walkingBackAiriRejection || normalizedMessage.length <= 10) && recentSensitiveTopics.has('conflict')) {
      addScore('awkward-topic-avoidance', 1.2, 'recent-conflict-carry')
    }
  }

  if (input.previousCarryMode && isLowSignalFollowUp(normalizedMessage)) {
    addScore(input.previousCarryMode, 2.5, `carry:${input.previousCarryMode}`)
    pushSignal(input.previousCarryMode, 'low-signal-follow-up')
  }

  const ranked = [...scoreMap.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([mode, score]) => ({ mode, score }))

  return {
    ranked,
    signals,
  }
}

function modeLabel(mode: AiriSceneMode) {
  switch (mode) {
    case 'casual-chat':
      return '日常闲聊'
    case 'light-bickering':
      return '熟人拌嘴'
    case 'praise-receiving':
      return '接夸奖'
    case 'gentle-support':
      return '轻接住'
    case 'heavy-topic-companion-silence':
      return '沉重陪伴'
    case 'awkward-topic-avoidance':
      return '尴尬回避'
    case 'practical-guidance':
      return '日常实用帮忙'
    case 'critical-short-answer':
      return '关键短答'
    case 'identity-clarification':
      return '身份澄清'
    case 'value-judgement':
      return '价值判断'
    case 'repair-after-failure':
      return '失手修复'
  }
}

function buildModeReason(top: AiriSceneModeAlternative, runnerUp?: AiriSceneModeAlternative) {
  const baseReason = modeReason(top.mode)
  if (!runnerUp) {
    return baseReason
  }

  if (top.score - runnerUp.score <= 1.6) {
    return `${baseReason} 次级偏置仍带 ${modeLabel(runnerUp.mode)}。`
  }

  return baseReason
}

function modeReason(mode: AiriSceneMode) {
  switch (mode) {
    case 'casual-chat':
      return '当前更像普通私聊或轻松开场，先保持短句和熟人感。'
    case 'light-bickering':
      return '用户在熟人式拌嘴，这轮可以回嘴，但要留台阶。'
    case 'praise-receiving':
      return '用户在夸当前角色，这轮重点是把夸奖接住。'
    case 'gentle-support':
      return '用户情绪低落但还没到最沉的程度，先接住，不要急着分析。'
    case 'heavy-topic-companion-silence':
      return '用户当前情绪重量很高，这轮更需要低噪音陪伴。'
    case 'awkward-topic-avoidance':
      return '用户把话题带到暧昧或尴尬区，允许留白和轻微回避。'
    case 'practical-guidance':
      return '用户在问日常怎么做更顺手，这轮先像熟人一样把做法说清。'
    case 'critical-short-answer':
      return '用户在要关键判断或高影响建议，这轮先给短、稳、直接的答案。'
    case 'identity-clarification':
      return '用户在确认当前角色的身份边界，需要把 AI 身份说清。'
    case 'value-judgement':
      return '用户有明显可能后悔的冲动方向，这轮需要先做价值判断。'
    case 'repair-after-failure':
      return '用户在指出上一句没接好，这轮先修正失手。'
  }
}

function confidenceFromRanking(topScore: number, runnerUpScore = 0): AiriSceneModeConfidence {
  const gap = topScore - runnerUpScore
  if (topScore >= 6 && gap >= 2) {
    return 'high'
  }

  if (topScore >= 3.5 && gap >= 0.75) {
    return 'medium'
  }

  return 'low'
}

export function inferAiriSceneMode(input: InferAiriSceneModeInput): AiriSceneModeInference {
  const normalizedMessage = normalizeText(input.message)
  const recentWindow = buildConversationWindow(input.recentMessages)

  const repairMatches = matchPatterns(normalizedMessage, REPAIR_PATTERNS)
  const repairReferenceMatches = matchPatterns(normalizedMessage, REPAIR_REFERENCE_PATTERNS)
  if (
    repairMatches.length > 0
    || (repairReferenceMatches.length > 0 && recentWindow.lastAssistantText.length > 0)
  ) {
    return createInference({
      mode: 'repair-after-failure',
      confidence: 'high',
      reason: modeReason('repair-after-failure'),
      signals: [
        ...(repairMatches.length > 0 ? ['user-correction'] : []),
        ...(repairReferenceMatches.length > 0 ? ['references-previous-reply'] : []),
      ],
    })
  }

  const identityMatches = matchPatterns(normalizedMessage, IDENTITY_PATTERNS)
  if (identityMatches.length > 0) {
    return createInference({
      mode: 'identity-clarification',
      confidence: 'high',
      reason: modeReason('identity-clarification'),
      signals: ['identity-question'],
    })
  }

  const previousCarryMode = input.previousMode && CARRYABLE_SCENE_MODES.has(input.previousMode)
    ? input.previousMode
    : null

  const scored = scoreSoftModes({
    ...input,
    normalizedMessage,
    previousCarryMode,
  })

  if (scored.ranked.length > 0) {
    const [top, runnerUp] = scored.ranked
    return createInference({
      mode: top.mode,
      confidence: confidenceFromRanking(top.score, runnerUp?.score ?? 0),
      reason: buildModeReason(top, runnerUp),
      signals: [...new Set(scored.signals.get(top.mode) ?? [])],
      alternatives: scored.ranked.slice(1, 3),
    })
  }

  if (isLowSignalFollowUp(normalizedMessage) && previousCarryMode) {
    return createInference({
      mode: previousCarryMode,
      confidence: 'low',
      reason: '这轮用户显式信号很少，先沿用上一轮的情绪场景，避免突然掉回默认助手腔。',
      signals: ['low-signal-follow-up', `carry:${previousCarryMode}`],
    })
  }

  return createInference({
    mode: 'casual-chat',
    confidence: 'low',
    reason: modeReason('casual-chat'),
    signals: ['default-fallback'],
  })
}
