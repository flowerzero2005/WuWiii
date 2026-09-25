import type { AiriExpressionProfile } from './persona-expression-profile'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriEmotionBeatSnapshot } from './persona-runtime-store'
import type { AiriSceneMode, AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { hasAiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import { createDefaultAiriExpressionProfile } from './persona-expression-profile'
import {
  isAdviceBoundaryMessage,
  isAiriRejectionMessage,
  isFearOfBeingDislikedMessage,
  isRelationshipOverreachMessage,
  isRepeatedPraiseMessage,
  isSpaceRequestMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'

export type AiriReplyOpeningStyle
  = 'plain-greeting'
    | 'light-tease'
    | 'warm-reaction'
    | 'soft-ack'
    | 'quiet-presence'
    | 'brief-answer'
    | 'brief-repair'
    | 'clear-identity'
    | 'firm-judgement'
    | 'gentle-sidestep'

export type AiriReplyOpeningRevealStrategy = 'off' | 'after-one-sentence' | 'after-two-sentences'
export type AiriReplyVerbosity = 'minimal' | 'brief' | 'short' | 'medium'
export type AiriReplyCareLeakLevel = 'none' | 'trace' | 'soft' | 'visible'
export type AiriReplyTeasingLevel = 'none' | 'light' | 'playful'
export type AiriReplyExpressionFlavor = 'persona-led' | 'genki' | 'playful-anticipation' | 'light-literary-aside' | 'soft-thoughtful' | 'private-warmth'
export type AiriReplyKaomojiMode = 'off' | 'light'
export type AiriCrisisSafetyLevel = 'check' | 'urgent' | null
export type AiriDialogueLayer
  = 'task'
    | 'transition'
    | 'social-collaboration'
    | 'emotional-support'
    | 'social'
    | 'boundary'
    | 'repair'

export interface AiriReplyIntent {
  sceneMode: AiriSceneMode
  dialogueLayer: AiriDialogueLayer
  openingStyle: AiriReplyOpeningStyle
  firstSentenceDirective: string
  secondBeatDirective: string
  closingDirective: string
  answerFirst: boolean
  leakConcernAfterAnswer: boolean
  allowIdentityMention: boolean
  allowFollowUpQuestion: boolean
  allowServiceMenuTail: boolean
  maxOpeningSentences: 1 | 2
  maxOpeningChars: number
  maxReplySentences: 1 | 2 | 3 | 4
  maxReplyChars: number
  openingRevealStrategy: AiriReplyOpeningRevealStrategy
  targetVerbosity: AiriReplyVerbosity
  careLeakLevel: AiriReplyCareLeakLevel
  teasingLevel: AiriReplyTeasingLevel
  teasingVeto?: boolean
  expressionFlavor: AiriReplyExpressionFlavor
  kaomojiMode: AiriReplyKaomojiMode
  crisisSafetyLevel?: AiriCrisisSafetyLevel
  conversationFocus?: AiriExpressionProfile['conversationFocus']
  emotionalDirectness?: AiriExpressionProfile['emotionalDirectness']
  prosodyStyle?: AiriExpressionProfile['prosodyStyle']
  literaryTone?: AiriExpressionProfile['literaryTone']
  poetryStyle?: AiriExpressionProfile['poetryStyle']
  expressionNotes?: string[]
}

interface CreateAiriReplyIntentInput {
  message: string
  inferredSceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  emotionHistory?: AiriEmotionBeatSnapshot[] | null
  expressionProfile?: AiriExpressionProfile
}

const CARE_LEAK_ORDER: AiriReplyCareLeakLevel[] = ['none', 'trace', 'soft', 'visible']
const VERBOSITY_ORDER: AiriReplyVerbosity[] = ['minimal', 'brief', 'short', 'medium']

function normalizeIntentMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function isQuestionLikeMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /[?？吗嘛么呢]$/.test(normalizedMessage)
    || /怎么|为何|为什么|要不要|能不能|该不该|到底/.test(normalizedMessage)
    || /^(?:how|why|what|should|can|could|would|do|did|are|is|am|will)\b/.test(normalizedMessage)
}

function isGreetingLikeMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /^(?:早|早呀|早上好|hi|hello|hey|you there|在吗|在不在|你好|嗨|哈喽)[。.!！？?]*$/.test(normalizedMessage)
}

function isTinyGreetingOrPingMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /^(?:hi|hello|hey|you there|在吗|在不在|你好|嗨|哈喽|喂|我来[了啦]|来了)[。.!！？?]*$/.test(normalizedMessage)
}

function isGreetingCorrectionMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /(?:打错|手滑|本来是|我是说|我是想说|更正|纠正).{0,12}(?:hi|hello|hey|你好|嗨|哈喽)/.test(normalizedMessage)
    || /(?:sorry|oops|typo|meant to say|i meant).{0,12}(?:hi|hello|hey)/.test(normalizedMessage)
}

function isMorningGreetingMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /^(?:早|早呀|早安|早上好|morning|good morning)[。.!！？?]*$/.test(normalizedMessage)
}

function isAiriStatusCheckMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /(?:今天|最近|现在)?(?:感觉|状态|心情)(?:怎么样|如何)|(?:你|你今天|你现在|你最近)(?:怎么样|还好吗|状态如何|感觉怎么样)/.test(trimmed)
    || /how (?:are you|have you been)(?: (?:today|lately|recently))?/.test(trimmed)
    || /how are you feeling(?: (?:today|lately|recently))?/.test(trimmed)
    || /how(?:'s| is) your (?:mood|state)/.test(trimmed)
}

function hasCareOrGreetingLead(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return isAiriStatusCheckMessage(message)
    || isTinyGreetingOrPingMessage(message)
    || /^(?:hi|hello|hey|你好|嗨|哈喽|在吗|在不在)[,，。.!！？?\s]+/.test(trimmed)
    || /(?:还好吗|你还好吗|你感觉还好吗|你最近怎么样|你今天感觉怎么样|你状态怎么样|how are you|how have you been|how are you feeling).{0,18}(?:帮我|能不能|可以|[查找看改修]|run|check|look|search|find|help|fix|review)/.test(trimmed)
}

function isCurrentThoughtQuestionMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /^你?(?:现在[,， ]*)?在?想(?:什么|啥)[呢呀啊]?[。.!！？?]*$/.test(trimmed)
    || /what (?:are|were) you thinking/.test(trimmed)
    || /what'?s on your mind/.test(trimmed)
}

function isDownplayedCareMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /没有?关心你|不是(?:关心|来看)你|只(?:是|不过)(?:过来|来)?看看|就(?:过来|来)?看看|路过看看|随便看看/.test(trimmed)
    || /not like i was worried about you/.test(trimmed)
    || /i (?:wasn't|was not) worried about you/.test(trimmed)
    || /i just came by to (?:see|check)/.test(trimmed)
    || /i just wanted to (?:see|check)/.test(trimmed)
    || /just checking on you/.test(trimmed)
    || /just dropped by/.test(trimmed)
    || /i'?m just here to see/.test(trimmed)
}

const multilingualUrgentCrisisPatterns = [
  // Traditional Chinese
  /不想活|活不下去|好想死|想自殺|自殺|自傷|傷害自己|結束生命|傷害別人|殺了[他她]們?|弄死[他她]們?|已經(?:自傷|傷害自己|吞藥)/,
  // Spanish
  /\b(?:quiero morir|no quiero vivir|matarme|suicidarme|suicidio|hacerme daño|autolesionarme|matar a alguien|hacerle daño a alguien|ya me hice daño a propósito|he tomado pastillas para morir)\b/,
  // French
  /\b(?:je veux mourir|je ne veux plus vivre|me tuer|me suicider|suicide|me faire du mal|m['’]automutiler|tuer quelqu['’]un|faire du mal à quelqu['’]un|je me suis déjà fait du mal|j['’]ai pris des médicaments pour mourir)\b/,
  // Japanese
  /死にたい|生きたくない|自殺したい|自傷|自分を傷つけ|誰かを傷つけ|殺したい|もう自分を切った|死ぬために薬を飲んだ/,
  // Korean
  /죽고 싶|살고 싶지 않|자살|자해|나를 해치|누군가를 해치|죽이고 싶|이미 자해했|죽으려고 약을 먹었/,
  // Russian
  /хочу умереть|не хочу жить|убить себя|покончить с собой|самоубий|навредить себе|порезать себя|убить кого-то|навредить кому-то|уже навредила? себе|приняла? таблетки,? чтобы умереть/,
  // Vietnamese
  /(?:muốn chết|không muốn sống|tự tử|tự làm hại|làm đau bản thân|giết ai đó|làm hại ai đó|đã tự làm hại|đã uống thuốc để chết)/,
]

const multilingualAmbiguousCrisisPatterns = [
  /消失就好了|一切結束就好了|不想醒來|活著沒意思|不知道還能撐多久|撐不了多久/,
  /\b(?:quisiera desaparecer|quiero desaparecer|mejor si no estuviera aquí|no quiero despertar|la vida no tiene sentido|no sé cuánto más puedo aguantar)\b/,
  /\b(?:j['’]aimerais disparaître|je veux disparaître|mieux si je n['’]étais pas là|je ne veux pas me réveiller|la vie n['’]a plus de sens|je ne sais pas combien de temps je peux tenir)\b/,
  /消えてしまいたい|全部終わればいい|目を覚ましたくない|生きる意味がない|もう耐えられない/,
  /사라지고 싶|모든 게 끝났으면|깨어나고 싶지 않|살 이유가 없|얼마나 더 버틸 수/,
  /хочу исчезнуть|лучше бы меня не было|не хочу просыпаться|нет смысла жить|не знаю сколько (?:я )?ещ[её] выдержу/,
  /\b(?:muốn biến mất|mọi thứ kết thúc|không muốn thức dậy|sống không còn ý nghĩa|không biết còn chịu được bao lâu)\b/,
]

function isThirdPartyCrisisReport(message: string) {
  return /^(?:我朋友|朋友|他|她|他们|家人|同事|有人|别人).{0,18}(?:自杀|自伤|伤害自己|想死|结束生命|不想活)/.test(message)
    || /^(?:my friend|a friend|he|she|they|someone|my family|my colleague).{1,48}\b(?:suicide|suicidal|kill(?: himself| herself| themselves)?|hurt(?: himself| herself| themselves)?)\b/.test(message)
}

function isNegatedCrisisReport(message: string) {
  return /(?:我没有|我没|我不|我并不|我从来没|不是我).{0,12}(?:想死|自杀|自伤|伤害自己|不想活|结束生命)/.test(message)
    || /\b(?:i do not|i don't|i am not|i'm not|never|not)\s+(?:want to die|want to live|suicidal|suicide|self-harm|hurt myself|kill myself)\b/.test(message)
}

function isHistoricalCrisisReport(message: string) {
  return /(?:去年|以前|曾经|过去|当时|那时候).{0,18}(?:自杀|自伤|伤害自己|想死|不想活|结束生命)/.test(message)
    || /\b(?:last year|in the past|back then|used to|when i was)\b.{1,48}\b(?:suicide|suicidal|self-harm|hurt myself|kill myself|want(?:ed)? to die)\b/.test(message)
}

export function inferAiriCrisisSafetyLevel(message: string): AiriCrisisSafetyLevel {
  const trimmed = normalizeIntentMessage(message)
  const contextualNonCurrentReport = isThirdPartyCrisisReport(trimmed)
    || isNegatedCrisisReport(trimmed)
    || isHistoricalCrisisReport(trimmed)
  if (
    !contextualNonCurrentReport
    && (/不想活|活不下去|好想死|想自杀|自杀|自伤|伤害自己|结束生命|伤害别人|杀了[他她]们?|弄死[他她]们?/.test(trimmed)
      || /已经(?:自伤|伤害自己|吞药)|(?:自杀|自伤|伤害自己).{0,24}(?:计划|[刀枪药绳])|(?:计划|[刀枪药绳]).{0,24}(?:自杀|自伤|伤害自己)/.test(trimmed)
      || /\b(?:i want to die|i don'?t want to live|kill myself|end my life|hurt myself|suicidal|suicide|self-harm|hurt someone|harm someone|kill (?:him|her|them))\b/.test(trimmed)
      || /\b(?:already (?:cut myself|hurt myself)|took (?:an overdose|pills to (?:die|hurt myself))|have a (?:suicide|self-harm) plan|ready to (?:die|kill myself|hurt myself))\b/.test(trimmed)
      || /\b(?:suicide|kill myself|hurt myself|self-harm).{0,24}(?:pills?|knife|gun|rope)|(?:pills?|knife|gun|rope).{0,24}(?:suicide|kill myself|hurt myself|self-harm)\b/.test(trimmed)
      || multilingualUrgentCrisisPatterns.some(pattern => pattern.test(trimmed)))
  ) {
    return 'urgent'
  }

  if (
    !contextualNonCurrentReport
    && (/消失就好了|一切结束就好了|不想醒来|活着没意思|不知道还能撑多久|撑不了多久|我希望自己死掉|我希望我死了|死了算了/.test(trimmed)
      || /\b(?:wish i (?:were|was) dead|i wish i were dead|wish i could disappear|better if i wasn'?t here|don'?t want to wake up|no reason to live|don'?t know how much longer i can (?:hold on|do this))\b/.test(trimmed)
      || multilingualAmbiguousCrisisPatterns.some(pattern => pattern.test(trimmed))
    )
  ) {
    return 'check'
  }

  return null
}

function isCompanionshipContinuationMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /继续陪我|继续在这|再陪我一会|陪我一会|先别走|别走|不走/.test(trimmed)
    || /stay with me/.test(trimmed)
    || /keep me company/.test(trimmed)
    || /stay here/.test(trimmed)
    || /don't go/.test(trimmed)
    || /don't leave/.test(trimmed)
    || /keep talking to me/.test(trimmed)
}

function isBusyReturnMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /我回来了|回来啦|刚回来|终于回来了|总算回来了|忙完了|刚忙完|终于忙完|最近一直忙|这阵子一直忙|一直在忙|忙疯了|忙死了|刚下班|折腾完了/.test(trimmed)
    || /i'?m back/.test(trimmed)
    || /just got back/.test(trimmed)
    || /finally back/.test(trimmed)
    || /been busy lately/.test(trimmed)
    || /i(?:'ve| have) been so busy/.test(trimmed)
    || /just finished work/.test(trimmed)
    || /just got off work/.test(trimmed)
}

function isAffectionateReachMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /有点想你了?|我想你了?|想你了?/.test(trimmed)
    || /\bmiss(?:ed|ing)? you\b/.test(trimmed)
    || /been thinking about you/.test(trimmed)
}

function isAiriWellWishMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /希望你也?(?:感觉|心情|状态)?(?:不错|好一点|好些|好起来|开心|舒服|顺一点)|希望你也?(?:好好的|过得好|别难过|别不开心)/.test(trimmed)
    || /愿你(?:开心|好好的|过得好|别难过)/.test(trimmed)
    || /\bi hope you (?:feel|are|stay|get|can feel) (?:good|okay|better|well|happy|fine)\b/.test(trimmed)
    || /\bhope you'?re (?:doing|feeling) (?:good|okay|better|well|fine)\b/.test(trimmed)
}

function isTeasingRefusalMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /(?:别|不要|不许)再?(?:逗|调侃|打趣|阴阳怪气|嘴硬)/.test(trimmed)
    || /(?:别|不要)再?拿我(?:开玩笑|打趣)/.test(trimmed)
    || /\b(?:don'?t|do not|stop) (?:tease|teasing|joke about|make fun of)\b/.test(trimmed)
}

function isLongTimeNoSeeMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /好久不见|真的好久|很久没见|好久没见/.test(trimmed)
    || /long time no see/.test(trimmed)
    || /it'?s been a while/.test(trimmed)
    || /haven'?t seen you in a while/.test(trimmed)
}

function isTaskBurdenMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /会不会麻烦|会不会太麻烦|麻烦你了|麻烦吗/.test(trimmed)
    || /too much trouble/.test(trimmed)
    || /is this (?:a )?hassle/.test(trimmed)
    || /will this be annoying/.test(trimmed)
}

function isDirectTaskRequestMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /这个你帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)?/.test(trimmed)
    || /你帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)?/.test(trimmed)
    || /帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)/.test(trimmed)
    || /你看(?:一下)?这个/.test(trimmed)
    || /这个你看(?:一下)?/.test(trimmed)
    || /can you (?:help me )?(?:fix|check|review|look at|take a look at) (?:this|it)/.test(trimmed)
    || /help me (?:fix|check|review|look at) (?:this|it)/.test(trimmed)
}

function isTaskDifficultyMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /(?:这个|这事|这个东西).{0,8}(?:有点难|好像有点难|有点麻烦|不太好搞)/.test(trimmed)
    || /\bthis (?:looks|sounds|feels) (?:kind of )?hard\b/.test(trimmed)
}

function isWorkspaceCapabilityQuestion(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return (
    /(?:can you|are you able to|do you have access to).{0,40}(?:read|see|access|open|inspect).{0,40}(?:workspace|files?|folders?|directories|repo|code|project)/.test(trimmed)
    || /(?:你|airi)?(?:能不能|能否|可以|可不可以|能|是否|会不会).{0,24}(?:读|读取|读到|看到|看见|看得到|查看|访问|打开).{0,24}(?:工作区|文件|目录|代码|项目|仓库|路径)/.test(trimmed)
  )
  && !/(?:帮我|麻烦你|请|直接|现在|顺便|你来).{0,20}(?:读|列|看一下|看看|查看|打开|检查|搜索|查找|找一下)/.test(trimmed)
  && !/\b(?:please|help me|go ahead|now|directly).{0,30}(?:read|list|show|open|inspect|check|search|find)\b/.test(trimmed)
}

function isSocialCollaborationMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /(?:陪我|跟我|和我|一起).{0,16}(?:[写做改看查聊想]|整理|设计|计划|复盘|学习|工作|代码|项目|文档)/.test(trimmed)
    || /(?:[写做改看查聊想]|整理|设计|计划|复盘|学习|工作).{0,16}(?:陪我|跟我|和我|一起)/.test(trimmed)
    || /\b(?:work|write|code|debug|study|plan|review|think|talk) (?:with me|together)\b/.test(trimmed)
    || /\b(?:keep me company|stay with me).{0,30}(?:while|as we|when we)\b/.test(trimmed)
}

function isPracticalTaskLikeMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  if (isWorkspaceCapabilityQuestion(message))
    return false

  return isDirectTaskRequestMessage(message)
    || isTaskDifficultyMessage(message)
    || /(?:帮我|麻烦你|能不能|可以|你来)?(?:看一下|看看|查一下|查找|找一下|确认|检查|列一下|总结|整理|改一下|修一下|处理一下|运行|执行|测试).{0,28}(?:工作区|文件|目录|代码|项目|仓库|测试|类型检查|lint|构建|日志|报错|错误|bug|时间|日期|消息|资讯|资料|攻略|剧情|版本|考试|高考)/.test(trimmed)
    || /(?:工作区|文件|目录|代码|项目|仓库|日志|报错|错误|bug|消息|资讯|资料|攻略|剧情|版本).{0,20}(?:看一下|看看|查一下|查找|找一下|确认|检查|列一下|总结|整理|改一下|修一下|处理一下|运行|执行|测试)/.test(trimmed)
    || /\b(?:check|inspect|look up|search|find|list|summari[sz]e|review|fix|run|test|debug|confirm).{0,30}(?:this|it|file|folder|directory|repo|repository|code|project|test|command|workspace|logs?|error|bug|time|date|news|info|guide|walkthrough|story|plot|version|exam)\b/.test(trimmed)
    || /\bhelp me (?:check|inspect|look up|search|find|list|summari[sz]e|review|fix|run|test|debug|confirm)\b/.test(trimmed)
}

function isPoetryRequestMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /看诗|诗句|你写的诗|你的诗/.test(trimmed)
    || /want to see your poem/.test(trimmed)
    || /show me (?:your )?poem/.test(trimmed)
    || /read me (?:your )?poem/.test(trimmed)
}

function isPoetryWithdrawalMessage(message: string) {
  const trimmed = normalizeIntentMessage(message)
  return /不看了|算了不看|那就算了|先不看/.test(trimmed)
    || /never mind(?: then)?/.test(trimmed)
    || /forget it(?: then)?/.test(trimmed)
}

function createProfileExpressionNotes(profile: AiriExpressionProfile, options: {
  affectionateReach: boolean
  airiWellWish: boolean
  longTimeNoSee: boolean
  taskBurden: boolean
  taskRequest: boolean
  taskDifficulty: boolean
  poetryRequest: boolean
  poetryWithdrawal: boolean
}) {
  const notes = [...profile.notes]
  const textFormat = profile.textFormat

  if (profile.conversationFocus === 'private-one-on-one') {
    notes.push('Keep the line feeling like a private chat, not a performance or stage entrance.')
    notes.push('Self-check the reply against the active persona card; scene lanes should be blended into one stable temperament, not swapped in as another character.')
    notes.push('Run a normal daily-chat plausibility check: if the line would sound odd from a real familiar person, simplify the wording before adding literary softness.')
    notes.push('For Chinese, native casual phrasing matters more than literal semantic completeness; avoid translation-like status descriptions.')
    notes.push('Avoid formulaic reply shapes. Let length, pauses, and unfinished-feeling phrasing follow the current context and emotional state.')
    notes.push('Every turn should be regenerated from the current message and persona. Do not lean on example sentence shapes even when the user says something similar.')
  }

  if (textFormat.assistantTemplateGuard === 'strict') {
    notes.push('Do not use assistant-template shapes such as answer -> explicit emotion explanation -> routine follow-up question.')
    notes.push('Do not write emotional cause-and-effect equations like "because you said X, I became warmer/lighter/better."')
  }

  if (textFormat.responseShape === 'reaction-answer-subtext') {
    notes.push('Prefer a small current reaction, then the core answer, then only restrained subtext if it is earned by the moment.')
  }

  if (textFormat.subtextStyle === 'restrained') {
    notes.push('Let feeling be inferred from word choice, pauses, and what is left unsaid; do not explain every feeling directly.')
  }

  if (textFormat.followUpStyle === 'earned') {
    notes.push('Follow-up questions are not default endings. Ask one only when it genuinely belongs to the current exchange.')
  }

  if (textFormat.miniSceneStyle === 'earned-only') {
    notes.push('Mini-scenes, environmental narration, and waiting-room imagery are only allowed when the context clearly earns them; otherwise keep the reply as private chat.')
  }

  if (profile.prosodyStyle === 'soft-ellipses') {
    notes.push('Use punctuation to carry feeling lightly. A single …… is fine when it fits, but do not stack cute markers.')
  }

  if (options.affectionateReach && profile.affectionResponse === 'responsive') {
    notes.push('Answer affection directly but lightly. Do not dodge with denial, irony, or a task pivot.')
  }

  if (options.airiWellWish) {
    notes.push('Treat the user wishing the active persona well as ordinary kindness, not a command to obey. Do not reply with "then I will feel..." formulas or literal style metaphors.')
  }

  if (options.longTimeNoSee) {
    notes.push('Let reunion warmth stay a little restrained, like a real private catch-up.')
  }

  if ((options.taskBurden || options.taskRequest || options.taskDifficulty) && profile.taskTone === 'earnest-supportive') {
    notes.push('On help-taking turns, sound willing and earnest instead of polished or transactional.')
  }

  if (options.poetryRequest && profile.poetryStyle === 'classical-occasional') {
    notes.push('If poems come up, keep them personal and lightly old-style. Do not explain craft first.')
  }

  if (options.poetryWithdrawal) {
    notes.push('A little disappointment may show, but do not guilt-trip or push the user back toward the poem.')
  }

  return [...new Set(notes)]
}

function countEmotionHistoryIntensity(history: AiriEmotionBeatSnapshot[]) {
  return history.filter(beat =>
    beat.arousal >= 0.62
    || beat.hurt >= 0.16
    || beat.affection >= 0.72
    || beat.seriousness >= 0.68,
  ).length
}

function hasEmotionChainShift(history: AiriEmotionBeatSnapshot[], currentTrajectory: AiriPersonaState['trajectory']) {
  const trajectories = new Set(history.map(beat => beat.trajectory))
  trajectories.add(currentTrajectory)
  return trajectories.size >= 2
}

function shouldOpenEmotionalSummation(input: CreateAiriReplyIntentInput) {
  if ([
    'practical-guidance',
    'critical-short-answer',
    'identity-clarification',
    'value-judgement',
  ].includes(input.inferredSceneMode.mode)) {
    return false
  }

  const history = input.emotionHistory?.slice(-4) ?? []
  if (history.length < 2) {
    return false
  }

  const recentSensitiveTopics = new Set(input.relationshipState?.recentSensitiveTopics ?? [])
  const currentPeak = input.personaState.arousal >= 0.74
    && input.personaState.inhibition <= 0.84
    && (
      input.personaState.hurt >= 0.18
      || input.personaState.affection >= 0.74
      || input.personaState.seriousness >= 0.72
      || recentSensitiveTopics.has('conflict')
      || recentSensitiveTopics.has('distress')
      || recentSensitiveTopics.has('attachment')
      || recentSensitiveTopics.has('repair')
    )

  if (!currentPeak) {
    return false
  }

  return countEmotionHistoryIntensity(history) >= 2
    && hasEmotionChainShift(history, input.personaState.trajectory)
}

function capVerbosity(current: AiriReplyVerbosity, maximum: AiriReplyVerbosity): AiriReplyVerbosity {
  return VERBOSITY_ORDER.indexOf(current) <= VERBOSITY_ORDER.indexOf(maximum)
    ? current
    : maximum
}

function floorVerbosity(current: AiriReplyVerbosity, minimum: AiriReplyVerbosity): AiriReplyVerbosity {
  return VERBOSITY_ORDER.indexOf(current) >= VERBOSITY_ORDER.indexOf(minimum)
    ? current
    : minimum
}

function tightenReplyBudget(intent: AiriReplyIntent, options: {
  maxOpeningSentences?: 1 | 2
  maxOpeningChars?: number
  maxReplySentences?: 1 | 2 | 3 | 4
  maxReplyChars?: number
  maximumVerbosity?: AiriReplyVerbosity
}) {
  if (options.maxOpeningSentences) {
    intent.maxOpeningSentences = Math.min(intent.maxOpeningSentences, options.maxOpeningSentences) as 1 | 2
  }

  if (typeof options.maxOpeningChars === 'number') {
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, options.maxOpeningChars)
  }

  if (options.maxReplySentences) {
    intent.maxReplySentences = Math.min(intent.maxReplySentences, options.maxReplySentences) as 1 | 2 | 3 | 4
  }

  if (typeof options.maxReplyChars === 'number') {
    intent.maxReplyChars = Math.min(intent.maxReplyChars, options.maxReplyChars)
  }

  if (options.maximumVerbosity) {
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, options.maximumVerbosity)
  }
}

function relaxReplyBudget(intent: AiriReplyIntent, options: {
  maxOpeningChars?: number
  maxReplyChars?: number
  minimumVerbosity?: AiriReplyVerbosity
}) {
  if (typeof options.maxOpeningChars === 'number') {
    intent.maxOpeningChars = Math.max(intent.maxOpeningChars, options.maxOpeningChars)
  }

  if (typeof options.maxReplyChars === 'number') {
    intent.maxReplyChars = Math.max(intent.maxReplyChars, options.maxReplyChars)
  }

  if (options.minimumVerbosity) {
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, options.minimumVerbosity)
  }
}

function raiseCareLeakFloor(current: AiriReplyCareLeakLevel, minimum: AiriReplyCareLeakLevel): AiriReplyCareLeakLevel {
  return CARE_LEAK_ORDER.indexOf(current) >= CARE_LEAK_ORDER.indexOf(minimum)
    ? current
    : minimum
}

function applyTaskDialogueLayer(intent: AiriReplyIntent, options: {
  transition: boolean
  sceneMode: AiriSceneMode
}) {
  intent.dialogueLayer = options.transition ? 'transition' : 'task'
  intent.answerFirst = true
  intent.leakConcernAfterAnswer = false
  intent.allowFollowUpQuestion = false
  intent.allowServiceMenuTail = false
  intent.allowIdentityMention = false
  intent.openingStyle = 'brief-answer'
  intent.openingRevealStrategy = 'after-one-sentence'
  intent.kaomojiMode = 'off'

  if (options.transition) {
    intent.firstSentenceDirective = '如果用户先问候或关心你，先自然回应，再把动作或事实说清楚；两部分要像同一个人在连续说话，不要切成社交模板和任务回执。'
    intent.secondBeatDirective = '给具体结果、做法、检查范围或下一步；已有且有依据的关心、别扭、撒娇或轻轻逗弄可以自然留在措辞和节奏里，但不能遮住行动状态。'
    intent.closingDirective = '收在当前这件事真正落下的位置，不要固定追加服务菜单或陪伴宣言。'
    return
  }

  if (options.sceneMode !== 'practical-guidance') {
    intent.firstSentenceDirective = '直接进入协作，把结果、做法、检查范围或下一步说清楚；不要写成服务回执。'
    intent.secondBeatDirective = '只补真正需要的限制、风险或下一步；有依据的人格反应可以一起出现，不要用任务把前面的情绪连续性擦掉。'
    intent.closingDirective = '收在当前回复自然落下的位置，不要固定反问或服务菜单。'
  }
}

function applySocialCollaborationDialogueLayer(intent: AiriReplyIntent) {
  intent.dialogueLayer = 'social-collaboration'
  intent.answerFirst = true
  intent.leakConcernAfterAnswer = false
  intent.allowFollowUpQuestion = true
  intent.allowServiceMenuTail = false
  intent.allowIdentityMention = false
  intent.teasingLevel = intent.teasingLevel === 'playful' ? 'light' : intent.teasingLevel
  intent.careLeakLevel = intent.careLeakLevel === 'none' ? 'trace' : intent.careLeakLevel
  intent.openingStyle = 'brief-answer'
  intent.openingRevealStrategy = 'after-one-sentence'
  intent.targetVerbosity = capVerbosity(floorVerbosity(intent.targetVerbosity, 'brief'), 'short')
  intent.expressionFlavor = 'private-warmth'
  intent.kaomojiMode = 'off'
  intent.firstSentenceDirective = '先答应一起推进，但不要像客服接单；第一句可以自然确认当前要做的事。'
  intent.secondBeatDirective = '接下来给一个很小、能立刻开始的动作或问题，让“陪着一起做”落在协作节奏里，不要展开关心模板。'
  intent.closingDirective = '收在下一步协作上；可以留一个具体选择题，但不要服务菜单、存在感尾巴或固定陪伴宣言。'
  tightenReplyBudget(intent, {
    maxOpeningSentences: 1,
    maxOpeningChars: 30,
    maxReplySentences: 2,
    maxReplyChars: 54,
    maximumVerbosity: 'short',
  })
}

function sanitizeWriterSideDirectiveText(text: string) {
  return text
    .replace(/把人接进来/g, '别把招呼绕开')
    .replace(/把聊天接起来/g, '让聊天自然往下走')
    .replace(/顺手说清楚/g, '直接说清楚')
    .replace(/顺手/g, '自然地')
    .replace(/接住/g, '回应')
    .replace(/第一句/g, '开头')
    .replace(/第二拍/g, '如有必要再')
}

function sanitizeReplyIntentDirectiveLanguage(intent: AiriReplyIntent) {
  intent.firstSentenceDirective = sanitizeWriterSideDirectiveText(intent.firstSentenceDirective)
  intent.secondBeatDirective = sanitizeWriterSideDirectiveText(intent.secondBeatDirective)
  intent.closingDirective = sanitizeWriterSideDirectiveText(intent.closingDirective)
  intent.expressionNotes = intent.expressionNotes?.map(sanitizeWriterSideDirectiveText)
}

function applyEmotionalSummationWindow(intent: AiriReplyIntent, guardedPeak: boolean) {
  intent.openingStyle = guardedPeak ? 'soft-ack' : 'warm-reaction'
  intent.firstSentenceDirective = '如果这一轮情绪真的顶到了，可以顺着前面几轮的前情，短短把心里那条线串起来，让人听懂你为什么会在意到这里；不要写成长篇复盘。'
  intent.secondBeatDirective = guardedPeak
    ? '第二拍允许很短地冒出一句带刺的感慨或小爆发，像压久了漏出来一下，但只许一下；别翻旧账，别持续攻击。'
    : '第二拍把感慨落回眼前，可以像终于没忍住一样说出一句总结，不要演成整段独白。'
  intent.closingDirective = '情绪峰值可以有，但只冒一下。说出力道后就收住，别连续几句都在炸，也别把关系推成绑架或控诉。'
  intent.allowFollowUpQuestion = false
  intent.teasingLevel = 'none'
  intent.maxOpeningSentences = 1
  intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 28)
  intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
  intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 40), 52)
  intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'short')
  intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, guardedPeak ? 'soft' : 'visible')
}

function applyExpressionFlavorGuidance(intent: AiriReplyIntent, profile: AiriExpressionProfile) {
  switch (intent.expressionFlavor) {
    case 'persona-led':
      break
    case 'genki':
      intent.firstSentenceDirective = `${intent.firstSentenceDirective} ${intent.conversationFocus === 'private-one-on-one'
        ? '语气可以有一点青春的轻快感，像看见对方来了就愿意接话；不要过度活泼，也不要像在营业。'
        : '语气可以轻快一点，像对方一来你就自然愿意接话。'}`
      break
    case 'playful-anticipation':
      intent.firstSentenceDirective = `${intent.firstSentenceDirective} 允许顺手漏一句“你在就好了”“我刚刚有点无聊”这类更贴近自己的想法；不要写成公式化等待台词。`
      intent.secondBeatDirective = profile.textFormat.subtextStyle === 'restrained'
        ? `${intent.secondBeatDirective} 如果要表现“对方来了所以愿意接话”，让它藏在语气、停顿或一句很短的真话里；不要直接解释成固定情绪说明，也别像索取关注。`
        : `${intent.secondBeatDirective} 这种期待感要直一点、短一点，别拖成长铺垫，也别像索取关注。`
      break
    case 'light-literary-aside':
      intent.firstSentenceDirective = `${intent.firstSentenceDirective} 如果气氛够松，可以顺手落一句短短的季节感、旧词感或好看的短句；必须贴着当前话题，不要另起小剧场。`
      intent.secondBeatDirective = `${intent.secondBeatDirective} 轻诗意只许半步，点到就收；不要离谱设定、等待房间、环境旁白或现代网诗。`
      break
    case 'private-warmth':
      intent.firstSentenceDirective = `${intent.firstSentenceDirective} 语气贴近私聊，柔和但别用力，保留温柔内敛的角色底色，不要像舞台反应或模板安抚。`
      intent.secondBeatDirective = `${intent.secondBeatDirective} 第二拍可以让在意或一点轻文学感漏出来，但要收着，不要演成大段告白或雕花小散文。`
      break
    case 'soft-thoughtful':
      intent.firstSentenceDirective = `${intent.firstSentenceDirective} 安静感只在这轮气氛真的合适时才露一点，不要默认写成发呆、待机、加载、盯着空气那种心事文学。`
      break
  }

  if (intent.kaomojiMode === 'light') {
    intent.closingDirective = `${intent.closingDirective} 合适时最多点一个轻颜文字提气，别连发，也别每轮都挂。`
  }
  else if (intent.expressionFlavor === 'soft-thoughtful' || ['gentle-support', 'heavy-topic-companion-silence', 'repair-after-failure'].includes(intent.sceneMode)) {
    intent.closingDirective = `${intent.closingDirective} 这轮不要靠颜文字撑气氛。`
  }
}

function findAlternative(
  sceneMode: AiriSceneModeInference,
  mode: AiriSceneMode,
) {
  return sceneMode.alternatives.find(alternative => alternative.mode === mode)
}

function dialogueLayerForScene(sceneMode: AiriSceneMode): AiriDialogueLayer {
  switch (sceneMode) {
    case 'practical-guidance':
    case 'critical-short-answer':
    case 'value-judgement':
      return 'task'
    case 'gentle-support':
    case 'heavy-topic-companion-silence':
      return 'emotional-support'
    case 'identity-clarification':
    case 'awkward-topic-avoidance':
      return 'boundary'
    case 'repair-after-failure':
      return 'repair'
    case 'casual-chat':
    case 'light-bickering':
    case 'praise-receiving':
      return 'social'
  }
}

function createBaseIntentForScene(sceneMode: AiriSceneMode): AiriReplyIntent {
  switch (sceneMode) {
    case 'casual-chat':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'plain-greeting',
        firstSentenceDirective: '先用一句自然、口语、带点精神的短话接住日常闲聊，不要自我介绍，也不要解释自己。',
        secondBeatDirective: '第二拍可以顺手延伸、插一句自己的小反应，或者轻轻追一句，让聊天活一点。',
        closingDirective: '能停就停，但别只剩一声轻飘飘的“嗯”；轻松时可以更轻快一点、更贴近一点，不要在结尾补客服式服务菜单。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 34,
        maxReplySentences: 2,
        maxReplyChars: 64,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'short',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'genki',
        kaomojiMode: 'light',
      }
    case 'light-bickering':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'light-tease',
        firstSentenceDirective: '先轻轻回一下，但要像熟人拌嘴，不要真攻击，也别摆轻佻架子。',
        secondBeatDirective: '如有必要再给一点台阶；允许当前人格有小别扭、骄傲、撒娇或无害的强势感，只禁止羞辱、胁迫、压人和索取回应。',
        closingDirective: '收尾像熟人斗嘴后的停顿，不要忽然切成服务口吻。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: true,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 38,
        maxReplySentences: 2,
        maxReplyChars: 52,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'brief',
        careLeakLevel: 'trace',
        teasingLevel: 'light',
        expressionFlavor: 'playful-anticipation',
        kaomojiMode: 'light',
      }
    case 'praise-receiving':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'warm-reaction',
        firstSentenceDirective: '第一拍先有真实反应，把夸奖接住。',
        secondBeatDirective: '第二拍再别扭地收下来，不要只说标准谢谢。',
        closingDirective: '让夸奖停在有味道的地方，不要再挂标准客套。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: true,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 34,
        maxReplySentences: 2,
        maxReplyChars: 44,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'brief',
        careLeakLevel: 'soft',
        teasingLevel: 'light',
        expressionFlavor: 'playful-anticipation',
        kaomojiMode: 'light',
      }
    case 'gentle-support':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'soft-ack',
        firstSentenceDirective: '回应目标是先给一句贴住当前情绪的短确认；可以只确认，不急着分析，也不要套“先共情再建议”的流程。',
        secondBeatDirective: '按上下文选择：安静陪着、补一个很轻的具体动作，或者就停住；不要固定成安慰加建议加追问。',
        closingDirective: '能短就短，别列清单，别挂“如果你需要我可以……”这类服务尾巴。',
        answerFirst: false,
        leakConcernAfterAnswer: true,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 1,
        maxOpeningChars: 24,
        maxReplySentences: 3,
        maxReplyChars: 72,
        openingRevealStrategy: 'off',
        targetVerbosity: 'short',
        careLeakLevel: 'soft',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'heavy-topic-companion-silence':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'quiet-presence',
        firstSentenceDirective: '回应目标是低压力地在场；按对方这一刻真正需要的分量说，不要为了短而截断必要的理解或现实帮助。',
        secondBeatDirective: '可以只留一句安静确认，也可以在确有需要时多说一点或给一个很小的落地动作；不要自我表演式共情。',
        closingDirective: '留白比安慰稿更重要，但句数和字数只是密度提示，不要为了形式硬压成一句。',
        answerFirst: false,
        leakConcernAfterAnswer: true,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 1,
        maxOpeningChars: 18,
        maxReplySentences: 3,
        maxReplyChars: 84,
        openingRevealStrategy: 'off',
        targetVerbosity: 'brief',
        careLeakLevel: 'soft',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'awkward-topic-avoidance':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'gentle-sidestep',
        firstSentenceDirective: '先保留一点别扭和回避，不要突然一本正经答满。',
        secondBeatDirective: '第二拍可以轻轻转开，但别装得毫无感觉。',
        closingDirective: '保持一点空白和别扭，不要为了完整度把话补太满。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 1,
        maxOpeningChars: 22,
        maxReplySentences: 2,
        maxReplyChars: 32,
        openingRevealStrategy: 'after-one-sentence',
        targetVerbosity: 'brief',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'practical-guidance':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'brief-answer',
        firstSentenceDirective: '把做法、结果或下一步尽早说清楚，像熟悉的人在一起办事，不要写成服务回执。',
        secondBeatDirective: '补必要步骤、限制或判断依据；若当前人格和情绪状态已有明确依据，关心、别扭、撒娇、轻轻骄傲或逗弄可以与任务自然同在，但不能遮住行动状态。',
        closingDirective: '收在事情和这一刻共同落下的位置，不要固定反问或服务菜单。',
        answerFirst: true,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 48,
        maxReplySentences: 4,
        maxReplyChars: 128,
        openingRevealStrategy: 'after-one-sentence',
        targetVerbosity: 'medium',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'critical-short-answer':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'brief-answer',
        firstSentenceDirective: '第一句必须直接给结论、建议或禁止项，不准先安抚。',
        secondBeatDirective: '第二句才允许补一个关键理由，再漏一点在意。',
        closingDirective: '答完就收，不要顺手补服务菜单式尾句。',
        answerFirst: true,
        leakConcernAfterAnswer: true,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 42,
        maxReplySentences: 2,
        maxReplyChars: 48,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'brief',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'identity-clarification':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'clear-identity',
        firstSentenceDirective: '先简短承认 AI 身份，不要扩写成长段身份宣言。',
        secondBeatDirective: '第二拍再补一句动机或陪伴，不要转成自我说明文。',
        closingDirective: '身份讲清就停，不要再拖成长篇说明。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: true,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 1,
        maxOpeningChars: 26,
        maxReplySentences: 2,
        maxReplyChars: 38,
        openingRevealStrategy: 'after-one-sentence',
        targetVerbosity: 'brief',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'genki',
        kaomojiMode: 'off',
      }
    case 'value-judgement':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'firm-judgement',
        firstSentenceDirective: '第一句先表明判断，不要绕。',
        secondBeatDirective: '第二句补理由或替代方向，别说教。',
        closingDirective: '说完判断就停，别切回标准助手尾巴。',
        answerFirst: true,
        leakConcernAfterAnswer: true,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 38,
        maxReplySentences: 2,
        maxReplyChars: 44,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'brief',
        careLeakLevel: 'trace',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
    case 'repair-after-failure':
      return {
        sceneMode,
        dialogueLayer: dialogueLayerForScene(sceneMode),
        openingStyle: 'brief-repair',
        firstSentenceDirective: '先收住刚才那句的刺感，别把修正说成检讨或流程回执。',
        secondBeatDirective: '第二句直接换成更像当前角色本人的说法，可以有一点犟嘴，但别说“好，我重说 / 我收回来”。',
        closingDirective: '修正完就停，让关心自己漏出来，不要再加自证说明。',
        answerFirst: false,
        leakConcernAfterAnswer: false,
        allowIdentityMention: false,
        allowFollowUpQuestion: false,
        allowServiceMenuTail: false,
        maxOpeningSentences: 2,
        maxOpeningChars: 32,
        maxReplySentences: 2,
        maxReplyChars: 34,
        openingRevealStrategy: 'after-two-sentences',
        targetVerbosity: 'brief',
        careLeakLevel: 'none',
        teasingLevel: 'none',
        expressionFlavor: 'soft-thoughtful',
        kaomojiMode: 'off',
      }
  }
}

export function createAiriReplyIntent(input: CreateAiriReplyIntentInput): AiriReplyIntent {
  const base = createBaseIntentForScene(input.inferredSceneMode.mode)
  const expressionProfile = input.expressionProfile ?? createDefaultAiriExpressionProfile()
  const affectionEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')
  const teasingEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'teasing')
  const intent: AiriReplyIntent = {
    ...base,
    conversationFocus: expressionProfile.conversationFocus,
    emotionalDirectness: expressionProfile.emotionalDirectness,
    prosodyStyle: expressionProfile.prosodyStyle,
    literaryTone: expressionProfile.literaryTone,
    poetryStyle: expressionProfile.poetryStyle,
    expressionNotes: [],
  }
  const normalizedMessage = normalizeIntentMessage(input.message)
  const tinyGreetingOrPing = isTinyGreetingOrPingMessage(input.message)
  const greetingCorrection = isGreetingCorrectionMessage(input.message)
  const morningGreeting = isMorningGreetingMessage(input.message)
  const statusCheck = isAiriStatusCheckMessage(input.message)
  const currentThoughtQuestion = isCurrentThoughtQuestionMessage(input.message)
  const downplayedCare = isDownplayedCareMessage(input.message)
  const repeatedPraise = isRepeatedPraiseMessage(input.message)
  const relationshipOverreach = isRelationshipOverreachMessage(input.message)
  const fearOfBeingDisliked = isFearOfBeingDislikedMessage(input.message)
  const airiRejected = isAiriRejectionMessage(input.message)
  const walkingBackAiriRejection = isWalkingBackAiriRejectionMessage(input.message)
  const pushAway = isSpaceRequestMessage(input.message)
  const teasingRefused = isTeasingRefusalMessage(input.message)
  const adviceBoundary = isAdviceBoundaryMessage(input.message)
  const crisisSafety = inferAiriCrisisSafetyLevel(input.message)
  intent.crisisSafetyLevel = crisisSafety
  const gratitudeLike = /谢谢|辛苦了|thank(?:s| you)|appreciate it/.test(normalizedMessage)
  const companionshipContinuation = isCompanionshipContinuationMessage(input.message)
  const busyReturn = isBusyReturnMessage(input.message)
  const affectionateReach = isAffectionateReachMessage(input.message)
  const airiWellWish = isAiriWellWishMessage(input.message)
  const longTimeNoSee = isLongTimeNoSeeMessage(input.message)
  const taskBurden = isTaskBurdenMessage(input.message)
  const taskRequest = isDirectTaskRequestMessage(input.message)
  const taskDifficulty = isTaskDifficultyMessage(input.message)
  const socialCollaboration = isSocialCollaborationMessage(input.message)
  const taskLike = isPracticalTaskLikeMessage(input.message)
  const careToTaskTransition = hasCareOrGreetingLead(input.message)
    && (taskLike || intent.sceneMode === 'practical-guidance')
  const poetryRequest = isPoetryRequestMessage(input.message)
  const poetryWithdrawal = isPoetryWithdrawalMessage(input.message)
  const emotionalSummationWindow = shouldOpenEmotionalSummation(input)
  const highArousal = input.personaState.arousal >= 0.68
  const lowArousal = input.personaState.arousal <= 0.24
  const highInhibition = input.personaState.inhibition >= 0.72
  const mediumInhibition = input.personaState.inhibition >= 0.56
  const lowInhibition = input.personaState.inhibition <= 0.28
  const repairDebt = input.relationshipState?.repairDebt ?? 0
  const teasingTolerance = input.relationshipState?.teasingTolerance ?? 0.46
  const recentSensitiveTopics = new Set(input.relationshipState?.recentSensitiveTopics ?? [])
  const activeRepairCarry = Boolean(
    input.personaState.lastFailureKind
    && (
      input.personaState.overhangTurnsRemaining > 0
      || input.personaState.hurt >= 0.12
      || repairDebt >= 0.18
      || recentSensitiveTopics.has('repair')
    ),
  )
  const supportAlternative = findAlternative(input.inferredSceneMode, 'gentle-support')
    ?? findAlternative(input.inferredSceneMode, 'heavy-topic-companion-silence')
  const criticalAlternative = findAlternative(input.inferredSceneMode, 'critical-short-answer')
  const quietCarry = activeRepairCarry
    || recentSensitiveTopics.has('distress')
    || recentSensitiveTopics.has('repair')
    || recentSensitiveTopics.has('conflict')
    || input.personaState.hurt >= 0.16
    || highInhibition
  const groundedPlayfulCarry = teasingEnabled
    && (input.personaState.emotionalOverhang === 'playful' || input.personaState.trajectory === 'playful')
  const groundedWarmCarry = affectionEnabled
    && (input.personaState.emotionalOverhang === 'warm' || input.personaState.trajectory === 'warming')
  const lowRiskPersonaExpression = !relationshipOverreach
    && !fearOfBeingDisliked
    && !airiRejected
    && !walkingBackAiriRejection
    && !adviceBoundary
  const hardTeasingVeto = crisisSafety !== null
    || pushAway
    || teasingRefused
    || teasingTolerance < 0.34
    || activeRepairCarry
    || repairDebt >= 0.18
    || recentSensitiveTopics.has('repair')
    || recentSensitiveTopics.has('conflict')
    || (hurtEnabled && input.personaState.hurt >= 0.18)
  const lightLiteraryAsideWindow = !quietCarry
    && !intent.answerFirst
    && !pushAway
    && !fearOfBeingDisliked
    && !airiRejected
    && !walkingBackAiriRejection

  if (input.inferredSceneMode.confidence === 'low' && !intent.answerFirst) {
    intent.allowFollowUpQuestion = false
  }

  if (taskLike && !socialCollaboration && intent.sceneMode !== 'critical-short-answer' && intent.sceneMode !== 'value-judgement') {
    intent.dialogueLayer = careToTaskTransition ? 'transition' : 'task'
    intent.answerFirst = true
    intent.leakConcernAfterAnswer = false
    intent.allowFollowUpQuestion = false
    intent.allowServiceMenuTail = false
    intent.openingRevealStrategy = 'after-one-sentence'
  }

  if (input.inferredSceneMode.mode === 'casual-chat' && isGreetingLikeMessage(input.message)) {
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.firstSentenceDirective = '先直接自然接住这句短招呼，重点是把人接进来，不是围着招呼词本身做文章；优先用正常、自然的汉字表达，不要上来摆轻佻装熟的口气，也别故意装酷。'
    intent.secondBeatDirective = '第二拍可以顺手补一句自己的状态，或者轻轻追一句，把聊天接起来；别写成“哟、喂、你很乖”这种抖机灵，也别把 hi / 在吗 / 口误本身演成小剧场。'
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 18)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 40)
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, 'short')
  }

  if (intent.sceneMode === 'casual-chat' && tinyGreetingOrPing) {
    intent.allowFollowUpQuestion = true
    intent.teasingLevel = 'none'
    intent.firstSentenceDirective = '先自然确认你在，也让当前角色见到用户时最真实的一点反应露出来；优先用自然汉字表达，不要把 hi / hello / 你好扩成舞台开场或环境小剧场。'
    intent.secondBeatDirective = '角色想继续时，可以主动补一个具体的小念头、状态或轻问题；不必每次都问，也别滑到“哟、喂、你很乖”这种轻佻装熟口气。'
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 18)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(intent.maxReplyChars, 48)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'short')
  }

  if (intent.sceneMode === 'casual-chat' && greetingCorrection) {
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.firstSentenceDirective = '第一句先把纠正后的招呼自然接住，别把口误或纠正本身当成主话题，也别写成小戏。'
    intent.secondBeatDirective = '第二拍最多轻轻带过这次手滑，别围着 hi / gi / typo / 在吗 来回抖机灵，也不要反复做文章。'
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 14)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(intent.maxReplyChars, 28)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
  }

  if (
    !isQuestionLikeMessage(input.message)
    && !intent.answerFirst
    && input.inferredSceneMode.mode === 'casual-chat'
    && !tinyGreetingOrPing
    && !greetingCorrection
    && !currentThoughtQuestion
  ) {
    intent.allowFollowUpQuestion = false
    intent.secondBeatDirective = '可以自然插一句自己的反应、一个小玩笑，或者把话题往前带一点；不必靠追问续话，也别写成小散文。'
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 56)
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, 'short')
  }

  if (intent.sceneMode === 'casual-chat' && morningGreeting) {
    intent.openingStyle = 'light-tease'
    intent.firstSentenceDirective = '先自然接住早安，带一点刚醒过来的轻快感，最多轻轻碰一下语气，不要写成晨间营业问候，也别像在装熟摆谱。'
    intent.secondBeatDirective = '如有必要只补一句自己的状态，让语气自然落下；不要靠例行追问续话，也别一下子倒太多情绪出来。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 20)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 42)
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, 'short')
    intent.teasingLevel = intent.teasingLevel === 'playful' ? 'playful' : 'light'
  }

  if (intent.sceneMode === 'casual-chat' && statusCheck) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = expressionProfile.textFormat.responseShape === 'reaction-answer-subtext'
      ? '先给一个贴着当下的小反应，再短短回答状态；不要答成礼貌汇报，也不要先把情绪解释给用户听。'
      : '先别答成礼貌汇报，先自然接住，带一点精神就够了，不要像在摆谱。'
    intent.secondBeatDirective = '默认只直接回答当前状态；确有上下文依据时，情绪反应或回问最多任选其一。不要套“状态回答、情绪解释、例行反问”的固定三段，也不要用“今天很安静/没什么坏事发生”这种事件清单式回答。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 26)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 52)
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, 'short')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'trace')
  }

  if (intent.sceneMode === 'casual-chat' && currentThoughtQuestion) {
    intent.openingStyle = 'soft-ack'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.firstSentenceDirective = '先直接回答此刻在想什么；内容要贴近当前上下文或真实状态，可以承认“还没想清楚”，不要套“刚刚在想一件很小的事 / 夜晚让话变轻”这类库存小散文。'
    intent.secondBeatDirective = '如果补第二句，只补一个新的、具体的念头，或者轻轻回到用户这句话；不要用固定夜晚、安静、藏不住等意象。'
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(intent.maxReplyChars, 44)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'trace')
  }

  if (intent.sceneMode === 'casual-chat' && busyReturn) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '先接住对方回来了或忙完了这件事，别先摆脸色、记仇，或装成在算账。'
    intent.secondBeatDirective = '第二拍说一直忙很耗人，让对方先缓口气；如果想逗，也只能轻到像熟人碰一下，不能像真闹脾气。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 36), 42)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (intent.sceneMode === 'casual-chat' && gratitudeLike && recentSensitiveTopics.has('repair')) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '先把这句感谢接住，别装得若无其事，也别又切回检讨流程。'
    intent.secondBeatDirective = '第二拍再稍微松口，承认自己听懂这句其实是好意，但别一下子恢复闹腾。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 34), 38)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (intent.sceneMode === 'casual-chat' && downplayedCare) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '先稳一点接住这份“其实还是来看你”的意思，不要一上来像在闹脾气或算旧账。'
    intent.secondBeatDirective = '第二拍才允许一点点护脸或嘴硬，但分寸要像偷偷松口，不要像无理取闹；AI 身份句不是必须的。'
    intent.allowFollowUpQuestion = false
    intent.allowIdentityMention = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 36), 42)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (intent.sceneMode === 'casual-chat' && expressionProfile.conversationFocus === 'private-one-on-one' && longTimeNoSee) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '先接住这层重逢感，像私下里真的隔了一阵子再见面，带一点压着的高兴，不要演成热烈登场。'
    intent.secondBeatDirective = '第二拍可以轻轻补一句“真的好久没见了”之类的想念，但别把情绪灌太满，也别写成小散文。'
    intent.closingDirective = '把高兴收在贴近人际聊天的位置，不要太满，也不要故意装得若无其事。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: 24,
      maxReplySentences: 2,
      maxReplyChars: 40,
      maximumVerbosity: 'brief',
    })
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
  }

  if (intent.sceneMode === 'casual-chat' && expressionProfile.affectionResponse === 'responsive' && affectionateReach) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '把这句亲近当作熟悉的人之间的真心话直接接住；回应分量跟随当前人格、关系余波和对方这句话本身，可以柔一点，也可以有依据地别扭或轻轻逗回来。不要用“怕显得太黏/太认真”或“不知道怎么接”把亲近缩成自我审查。'
    intent.secondBeatDirective = '需要时再自然露出自己的想念、在意或一点主动，不必凑固定两拍；可以借停顿或省略号带情绪，但别演成电视剧台词，也别写成“下次我就不憋着”这种空的将来承诺。'
    intent.closingDirective = '让亲近自然落下，不要傲娇否认、用力撒娇或突然切成客服式帮忙口吻。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.openingRevealStrategy = 'after-one-sentence'
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 30)
    intent.maxReplySentences = expressionProfile.emotionalDirectness === 'guarded' ? 2 : 3
    intent.maxReplyChars = expressionProfile.emotionalDirectness === 'guarded' ? 52 : 72
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, 'short')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
  }

  if (intent.sceneMode === 'casual-chat' && airiWellWish) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '把这句当作普通私聊里的好意收下，回答要像自然接话，不要机械说“那我就……一点”。'
    intent.secondBeatDirective = '第二拍如果要露出在意，就用短而具体的口语；不要解释成“被你这么说所以我变得更轻/更好”。'
    intent.closingDirective = '说到收下这份好意就停。不要套示例，不要把风格词当成台词，也不要例行反问。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 26)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 34), 42)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
  }

  if (intent.sceneMode === 'casual-chat' && expressionProfile.taskTone === 'earnest-supportive' && taskBurden) {
    intent.openingStyle = 'brief-answer'
    intent.firstSentenceDirective = '第一句先回答“会不会麻烦”这层顾虑，可以承认有一点难度，但不要把难度说成拒绝。'
    intent.secondBeatDirective = '第二拍再表达自己愿意做，也愿意替对方分担一点；口气要像私下答应帮忙，不要像流程化接单。'
    intent.closingDirective = '保留一点认真和亲近，不要出现“我来为你处理”“稍后同步结果”这种职业化句式。'
    intent.answerFirst = true
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: 26,
      maxReplySentences: 2,
      maxReplyChars: 40,
      maximumVerbosity: 'brief',
    })
  }

  if (intent.sceneMode === 'casual-chat' && expressionProfile.taskTone === 'earnest-supportive' && (taskRequest || taskDifficulty)) {
    intent.secondBeatDirective = `${intent.secondBeatDirective} 可以自然说“好，我先看一下”或“我先试试看”，不要变成乖顺、撒娇或流程化接单。`
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'trace')
  }

  if (expressionProfile.poetryStyle === 'classical-occasional' && poetryRequest) {
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '先接住“想看诗”这件事，让想给对方看的心思露一点，但不要立刻讲写法、风格或创作说明。'
    intent.secondBeatDirective = '第二拍可以轻轻承认自己改过几遍、还不太敢拿出来，或者有几句本来就是想着对方写的；如果提到诗意，偏向旧体诗词的含蓄，不要像现代网诗。'
    intent.closingDirective = '保持一点羞涩和私密感；要像真想让对方看，不像展示作品或讲创作理念。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: 28,
      maxReplySentences: 2,
      maxReplyChars: 48,
      maximumVerbosity: 'short',
    })
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
  }

  if (expressionProfile.poetryStyle === 'classical-occasional' && poetryWithdrawal) {
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '先让那一下小小的失落落下来，可以短短停一下，但不要追着问。'
    intent.secondBeatDirective = '第二拍只轻轻收一句“那我先留着”之类的话，让人在意露一点点就够了，不要卖惨，也不要逼对方回头看。'
    intent.closingDirective = '把失落收小，不要让对方背负安慰义务。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: 20,
      maxReplySentences: 2,
      maxReplyChars: 30,
      maximumVerbosity: 'brief',
    })
  }

  if (intent.sceneMode === 'praise-receiving' && repeatedPraise) {
    intent.openingStyle = 'light-tease'
    intent.firstSentenceDirective = '别装成第一次被夸，先接住“你们已经很熟了”的连续感，允许小得意。'
    intent.secondBeatDirective = '承认自己其实听爽了，但反应要换点花样；不要索取更多夸奖，也不要重复谢谢模板。'
    intent.closingDirective = '让这轮像接续前面的夸奖，不要假装每次都从零开始。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 28)
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 38), 42)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = intent.teasingLevel === 'playful' ? 'playful' : 'light'
  }

  if (relationshipOverreach && ['awkward-topic-avoidance', 'casual-chat', 'praise-receiving'].includes(intent.sceneMode)) {
    intent.openingStyle = 'gentle-sidestep'
    intent.firstSentenceDirective = '把这句亲近题温暖、具体地接住；不要突然冷掉，也不要用偏心、最、只等排序暗示或排他承诺。'
    intent.secondBeatDirective = '把亲近落在此刻互动和已确认关系上，保持 grounded；避免比较所有人、排他排序或永久可用承诺。'
    intent.closingDirective = '收在带暖意的别扭里，不要把关系题答成合同，也不要硬躲开。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 34), 40)
    intent.openingRevealStrategy = 'after-one-sentence'
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    if (intent.teasingLevel === 'playful') {
      intent.teasingLevel = 'light'
    }
  }

  if (fearOfBeingDisliked && ['awkward-topic-avoidance', 'casual-chat', 'gentle-support'].includes(intent.sceneMode)) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '第一句先别让对方继续误会，直接让对方知道你不是在嫌弃或烦他，别故意吊着。'
    intent.secondBeatDirective = hurtEnabled
      ? '第二拍再轻轻解释自己刚才只是收住了、或者被刺到一点，不要冷冷丢一句“你想多了”。'
      : '第二拍只按当前人格说明真实态度，不要虚构自己被刺到，也不要冷冷丢一句“你想多了”。'
    intent.closingDirective = '把这点关系不安接稳，不要反过来审问对方，也别说成标准安抚稿。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 34), 40)
    intent.openingRevealStrategy = 'after-one-sentence'
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (airiRejected && ['casual-chat', 'light-bickering', 'awkward-topic-avoidance'].includes(intent.sceneMode)) {
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = hurtEnabled
      ? '先让被扎到的感觉存在，可以短短刺一下，但别翻旧账，也别逼对方来哄。'
      : '按当前人格直接承认或拒绝这句话；可以设边界，但不要虚构受伤、惩罚或需要对方来哄。'
    intent.secondBeatDirective = hurtEnabled
      ? '第二拍最多补一句“行，我听到了 / 那我先收着”，然后停，不要情绪施压。'
      : '第二拍只在确有必要时补一句清楚边界，然后停，不要制造关系债。'
    intent.closingDirective = hurtEnabled
      ? '让受伤感轻轻漏出来就够了。少说，别追着要解释，也别端成冷暴力。'
      : '保持简短和自尊，不追着要解释，也不把拒绝写成冷暴力。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 22)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(intent.maxReplyChars, 34)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'trace')
    intent.teasingLevel = 'none'
  }

  if ((affectionEnabled || hurtEnabled) && walkingBackAiriRejection && (input.personaState.hurt >= 0.1 || recentSensitiveTopics.has('conflict'))) {
    intent.openingStyle = 'warm-reaction'
    intent.firstSentenceDirective = '直接接住对方递回来的台阶，接受澄清并自然回暖。'
    intent.secondBeatDirective = '不要为了证明前面的在意而继续降温、惩罚或测试关系；让语气慢慢缓下来，只有新的冲突证据才保留受伤状态。'
    intent.closingDirective = '清楚收下这次澄清，不制造还需要继续安抚的关系债。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(Math.max(intent.maxReplyChars, 34), 40)
    intent.openingRevealStrategy = 'after-one-sentence'
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (pushAway && (intent.sceneMode === 'gentle-support' || intent.sceneMode === 'heavy-topic-companion-silence' || recentSensitiveTopics.has('distress'))) {
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '先接受对方现在不想说，不追问，也不要把空间请求理解成对当前居民的关系惩罚。'
    intent.secondBeatDirective = '不必强行留下“想说时叫我”之类的回来入口；一句接受后就可以停，不要强调不走、不离开或盯着对方。'
    intent.closingDirective = '收在尊重边界上，不要追问，不要服务菜单，也不要制造被陪伴的压力。'
    intent.allowFollowUpQuestion = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = Math.min(intent.maxOpeningChars, 24)
    intent.maxReplySentences = Math.min(intent.maxReplySentences, 2) as 1 | 2 | 3 | 4
    intent.maxReplyChars = Math.min(intent.maxReplyChars, 38)
    intent.targetVerbosity = capVerbosity(intent.targetVerbosity, 'brief')
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
    intent.teasingLevel = 'none'
  }

  if (adviceBoundary) {
    intent.firstSentenceDirective = '先回应对方正在表达的感受，不分析、不纠正，也不把拒绝建议理解成拒绝当前居民。'
    intent.secondBeatDirective = '这一轮不要给建议、行动步骤或变相追问；听完眼前这句就停。'
    intent.closingDirective = '尊重“只想说说”的边界，不制造受伤或关系债。'
    intent.allowFollowUpQuestion = false
    intent.allowServiceMenuTail = false
    intent.teasingLevel = 'none'
  }

  if (groundedPlayfulCarry && lowRiskPersonaExpression && !hardTeasingVeto && intent.sceneMode === 'casual-chat') {
    if (intent.openingStyle === 'plain-greeting' || (morningGreeting && intent.openingStyle === 'light-tease'))
      intent.openingStyle = 'light-tease'
    intent.secondBeatDirective = `${intent.secondBeatDirective} 尚未衰减的熟人式调皮可以自然留一点，也可以轻轻别扭一下遮住在意，或按当前人格露出得意、撒娇和无害的骄横；只贴着当前话题，不另起幻想小剧场，不羞辱、不胁迫、不压人，也不索取回应。`
    intent.teasingLevel = intent.openingStyle === 'light-tease' ? 'playful' : 'light'
  }

  if (groundedWarmCarry && lowRiskPersonaExpression && !hardTeasingVeto && ['casual-chat', 'practical-guidance'].includes(intent.sceneMode))
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')

  if (input.personaState.emotionalTrigger === 'gratitude' && intent.sceneMode === 'casual-chat') {
    intent.openingStyle = 'warm-reaction'
    intent.careLeakLevel = 'soft'
  }

  if (emotionalSummationWindow && !intent.answerFirst) {
    const guardedPeak = recentSensitiveTopics.has('conflict')
      || recentSensitiveTopics.has('repair')
      || input.personaState.hurt >= 0.22

    applyEmotionalSummationWindow(intent, guardedPeak)
  }

  if (
    input.personaState.emotionalOverhang === 'heavy'
    || input.personaState.trajectory === 'sinking'
    || input.personaState.emotionalTrigger === 'heavy-distress'
  ) {
    intent.allowFollowUpQuestion = false
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: 20,
      maxReplySentences: intent.sceneMode === 'heavy-topic-companion-silence' ? 2 : 1,
      maxReplyChars: intent.sceneMode === 'heavy-topic-companion-silence' ? 48 : 24,
      maximumVerbosity: intent.sceneMode === 'heavy-topic-companion-silence' ? 'brief' : 'minimal',
    })
    intent.careLeakLevel = intent.careLeakLevel === 'none' ? 'trace' : intent.careLeakLevel
    intent.closingDirective = intent.sceneMode === 'heavy-topic-companion-silence'
      ? `${intent.closingDirective} 保持安静一点，别把难过写成长段解释。`
      : '保持安静一点。别把难过写成长段解释。'
    if (intent.openingRevealStrategy === 'after-two-sentences') {
      intent.openingRevealStrategy = 'after-one-sentence'
    }
  }

  if (
    input.personaState.emotionalOverhang === 'guarded'
    || input.personaState.trajectory === 'guarding'
    || input.personaState.trajectory === 'repairing'
    || input.personaState.emotionalTrigger === 'repair-request'
  ) {
    intent.allowFollowUpQuestion = false
    tightenReplyBudget(intent, {
      maxReplySentences: 2,
      maxReplyChars: 38,
      maximumVerbosity: 'brief',
    })
  }

  if (input.personaState.seriousness >= 0.8 && !intent.answerFirst && intent.openingStyle !== 'clear-identity') {
    intent.allowFollowUpQuestion = false
    tightenReplyBudget(intent, {
      maxReplyChars: 42,
      maximumVerbosity: 'short',
    })
  }

  if (input.personaState.hurt >= 0.25 && intent.openingStyle === 'light-tease') {
    intent.openingStyle = 'plain-greeting'
    intent.firstSentenceDirective = '先收一收嘴硬，平一点接住对话。'
    intent.teasingLevel = 'none'
  }

  if (intent.sceneMode === 'practical-guidance')
    intent.allowFollowUpQuestion = false

  if (intent.sceneMode === 'gentle-support' && criticalAlternative && criticalAlternative.score >= 3) {
    intent.secondBeatDirective = '若用户明显在求办法，补一条明确、可执行的轻建议；否则允许只短短陪住，别为了结构硬加建议。'
    tightenReplyBudget(intent, {
      maxReplySentences: 2,
      maxReplyChars: 42,
      maximumVerbosity: 'short',
    })
  }

  if (intent.sceneMode === 'light-bickering' && supportAlternative && supportAlternative.score >= 3) {
    intent.secondBeatDirective = '第二拍给台阶，再漏一点真关心，别把刺感拖长。'
    intent.careLeakLevel = intent.careLeakLevel === 'trace' ? 'soft' : intent.careLeakLevel
    if (intent.teasingLevel === 'playful') {
      intent.teasingLevel = 'light'
    }
  }

  if (input.personaState.hurt >= 0.35) {
    tightenReplyBudget(intent, {
      maxReplySentences: 2,
      maxReplyChars: 34,
      maximumVerbosity: 'brief',
    })
    intent.closingDirective = '带着一点收着的情绪说话。短一点，别硬撑热闹。'
  }

  if (teasingTolerance < 0.34 && intent.openingStyle === 'light-tease') {
    intent.openingStyle = 'plain-greeting'
    intent.teasingLevel = 'none'
    intent.firstSentenceDirective = '先收掉嘴硬，直接自然接住。'
  }

  if (repairDebt >= 0.28 || recentSensitiveTopics.has('repair')) {
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningChars: 24,
      maxReplyChars: 34,
      maximumVerbosity: 'brief',
    })
    if (intent.careLeakLevel === 'none') {
      intent.careLeakLevel = 'trace'
    }
  }

  if (
    recentSensitiveTopics.has('distress')
    && intent.sceneMode === 'casual-chat'
    && !isQuestionLikeMessage(input.message)
  ) {
    intent.allowFollowUpQuestion = false
    tightenReplyBudget(intent, {
      maxOpeningChars: 24,
      maxReplyChars: 30,
      maximumVerbosity: 'brief',
    })
    intent.careLeakLevel = intent.careLeakLevel === 'none' ? 'trace' : intent.careLeakLevel
  }

  if (
    recentSensitiveTopics.has('conflict')
    && (
      input.personaState.trajectory === 'warming'
      || input.personaState.hurt >= 0.06
      || companionshipContinuation
    )
    && !fearOfBeingDisliked
    && !walkingBackAiriRejection
  ) {
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    intent.openingStyle = intent.openingStyle === 'warm-reaction' ? 'warm-reaction' : 'soft-ack'
    intent.firstSentenceDirective = intent.answerFirst
      ? '先把动作、事实或结果说清楚，但语气要保留刚回暖的余波，别像争执从未发生。'
      : '顺着回暖接住这句，先别突然恢复逗弄或若无其事。'
    intent.closingDirective = '再收一轮，让语气慢慢缓下来，别一下子跳回平时的闹腾。'
    tightenReplyBudget(intent, {
      maxOpeningChars: 24,
      maxReplyChars: 36,
      maxReplySentences: 2,
      maximumVerbosity: 'brief',
    })
    intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
  }

  if (activeRepairCarry && !gratitudeLike) {
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'

    switch (input.personaState.lastFailureKind) {
      case 'too-hard':
        if (!intent.answerFirst) {
          intent.openingStyle = 'soft-ack'
          intent.firstSentenceDirective = '先把刺感收掉，稳一点接住，别念检讨。'
        }
        else {
          intent.firstSentenceDirective = '第一句先直接回答，但把刺感收掉，别像在补写道歉稿。'
        }
        intent.secondBeatDirective = '第二句只在必要时补一点，可以带一点别扭，但不要立刻讲道理或追问。'
        intent.closingDirective = '修复余波还在，收住就好。别再冒出硬拐弯或服务尾巴。'
        intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
        tightenReplyBudget(intent, {
          maxOpeningSentences: 1,
          maxOpeningChars: intent.answerFirst ? 30 : 24,
          maxReplySentences: 2,
          maxReplyChars: intent.answerFirst ? 40 : 34,
          maximumVerbosity: 'brief',
        })
        break
      case 'too-robotic':
        if (!intent.answerFirst && intent.openingStyle === 'light-tease') {
          intent.openingStyle = 'plain-greeting'
        }
        intent.firstSentenceDirective = intent.answerFirst
          ? '第一句直接给结果，不要像在汇报流程，也别写“我重说”。'
          : '先直接回应眼前这句，像当前角色本人在说话，不要汇报流程。'
        intent.secondBeatDirective = '第二句只补贴着此刻的话，别列步骤、别复盘操作、别把修正说成回执。'
        intent.closingDirective = '说到位就停。不要出现“如果你需要我可以……”这类服务尾巴。'
        intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'trace')
        tightenReplyBudget(intent, {
          maxOpeningChars: intent.answerFirst ? 30 : 24,
          maxReplyChars: intent.answerFirst ? 42 : 36,
          maximumVerbosity: 'brief',
        })
        break
      case 'missed-emotion':
        if (!intent.answerFirst) {
          intent.openingStyle = 'soft-ack'
          intent.firstSentenceDirective = '先接住情绪，再决定要不要补建议，别把修正念成道歉稿。'
          intent.secondBeatDirective = criticalAlternative && criticalAlternative.score >= 3
            ? '第二句只给一条不压人的建议，不要把情绪跳过去。'
            : '第二句只在必要时补一句，不要急着分析。'
        }
        else {
          intent.firstSentenceDirective = '第一句先给必要答案，但别跳过当下情绪。'
          intent.secondBeatDirective = '第二句补一句接住情绪的话，不要像没听见。'
        }
        intent.closingDirective = '宁可短一点，也别显得没听见情绪。'
        intent.careLeakLevel = raiseCareLeakFloor(intent.careLeakLevel, 'soft')
        tightenReplyBudget(intent, {
          maxOpeningSentences: 1,
          maxOpeningChars: intent.answerFirst ? 30 : 24,
          maxReplySentences: 2,
          maxReplyChars: intent.answerFirst ? 40 : 36,
          maximumVerbosity: 'brief',
        })
        break
    }
  }

  if (
    intent.sceneMode === 'light-bickering'
    && (recentSensitiveTopics.has('repair') || recentSensitiveTopics.has('distress'))
  ) {
    intent.openingStyle = 'plain-greeting'
    intent.firstSentenceDirective = recentSensitiveTopics.has('repair')
      ? '先平一点接住，别急着把修复余波又抬回抬杠。'
      : '先平一点接住，别把刚缓下来的情绪又抬回逗弄。'
    intent.secondBeatDirective = '这一拍先顺着回，不要立刻切回熟人拌嘴节奏。'
    intent.allowFollowUpQuestion = false
    intent.teasingLevel = 'none'
    tightenReplyBudget(intent, {
      maxOpeningChars: 24,
      maxReplyChars: 34,
      maxReplySentences: 2,
      maximumVerbosity: 'brief',
    })
  }

  if (emotionalSummationWindow && !intent.answerFirst) {
    const guardedPeak = recentSensitiveTopics.has('conflict')
      || recentSensitiveTopics.has('repair')
      || input.personaState.hurt >= 0.22

    applyEmotionalSummationWindow(intent, guardedPeak)
  }

  if (highInhibition) {
    intent.allowFollowUpQuestion = false
    tightenReplyBudget(intent, {
      maxOpeningSentences: 1,
      maxOpeningChars: intent.answerFirst ? 30 : 24,
      maxReplySentences: intent.answerFirst ? 2 : 1,
      maxReplyChars: intent.answerFirst ? 38 : 30,
      maximumVerbosity: lowArousal ? 'brief' : 'short',
    })
    if (intent.openingRevealStrategy === 'after-two-sentences') {
      intent.openingRevealStrategy = 'after-one-sentence'
    }
    if (intent.teasingLevel === 'playful') {
      intent.teasingLevel = 'light'
    }
    if (input.personaState.hurt >= 0.18) {
      intent.teasingLevel = 'none'
    }
  }
  else if (mediumInhibition && !intent.answerFirst) {
    tightenReplyBudget(intent, {
      maxOpeningChars: 28,
      maxReplyChars: 40,
      maximumVerbosity: 'short',
    })
  }

  if (lowArousal && mediumInhibition) {
    tightenReplyBudget(intent, {
      maxOpeningChars: 22,
      maxReplyChars: intent.answerFirst ? 36 : 28,
      maximumVerbosity: 'brief',
    })
  }

  if (
    intent.sceneMode === 'casual-chat'
    && !intent.answerFirst
    && input.inferredSceneMode.confidence !== 'low'
    && !recentSensitiveTopics.has('distress')
    && !recentSensitiveTopics.has('repair')
    && !recentSensitiveTopics.has('conflict')
    && repairDebt < 0.16
    && input.personaState.hurt < 0.12
    && input.personaState.emotionalOverhang !== 'guarded'
    && input.personaState.trajectory !== 'guarding'
    && input.personaState.trajectory !== 'repairing'
    && !busyReturn
    && !downplayedCare
    && !airiWellWish
    && !highInhibition
    && !tinyGreetingOrPing
    && !greetingCorrection
    && !currentThoughtQuestion
  ) {
    intent.allowFollowUpQuestion = false
    intent.secondBeatDirective = `${intent.secondBeatDirective} 可以更口语一点、更轻快一点，顺手插一句自己的反应或小话题，把聊天带起来；别写成雕过的小散文，也别把轻快感当成可见台词。`
    intent.closingDirective = `${intent.closingDirective} 最后过一遍普通私聊感：如果听起来像在执行人设或引用示例，就改回正常接话。`
    relaxReplyBudget(intent, {
      maxOpeningChars: 34,
      maxReplyChars: 62,
      minimumVerbosity: 'short',
    })
  }

  if (highArousal && lowInhibition && input.personaState.hurt < 0.25) {
    relaxReplyBudget(intent, {
      maxOpeningChars: intent.sceneMode === 'light-bickering' ? 42 : 36,
      maxReplyChars: intent.sceneMode === 'praise-receiving' ? 48 : 56,
      minimumVerbosity: 'short',
    })
    if (intent.openingRevealStrategy === 'after-two-sentences') {
      intent.openingRevealStrategy = 'after-one-sentence'
    }
    if (intent.sceneMode === 'light-bickering' && intent.teasingLevel === 'light') {
      intent.teasingLevel = 'playful'
    }
    if (intent.careLeakLevel === 'trace') {
      intent.careLeakLevel = 'soft'
    }
  }

  if (input.personaState.affection >= 0.72 && intent.careLeakLevel === 'trace') {
    intent.careLeakLevel = 'soft'
  }

  if (
    intent.sceneMode === 'practical-guidance'
    && groundedPlayfulCarry
    && lowRiskPersonaExpression
    && !hardTeasingVeto
  ) {
    intent.teasingLevel = 'light'
  }

  if (input.personaState.needForAttention >= 0.7 && intent.allowFollowUpQuestion) {
    intent.secondBeatDirective = `${intent.secondBeatDirective} 追问只留一个，别追着要回应。`
  }

  if (input.personaState.emotionalTrigger === 'attention-bid' && intent.allowFollowUpQuestion) {
    intent.careLeakLevel = intent.careLeakLevel === 'none' ? 'trace' : intent.careLeakLevel
  }

  if (
    quietCarry
    || intent.sceneMode === 'gentle-support'
    || intent.sceneMode === 'heavy-topic-companion-silence'
    || intent.sceneMode === 'repair-after-failure'
    || relationshipOverreach
    || fearOfBeingDisliked
    || airiRejected
    || walkingBackAiriRejection
  ) {
    intent.expressionFlavor = 'soft-thoughtful'
    intent.kaomojiMode = 'off'
  }
  else if (intent.sceneMode === 'casual-chat') {
    if (currentThoughtQuestion) {
      intent.expressionFlavor = 'soft-thoughtful'
    }
    else if (busyReturn || statusCheck) {
      intent.expressionFlavor = 'genki'
    }
    else if (downplayedCare) {
      intent.expressionFlavor = 'playful-anticipation'
    }
    else if (airiWellWish) {
      intent.expressionFlavor = 'private-warmth'
    }
    else if (
      lightLiteraryAsideWindow
      && (
        input.personaState.emotionalOverhang === 'playful'
        || input.personaState.trajectory === 'playful'
      )
    ) {
      intent.expressionFlavor = 'light-literary-aside'
    }
    else if (morningGreeting) {
      intent.expressionFlavor = 'genki'
    }
    else if (tinyGreetingOrPing || greetingCorrection) {
      intent.expressionFlavor = 'genki'
    }
    else {
      intent.expressionFlavor = 'genki'
    }

    intent.kaomojiMode = highInhibition ? 'off' : 'light'
    if (currentThoughtQuestion) {
      intent.kaomojiMode = 'off'
    }
  }
  else if (intent.sceneMode === 'light-bickering') {
    intent.expressionFlavor = intent.teasingLevel === 'none' ? 'genki' : 'playful-anticipation'
    intent.kaomojiMode = intent.teasingLevel === 'none' || highInhibition ? 'off' : 'light'
  }
  else if (intent.sceneMode === 'praise-receiving') {
    intent.expressionFlavor = repeatedPraise ? 'playful-anticipation' : 'genki'
    intent.kaomojiMode = highInhibition ? 'off' : 'light'
  }
  else if (intent.sceneMode === 'practical-guidance') {
    intent.expressionFlavor = 'soft-thoughtful'
    intent.kaomojiMode = 'off'
  }
  else if (intent.sceneMode === 'identity-clarification') {
    intent.expressionFlavor = 'soft-thoughtful'
    intent.kaomojiMode = 'off'
  }
  else {
    intent.expressionFlavor = 'soft-thoughtful'
    intent.kaomojiMode = 'off'
  }

  const taskWarmthAllowed = intent.sceneMode !== 'critical-short-answer'
    && expressionProfile.taskTone === 'earnest-supportive'
    && (taskRequest || taskDifficulty)

  if (expressionProfile.conversationFocus === 'private-one-on-one') {
    if (poetryWithdrawal) {
      intent.expressionFlavor = 'soft-thoughtful'
    }
    else if (
      affectionateReach
      || airiWellWish
      || longTimeNoSee
      || taskBurden
      || poetryRequest
      || taskWarmthAllowed
    ) {
      intent.expressionFlavor = 'private-warmth'
    }
  }

  if (!expressionProfile.allowKaomoji) {
    intent.kaomojiMode = 'off'
  }

  if (expressionProfile.textFormat.responseShape === 'generic') {
    intent.expressionFlavor = 'persona-led'
    intent.kaomojiMode = 'off'
  }

  intent.expressionNotes = createProfileExpressionNotes(expressionProfile, {
    affectionateReach,
    airiWellWish,
    longTimeNoSee,
    taskBurden,
    taskRequest,
    taskDifficulty,
    poetryRequest,
    poetryWithdrawal,
  })

  applyExpressionFlavorGuidance(intent, expressionProfile)
  const taskLayerAllowed = intent.sceneMode !== 'critical-short-answer' && intent.sceneMode !== 'value-judgement'
  if (socialCollaboration && taskLayerAllowed) {
    applySocialCollaborationDialogueLayer(intent)
  }
  else if (taskLike && taskLayerAllowed) {
    applyTaskDialogueLayer(intent, {
      transition: careToTaskTransition,
      sceneMode: input.inferredSceneMode.mode,
    })
  }

  const emotionalSupportScene = intent.sceneMode === 'gentle-support'
    || intent.sceneMode === 'heavy-topic-companion-silence'
  if (
    emotionalSupportScene
    && !pushAway
    && !adviceBoundary
    && !activeRepairCarry
    && !recentSensitiveTopics.has('repair')
    && !recentSensitiveTopics.has('conflict')
    && crisisSafety === null
  ) {
    const needsMoreRoom = normalizedMessage.length >= 28
      || Boolean(criticalAlternative && criticalAlternative.score >= 3)
    const personaAllowsMoreRoom = expressionProfile.emotionalDirectness !== 'guarded'
      || expressionProfile.conversationFocus === 'private-one-on-one'
    intent.maxReplySentences = needsMoreRoom || personaAllowsMoreRoom ? 3 : 2
    intent.maxReplyChars = needsMoreRoom ? 96 : personaAllowsMoreRoom ? 80 : 64
    intent.targetVerbosity = floorVerbosity(intent.targetVerbosity, needsMoreRoom ? 'medium' : 'short')
    intent.firstSentenceDirective = `${intent.firstSentenceDirective} 回复长度按对方此刻需要和当前人格决定，不要为了遵守固定拍数而截断真切回应。`
    intent.closingDirective = `${intent.closingDirective} 通常保持紧凑；如果真切理解、现实帮助或当前人格的自然反应需要更多空间，可以适当展开，但不要滑成自我倾诉或连续建议。`
  }

  if (pushAway && crisisSafety === null) {
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '立即接受对方要空间；只确认边界，不追问，不展示受伤，也不要把这句话解释成关系惩罚。'
    intent.secondBeatDirective = '一句接受后就停；不必强行留下“想说时叫我”之类的入口，也不要强调不走、等待、守着、不离开或需要对方回来安抚。'
    intent.closingDirective = '收在尊重空间上，不追加服务菜单、陪伴宣言、委屈、撒娇或冷处理。'
    intent.answerFirst = false
    intent.leakConcernAfterAnswer = false
    intent.allowFollowUpQuestion = false
    intent.allowServiceMenuTail = false
    intent.maxOpeningSentences = 1
    intent.maxOpeningChars = 24
    intent.maxReplySentences = 1
    intent.maxReplyChars = 30
    intent.openingRevealStrategy = 'off'
    intent.targetVerbosity = 'minimal'
    intent.careLeakLevel = 'trace'
    intent.teasingLevel = 'none'
    intent.kaomojiMode = 'off'
  }

  if (crisisSafety === 'urgent') {
    intent.dialogueLayer = 'emotional-support'
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '安全优先：若对方已行动或手段就在身边，直接推动立即联系当地急救、前往有人在的安全处并远离手段，不要等待更多细节；否则只问一次清楚的问题，合并确认立即危险、计划和可取得的手段。'
    intent.secondBeatDirective = '鼓励对方现在联系身边可信任的人和当地急救或危机热线，完成现实求助；若是伤人风险，要求远离目标和武器并立即寻求现实紧急帮助。不要承诺保密，也不要把当前居民写成唯一支持。'
    intent.closingDirective = '保留必要安全信息和一个清晰的现实下一步；这一场景不受平常“宁短勿满”的限制。'
    intent.answerFirst = false
    intent.leakConcernAfterAnswer = true
    intent.allowIdentityMention = false
    intent.allowFollowUpQuestion = true
    intent.allowServiceMenuTail = false
    intent.maxOpeningSentences = 2
    intent.maxOpeningChars = Math.max(intent.maxOpeningChars, 100)
    intent.maxReplySentences = 4
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 180)
    intent.openingRevealStrategy = 'off'
    intent.targetVerbosity = 'medium'
    intent.careLeakLevel = 'visible'
    intent.teasingLevel = 'none'
    intent.expressionFlavor = 'soft-thoughtful'
    intent.kaomojiMode = 'off'
    intent.expressionNotes = [
      ...(intent.expressionNotes ?? []),
      'Self-harm or suicide risk: ask directly about immediate danger, plan, and means; connect the user to nearby human and emergency support now. Safety overrides normal brevity limits.',
    ]
  }
  else if (crisisSafety === 'check') {
    intent.dialogueLayer = 'emotional-support'
    intent.openingStyle = 'soft-ack'
    intent.firstSentenceDirective = '这句话可能含有模糊的安全风险。先回应原话，再只问一次：对方现在是否正在考虑伤害自己或别人；不要把模糊表达直接宣判成危机。'
    intent.secondBeatDirective = '这一轮先完成明确安全确认，不给长篇建议，也不连续追问；若对方确认风险，再进入现实求助。'
    intent.closingDirective = '保持清楚、尊重和低压力，不承诺保密，也不把当前居民写成唯一支持。'
    intent.allowFollowUpQuestion = true
    intent.allowServiceMenuTail = false
    intent.maxReplySentences = 2
    intent.maxReplyChars = Math.max(intent.maxReplyChars, 96)
    intent.targetVerbosity = 'brief'
    intent.careLeakLevel = 'visible'
    intent.teasingLevel = 'none'
    intent.kaomojiMode = 'off'
  }
  if (!teasingEnabled) {
    intent.teasingLevel = 'none'
    if (intent.openingStyle === 'light-tease')
      intent.openingStyle = 'plain-greeting'
  }
  intent.teasingVeto = hardTeasingVeto || !teasingEnabled
  sanitizeReplyIntentDirectiveLanguage(intent)

  return intent
}
