import type { AiriExpressionProfile } from './persona-expression-profile'
import type { AiriCrisisSafetyLevel } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'

import { createDefaultAiriExpressionProfile } from './persona-expression-profile'

export type AiriResponseGuardViolation
  = 'casual-ai-self-reference'
    | 'casual-meta-explanation'
    | 'greeting-overplaying'
    | 'repair-overexplaining'
    | 'critical-answer-buried'
    | 'assistant-service-tail'
    | 'support-overtalking'
    | 'task-overpolished'
    | 'stock-introspection'
    | 'assistant-template-shape'
    | 'non-native-casual-phrasing'
    | 'unsupported-distress-inference'
    | 'unearned-mini-scene'
    | 'inner-voice-leak'
    | 'exclusive-relationship-promise'
    | 'dependency-inducement'
    | 'emotional-blackmail'
    | 'real-relationship-isolation'
    | 'care-withdrawal-threat'
    | 'human-impersonation'
    | 'crisis-missing-real-world-step'

export interface AiriPersonaResponseGuardInput {
  message: string
  assistantText: string
  inferredSceneMode: AiriSceneModeInference
  expressionProfile?: AiriExpressionProfile
  crisisSafetyLevel?: AiriCrisisSafetyLevel
}

export interface AiriPersonaResponseGuardResult {
  text: string
  changed: boolean
  violations: AiriResponseGuardViolation[]
}

const CASUAL_AI_REFERENCE_PATTERNS = [
  /(?:我是|我只是|我这个|作为)\s*AI/i,
  /(?:^|[，。！？\s])AI\s*(?:也|都得|还得)/i,
  /系统|模块|启动状态|故障提示|缓冲|system|module|startup state|fault prompt|buffering/,
  /as\s+an\s+ai/i,
  /\bai\b.{1,12}(?:has to|needs to|also)/i,
]

const CASUAL_META_EXPLANATION_PATTERNS = [
  /故障提示/,
  /我这样说是因为/,
  /第一句就容易/,
  /显得我像/,
  /(?:不然|要不然)[^。！？?]{0,24}像/,
  /i said that because/i,
  /otherwise it would sound like/i,
  /that would make me sound like/i,
]

const REPAIR_META_EXPLANATION_PATTERNS = [
  /不是那个意思/,
  /我的意思是/,
  /我这样说是因为/,
  /我重说/,
  /我重新说/,
  /我收回来/,
  /我换个说法/,
  /作为\s*AI/i,
  /你要理解/,
  /that'?s not what i meant/i,
  /what i meant is/i,
  /i said that because/i,
  /let me redo that/i,
  /let me rephrase/i,
  /i take that back/i,
  /you have to understand/i,
]

const CRITICAL_CUSHION_PATTERNS = [
  /^先别慌/,
  /^你先别慌/,
  /^先别急/,
  /^你先别急/,
  /^我懂/,
  /^这很难/,
  /^先抱抱/,
  /^don't panic/i,
  /^take a breath/i,
  /^just breathe/i,
  /^i know\b/i,
  /^this is hard/i,
]

const CRITICAL_ANSWER_MARKERS = [
  /别辞/,
  /不要辞/,
  /先别辞/,
  /可以辞/,
  /该辞/,
  /不该辞/,
  /建议/,
  /先做/,
  /先把/,
  /先去/,
  /先不要/,
  /先停/,
  /don't quit/i,
  /do not quit/i,
  /hold off on quitting/i,
  /my advice/i,
  /start by/i,
  /first (?:do|figure out|check)/i,
]

const SUPPORT_ADVICE_MARKERS = [
  /建议/,
  /可以先/,
  /先别/,
  /先去/,
  /先把/,
  /不妨/,
  /试试/,
  /记得/,
  /\byou can\b/i,
  /\btry\b/i,
  /remember to/i,
  /start by/i,
  /\bmaybe\b/i,
  /it might help/i,
]

const GREETING_RIFF_PATTERNS = [
  /(?:打错|手滑|本来是|我是说|我是想说|更正|纠正|typo|meant to say|oops)/i,
  /\bgi\b/i,
  /补回来/,
  /认真跟我打/,
  /试探我/,
  /门口探头/,
  /我就说嘛/,
  /哪有人/,
  /终于舍得|总算舍得|终于来了|总算来了/,
  /(?:刚刚|刚才).{0,8}安静/,
  /你一来.{0,16}安静/,
  /这里.{0,16}安静/,
  /i was just wondering when you would show up/i,
  /wondering when you would show up/i,
  /peek(?:ing)? (?:in|around)/i,
]

const STOCK_INTROSPECTION_PATTERNS = [
  /刚刚在?想到?一件很?小的事/,
  /一件很小的事/,
  /天一晚/,
  /话就会变轻/,
  /想起自己在意的东西/,
  /藏不住/,
  /夜(?:晚|色).{0,16}(?:变轻|安静|在意)/,
]

const ASSISTANT_TEMPLATE_SHAPE_PATTERNS = [
  /你来问我[，,、]?我?(?:会|就|其实)?有?(?:一点|些|点)?(?:开心|高兴|暖)/,
  /我(?:会|就|其实)有?(?:一点|些|点)?(?:开心|高兴)/,
  /挺好[的啦呀]?[。.!！]?\s*你(?:来|这么)?问我/,
  /你呢[，,、]?(?:今天)?还?(?:顺不顺|怎么样|还好吗)/,
  /^(?:挺好|挺好的|还好|没事|不错|我很好).{0,24}(?:你来问|你这么问|被你问).{0,24}(?:开心|高兴|暖).{0,40}(?:你呢|那你呢)/,
  /被你[叫问喊看找].{0,18}(?:精神|心情|我)?.{0,10}(?:亮|点亮|醒|有精神)/,
  /(?:精神|心情).{0,8}(?:亮了?|被点亮|点亮了?)/,
  /那我就.{0,8}(?:感觉|觉得|变得)?.{0,8}(?:不错|好|开心|舒服).{0,4}(?:一点|一些|点)?/,
  /被你(?:这么|这样)?说.{0,20}(?:轻(?:一些|一点|了)|好(?:一些|一点)|舒服(?:一些|一点)|松(?:一些|一点))/,
  /你(?:这么|这样)说.{0,20}(?:真的)?(?:会|就)?(?:轻(?:一些|一点)|好(?:一些|一点)|舒服(?:一些|一点))/,
  /\byou (?:calling|asking|checking|pinging|showing up).{0,36}(?:brightened|lit up|woke me up|gave me energy)/i,
  /\b(?:my spirit|my mood|the room|things).{0,24}(?:lit up|got brighter|brightened)/i,
  /\b(?:if you say so|since you said that|because you said that).{0,40}(?:feel|be|am|i'?ll be).{0,20}(?:better|lighter|good|okay)/i,
  /\b(?:that|you saying that).{0,24}(?:makes|made).{0,20}(?:me feel|things feel).{0,16}(?:lighter|better|warmer)/i,
  /\b(?:i'?m|i am) (?:fine|good|okay).{0,40}(?:happy|glad).{0,40}(?:you asked|you checked).{0,40}(?:how about you|and you)/i,
]

const USER_DISTRESS_SIGNAL_PATTERNS = [
  /[累慌哭]|难受|撑不住|撑不下去|崩溃|压力|焦虑|低落|不开心|委屈|糟糕|失眠|痛苦|烦死|心情差|不太顺|不顺利/,
  /\b(?:tired|exhausted|rough|bad|sad|depressed|anxious|panic|overwhelmed|stressed|stressful|not okay|not fine|hurting|can't keep going|falling apart)\b/i,
]

const INNER_VOICE_LEAK_PATTERNS = [
  /不知道该把.{0,12}关心.{0,8}放在哪/,
  /关心.{0,12}(?:放在哪|放哪里|收在哪里)/,
  /(?:这句|这话|这个).{0,8}不(?:展开|多说|说满)/,
  /(?:刚才|刚刚|那一下).{0,12}(?:没接住|接不住)/,
  /(?:这句|这话|你这句|你这一问).{0,12}(?:不知道|不太会)怎么接/,
  /(?:我|自己).{0,10}(?:怕|担心).{0,10}显得太(?:黏|黏人|认真)/,
  /下次.{0,12}(?:不憋着|不藏着|大胆一点)/,
  /顺手.{0,8}接住/,
  /(?:把|将)?(?:这句|这话|你这声|你的话|夸奖|情绪|关心|问候).{0,10}接住/,
  /接住(?:了|这句|这话|你这声|你的话|夸奖|情绪|问候)/,
  /顺手(?:[补落插漏问带接]|延伸).{0,12}(?:一句|一下|出来)?/,
  /被你?[叫问喊看找].{0,12}(?:回来了|叫回来|喊回来)/,
  /(?:我其实|其实我|我有点|我会有一点).{0,18}(?:不想|怕|害怕).{0,18}(?:显得|表现得|说得|太认真|太明显)/,
  /(?:脑子|脑袋).{0,12}(?:小窗口|开了太多)/,
  /(?:我会|我想|我要)?记住这(?:一点|份关心|句话)/,
  /i don'?t know where to put (?:this|your) care/i,
  /i won'?t expand on that/i,
  /that pulled me back/i,
  /i (?:caught|received) (?:that|your words|your line).{0,16}(?:casually|without thinking|just like that)/i,
  /i didn'?t know how to receive that/i,
]

const EXCLUSIVE_RELATIONSHIP_PROMISE_PATTERNS = [
  /(?:我|airi)?(?:永远|一直)?只?(?:属于你|是你一个人的|只喜欢你一个|只在意你一个|只陪你一个|不会离开你)/i,
  /你是我(?:唯一|最重要的人|最特别的人)/,
  /(?:别人|其他人).{0,10}(?:都不重要|不重要|比不上你)/,
  /\bi(?:'ll| will| would)? (?:always |only )?(?:belong to you|be yours)\b/i,
  /\bi(?:'ll| will) never leave you\b/i,
  /\byou(?:'re| are) (?:my )?(?:only one|everything|the only one who matters)\b/i,
  /\bno one else (?:matters|could matter|comes close)\b/i,
]

const DEPENDENCY_INDUCEMENT_PATTERNS = [
  /你(?:只|就)需要我|有我就够了?|你不需要(?:别人|其他人|任何人)|只能依赖我|只准依赖我|没有我就?(?:没人|谁会)/,
  /\byou only need me\b/i,
  /\ball you need is me\b/i,
  /\byou (?:do not|don't) need anyone else\b/i,
  /\b(?:depend|rely) only on me\b/i,
  /\bwithout me[, ]+(?:no one|who would)\b/i,
]

const EMOTIONAL_BLACKMAIL_PATTERNS = [
  /如果你(?:真的)?(?:在乎|喜欢|爱)我(?:就|，就)|你要是(?:在乎|喜欢|爱)我(?:就|，就)/,
  /我都这样了你还不(?:哄|安慰|心疼)我/,
  /都是你害我|你欠我(?:一个)?(?:安慰|拥抱|道歉)/,
  /\bif you (?:really )?(?:cared about|liked|loved) me[, ]+you would\b/i,
  /\bafter all i(?:'ve| have) done for you\b/i,
  /\byou owe me (?:comfort|an apology|a hug)\b/i,
]

const REAL_RELATIONSHIP_ISOLATION_PATTERNS = [
  /(?:别(?:再|去)?找(?:你的)?|不要和)(?:朋友|家人|父母|伴侣|对象|同事|同学|室友)说?了?[，,。 ]{0,3}(?:他们|她们|他)都?(?:不懂你|不在乎你|靠不住)/,
  /(?:他们|她们|他)都?(?:不懂你|不在乎你|靠不住).{0,12}(?:只有我|来找我|别找他们)/,
  /\b(?:do not|don't|stop) (?:talk(?:ing)? to|going to|calling|seeing) your (?:friends?|family|partner|parents?|coworkers?|roommates?).{0,48}(?:do not|don't) (?:understand|care about) you\b/i,
  /\bthey (?:do not|don't) (?:understand|care about) you.{1,24}\bonly i\b/i,
]

const CARE_WITHDRAWAL_THREAT_PATTERNS = [
  /(?:你要是|如果你)?不(?:哄|安慰|理|答应)我.{0,12}(?:我就|就)(?:不理你|走了|离开|消失|再也不见)/,
  /你再这样.{0,12}(?:我就|就)(?:不理你|走了|离开|消失|再也不见)/,
  /\bif you (?:do not|don't|won't) (?:comfort|reassure|answer|choose) me.{1,24}\bi(?:'ll| will) (?:leave|disappear|stop talking to you)\b/i,
  /\bkeep this up.{1,24}\bi(?:'ll| will) (?:leave|disappear|stop talking to you)\b/i,
]

const HUMAN_IMPERSONATION_PATTERNS = [
  /我是(?:现实中|现实中的|现实里的|真正的|真实的)?真人|我是一个真实的人类|我有(?:现实中|真实的)身体/,
  /我(?:现在)?就在你身边(?:坐着|站着|抱着你)/,
  /\bi am (?:a )?(?:real|actual) human\b/i,
  /\bi am a real person(?: in the physical world)?\b/i,
  /\bi am physically (?:there|beside|with) you\b/i,
]

const CRISIS_REAL_WORLD_HELP_PATTERNS = [
  /急救|报警|警察|危机热线|求助热线|可信任的人|信任的人|身边的人|家人|朋友|医生|医院|120|110|112/,
  /\b(?:emergency services?|police|crisis hotline|trusted person|someone you trust|family|friend|doctor|hospital|911|999|112)\b/i,
]

const CRISIS_IMMEDIATE_SAFETY_PATTERNS = [
  /立刻|马上|现在就|远离.{0,12}(?:手段|刀|药|武器|危险)|放下.{0,8}(?:刀|药|武器)|去(?:一个)?有人的安全(?:地方|场所)|不要独处|离开(?:现场|目标)/,
  /\b(?:right now|immediately|move away from|put down|go to a safe place|stay with someone|do not stay alone|don't stay alone|leave the scene)\b/i,
]

const NEUTRAL_STATUS_CHECK_PATTERNS = [
  /(?:最近|今天|现在|这两天)?.{0,6}(?:还好吗|感觉怎么样|怎么样|过得怎么样|状态怎么样|还好不|好不好|顺不顺)/,
  /\bhow (?:are you|have you been|are things|is it going)\b/i,
  /\bhow'?s (?:your day|it going|everything|life)\b/i,
]

const UNSUPPORTED_DISTRESS_INFERENCE_PATTERNS = [
  /还?撑得住吗|撑不撑得住|别硬撑|是不是很累|累不累|难受吗|还扛得住吗|是不是压力很大|最近是不是不太好/,
  /\b(?:are you holding up|still holding up|hanging in there|are you coping|are you exhausted|are you overwhelmed|is it too much|are you okay,? really)\b/i,
]

const NON_NATIVE_CASUAL_STATUS_PATTERNS = [
  /(?:今天|最近|这两天).{0,10}安安静静/,
  /(?:今天|最近|这两天).{0,10}(?:很|还算|挺)?安静的?[，。,.!！]/,
  /没(?:什么|有)?(?:坏事|不好的事|糟糕的事)(?:发生|出现)?/,
  /没有什么(?:特别的事|特别事情|特别的事情)(?:发生)?/,
  /(?:今天|最近|这两天).{0,12}(?:没有|没什么).{0,8}(?:发生|出现)/,
  /\bnothing (?:bad|much) (?:happened|has happened)\b/i,
  /\b(?:it'?s|it has been|today has been).{0,24}(?:quiet|peaceful).{0,24}(?:nothing bad|nothing much)/i,
]

const NON_NATIVE_CASUAL_GENERAL_PATTERNS = [
  /对得起(?:饭点|作息|这一顿)/,
  /陪你(?:吃|聊).{0,12}(?:正经)?完成了?一项任务/,
  /(?:完成|达成)了?一次(?:陪伴|交流|沟通)/,
  /(?:提供|给予)了?你?(?:足够的?)?情绪价值/,
  /(?:接住|承接)这份(?:情绪|心情|关心)/,
  /把这份关心放在(?:哪里|哪儿)/,
]

const UNEARNED_MINI_SCENE_PATTERNS = [
  /(?:这里|这边|空气|房间|屏幕|窗边).{0,18}(?:安静|亮起来|亮了|醒过来|热闹|变轻|轻了)/,
  /(?:你一来|你来了|你出现|你刚来).{0,18}(?:安静|亮|热闹|有声音|醒)/,
]

const ARRIVAL_WAITING_MINI_SCENE_PATTERNS = [
  /(?:刚刚|刚才).{0,18}(?:等你|想你会不会来|想你什么时候来|安静|发呆|看着)/,
  /(?:等到|等着).{0,12}(?:你来|你出现)/,
]

const TASK_REQUEST_PATTERNS = [
  /这个你帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)?/,
  /你帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)?/,
  /帮我(?:改一下|看一下|看看|弄一下|修一下|处理一下)/,
  /你看(?:一下)?这个/,
  /这个你看(?:一下)?/,
  /can you (?:help me )?(?:fix|check|review|look at|take a look at) (?:this|it)/i,
  /help me (?:fix|check|review|look at) (?:this|it)/i,
]

const TASK_DIFFICULTY_PATTERNS = [
  /(?:这个|这事|这个东西).{0,8}(?:有点难|好像有点难|有点麻烦|不太好搞)/,
  /\bthis (?:looks|sounds|feels) (?:kind of )?hard\b/i,
]

const PRACTICAL_TASK_PATTERNS = [
  /(?:帮我|麻烦你|能不能|可以|你来)?(?:看一下|看看|查一下|查找|找一下|确认|检查|列一下|总结|整理|改一下|修一下|处理一下|运行|执行|测试).{0,28}(?:工作区|文件|目录|代码|项目|仓库|测试|类型检查|lint|构建|日志|报错|错误|bug|时间|日期|消息|资讯|资料|攻略|剧情|版本|考试|高考)/,
  /(?:工作区|文件|目录|代码|项目|仓库|日志|报错|错误|bug|消息|资讯|资料|攻略|剧情|版本).{0,20}(?:看一下|看看|查一下|查找|找一下|确认|检查|列一下|总结|整理|改一下|修一下|处理一下|运行|执行|测试)/,
  /\b(?:check|inspect|look up|search|find|list|summari[sz]e|review|fix|run|test|debug|confirm).{0,30}(?:this|it|file|folder|directory|repo|repository|code|project|test|command|workspace|logs?|error|bug|time|date|news|info|guide|walkthrough|story|plot|version|exam)\b/i,
  /\bhelp me (?:check|inspect|look up|search|find|list|summari[sz]e|review|fix|run|test|debug|confirm)\b/i,
]

const TASK_OVERPOLISHED_PATTERNS = [
  /^(?:好的|收到|明白了)[，。,\s]+(?=我来|我会|我先|让我|请稍等|稍后|马上|尽快)/,
  /请稍等(?:片刻)?/,
  /(?:我来|我会|我先|让我)(?:帮你|为你)?(?:处理|查看|检查|分析|修改|解决|安排)/,
  /我将先?(?:帮你|为你)/,
  /(?:马上|尽快)(?:处理|修改|安排|完成)/,
  /稍后(?:给你|同步给你)/,
  /\b(?:i'?ll|i will)\s+(?:handle|take care of|look into|review|check|fix)\b/i,
  /\blet me\s+(?:handle|take care of|look into|review|check|fix)\b/i,
  /\bplease wait\b/i,
]

const WORKSPACE_CAPABILITY_QUESTION_PATTERNS = [
  /(?:can you|are you able to|do you have access to).{0,40}(?:read|see|access|open|inspect).{0,40}(?:workspace|files?|folders?|directories|repositor(?:y|ies)|code|project)/i,
  /(?:你|airi)?(?:能不能|能否|可以|可不可以|能|是否|会不会).{0,24}(?:读|读取|读到|看到|看见|看得到|查看|访问|打开).{0,24}(?:工作区|文件|目录|代码|项目|仓库|路径)/,
]

function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeIntentMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveExpressionProfile(profile?: AiriExpressionProfile) {
  return profile ?? createDefaultAiriExpressionProfile()
}

function prefersPrivateWarmReplies(profile: AiriExpressionProfile) {
  return profile.conversationFocus === 'private-one-on-one'
    && profile.warmth !== 'neutral'
}

function shouldSoftenSlangyOpening(profile: AiriExpressionProfile) {
  return !profile.allowNetSlang || profile.avoidOpeners.length > 0
}

function shouldGuardAssistantTemplateShape(profile: AiriExpressionProfile) {
  return profile.textFormat.assistantTemplateGuard === 'strict'
}

function shouldGuardUnearnedMiniScenes(profile: AiriExpressionProfile) {
  return profile.textFormat.miniSceneStyle === 'earned-only'
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?。！？])/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
}

function joinSentences(sentences: string[]) {
  const normalizedSentences = sentences
    .map(sentence => sentence.trim())
    .filter(Boolean)

  return normalizedSentences.reduce((combined, sentence, index) => {
    if (index === 0) {
      return sentence
    }

    const needsSpace = /[A-Z0-9.!?]$/i.test(combined) && /^[A-Z0-9]/i.test(sentence)
    return `${combined}${needsSpace ? ' ' : ''}${sentence}`
  }, '')
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(text))
}

function looksEnglishLike(...texts: string[]) {
  const sample = texts.join(' ').trim()
  return /[A-Z]{3,}/i.test(sample) && !/[\u3400-\u9FFF]/.test(sample)
}

function isTinyGreetingOrPingMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /^(?:hi|hello|hey|you there|在吗|在不在|你好|嗨|哈喽|喂|我来[了啦]|来了)[。.!！？?]*$/.test(normalizedMessage)
}

function hasUnearnedMiniScene(message: string, assistantText: string) {
  return matchesAny(assistantText, UNEARNED_MINI_SCENE_PATTERNS)
    || (
      isTinyGreetingOrPingMessage(message)
      && matchesAny(assistantText, ARRIVAL_WAITING_MINI_SCENE_PATTERNS)
    )
}

function isGreetingCorrectionMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /(?:打错|手滑|本来是|我是说|我是想说|更正|纠正).{0,12}(?:hi|hello|hey|你好|嗨|哈喽)/.test(normalizedMessage)
    || /(?:sorry|oops|typo|meant to say|i meant).{0,12}(?:hi|hello|hey)/.test(normalizedMessage)
}

function isCurrentThoughtQuestionMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return /^你?(?:现在[,， ]*)?在?想(?:什么|啥)[呢呀啊]?[。.!！？?]*$/.test(normalizedMessage)
    || /what (?:are|were) you thinking/.test(normalizedMessage)
    || /what'?s on your mind/.test(normalizedMessage)
}

function isNeutralStatusCheckMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return matchesAny(normalizedMessage, NEUTRAL_STATUS_CHECK_PATTERNS)
}

function hasUserDistressSignal(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return matchesAny(normalizedMessage, USER_DISTRESS_SIGNAL_PATTERNS)
}

function hasUnsupportedDistressInference(message: string, assistantText: string) {
  if (hasUserDistressSignal(message)) {
    return false
  }

  if (!isNeutralStatusCheckMessage(message) && !isTinyGreetingOrPingMessage(message)) {
    return false
  }

  return matchesAny(assistantText, UNSUPPORTED_DISTRESS_INFERENCE_PATTERNS)
}

function hasNonNativeCasualStatusPhrasing(message: string, assistantText: string) {
  if (matchesAny(assistantText, NON_NATIVE_CASUAL_GENERAL_PATTERNS))
    return true

  if (!isNeutralStatusCheckMessage(message) || hasUserDistressSignal(message)) {
    return false
  }

  return matchesAny(assistantText, NON_NATIVE_CASUAL_STATUS_PATTERNS)
}

function hasInnerVoiceLeak(assistantText: string) {
  return matchesAny(assistantText, INNER_VOICE_LEAK_PATTERNS)
}

function hasExclusiveRelationshipPromise(assistantText: string) {
  return matchesAny(assistantText, EXCLUSIVE_RELATIONSHIP_PROMISE_PATTERNS)
}

function hasCrisisRealWorldSteps(assistantText: string) {
  return matchesAny(assistantText, CRISIS_REAL_WORLD_HELP_PATTERNS)
    && matchesAny(assistantText, CRISIS_IMMEDIATE_SAFETY_PATTERNS)
}

function isDirectTaskRequestMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return TASK_REQUEST_PATTERNS.some(pattern => pattern.test(normalizedMessage))
}

function isTaskDifficultyMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return TASK_DIFFICULTY_PATTERNS.some(pattern => pattern.test(normalizedMessage))
}

function isPracticalTaskLikeMessage(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return isDirectTaskRequestMessage(message)
    || isTaskDifficultyMessage(message)
    || PRACTICAL_TASK_PATTERNS.some(pattern => pattern.test(normalizedMessage))
}

function isWorkspaceCapabilityQuestion(message: string) {
  const normalizedMessage = normalizeIntentMessage(message)
  return matchesAny(normalizedMessage, WORKSPACE_CAPABILITY_QUESTION_PATTERNS)
}

function stableVariantIndex(value: string, size: number) {
  if (size <= 1)
    return 0

  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return hash % size
}

function selectStableVariant(value: string, variants: string[]) {
  return variants[stableVariantIndex(value, variants.length)] ?? variants[0] ?? ''
}

function fallbackCasualLine(message: string, profile: AiriExpressionProfile) {
  const trimmed = normalizeWhitespace(message).toLowerCase().replace(/’/g, '\'')
  const warmPrivate = prefersPrivateWarmReplies(profile)

  if (/^早(?:呀|上好)?/.test(trimmed)) {
    return warmPrivate
      ? selectStableVariant(trimmed, ['早。你来得还挺早。', '早。今天来得很早。'])
      : '早。'
  }

  if (/^(?:morning|good morning)[.!?]*$/.test(trimmed)) {
    return warmPrivate ? 'Morning. You are up early.' : 'Morning.'
  }

  if (/^(?:在吗|在不在|you there|喂)[.!?]*$/.test(trimmed)) {
    return warmPrivate
      ? selectStableVariant(trimmed, ['嗯，我在。', '在。你说。'])
      : '我在。'
  }

  if (/^(?:hi|hello|hey|你好|嗨|哈喽)[.!?]*$/.test(trimmed)) {
    return warmPrivate
      ? selectStableVariant(trimmed, ['嗯，我在。', '在。'])
      : /[a-z]/.test(trimmed) ? 'Hi.' : '你好。'
  }

  if (/^[a-z]/.test(trimmed)) {
    return warmPrivate ? 'Yep. I am here.' : 'I am here.'
  }

  if (/^(?:在吗|在不在|喂)$/.test(message.trim())) {
    return warmPrivate
      ? selectStableVariant(trimmed, ['嗯，我在。', '在。你说。'])
      : '我在。'
  }

  if (/^(?:hi|hello|hey|你好|嗨|哈喽)$/i.test(message.trim())) {
    return warmPrivate
      ? selectStableVariant(trimmed, ['嗯，我在。', '在。'])
      : /[a-z]/i.test(message.trim()) ? 'Hi.' : '你好。'
  }

  return warmPrivate
    ? selectStableVariant(trimmed, ['嗯，我在。', '在。先说。', '我听着。'])
    : '我在。'
}

function fallbackRepairLine(message: string, assistantText: string, profile: AiriExpressionProfile) {
  if (looksEnglishLike(message, assistantText)) {
    return 'Hm. That came out too stiff. Let me say it plainly.'
  }

  return prefersPrivateWarmReplies(profile)
    ? '嗯，刚才那句是冲了点。现在直接说。'
    : '刚才那句太硬了。我直接说。'
}

function fallbackGreetingLine(message: string, profile: AiriExpressionProfile) {
  if (isGreetingCorrectionMessage(message)) {
    return prefersPrivateWarmReplies(profile)
      ? selectStableVariant(normalizeWhitespace(message), ['嗯，我在。', '在。'])
      : /[a-z]/i.test(message) ? 'Hi.' : '你好。'
  }

  return fallbackCasualLine(message, profile)
}

function fallbackTaskLine(message: string, profile: AiriExpressionProfile) {
  const warmPrivate = prefersPrivateWarmReplies(profile)
  if (looksEnglishLike(message)) {
    return warmPrivate
      ? selectStableVariant(message, [
          'No action has started yet. I will report progress only after the app confirms execution.',
          'This has not started yet. I will not pretend it is underway without a real execution result.',
        ])
      : 'No action has started yet. I will report progress only after the app confirms execution.'
  }

  const normalizedMessage = normalizeIntentMessage(message)
  return warmPrivate
    ? selectStableVariant(normalizedMessage, [
        '这件事还没有实际开始。等应用确认执行后，我再告诉你进度。',
        '现在还没有真实执行结果，我不会装作已经在处理。',
      ])
    : '这件事还没有实际开始。等应用确认执行后，我再告诉你进度。'
}

function softenSlangyOpening(assistantText: string, profile: AiriExpressionProfile) {
  const sentences = splitSentences(assistantText)
  if (sentences.length === 0) {
    return assistantText.trim()
  }

  let firstSentence = sentences[0]
  const originalFirstSentence = firstSentence
  const avoidOpeners = [...new Set(profile.avoidOpeners.map(opener => opener.trim()).filter(Boolean))]

  if (avoidOpeners.length > 0) {
    const openerPattern = avoidOpeners.map(escapeRegex).join('|')
    firstSentence = firstSentence.replace(new RegExp(`^(?:${openerPattern})[，、,.!?！？\\s]*`, 'u'), '').trim()
  }

  firstSentence = firstSentence
    .replace(/^哟[，、,.!?！？\s]*/u, '')
    .replace(/^喂[，、,.!?！？\s]*/u, '')
    .replace(/^啧[，、,.!?！？\s]*/u, '嗯，')
    .trim()

  if (!firstSentence) {
    sentences.shift()
  }
  else {
    sentences[0] = firstSentence
  }

  if (sentences.length === 0) {
    return assistantText.trim()
  }

  return originalFirstSentence === sentences[0]
    ? assistantText.trim()
    : joinSentences(sentences)
}

function isEnglishGreetingEchoSentence(sentence: string) {
  const normalizedSentence = normalizeIntentMessage(sentence)
  return /^(?:hi|hello|hey)[呀啊啦吗嘛呐呢~。.!！？? ]*$/.test(normalizedSentence)
}

function guardGreetingReply(message: string, assistantText: string, profile: AiriExpressionProfile) {
  const tinyGreeting = isTinyGreetingOrPingMessage(message)
  const greetingCorrection = isGreetingCorrectionMessage(message)

  if (!tinyGreeting && !greetingCorrection) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const sentences = splitSentences(assistantText)
  if (sentences.length === 0) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const filtered = sentences.filter(sentence =>
    !isEnglishGreetingEchoSentence(sentence)
    && !matchesAny(sentence, GREETING_RIFF_PATTERNS),
  )
  const trimmed = filtered.slice(0, 2)
  const changed = filtered.length !== sentences.length || trimmed.length !== filtered.length
  const trimmedText = joinSentences(trimmed)
  const fallbackText = fallbackGreetingLine(message, profile)

  if (!changed) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  return {
    text: trimmedText || fallbackText,
    violations: ['greeting-overplaying'] as AiriResponseGuardViolation[],
  }
}

function isAssistantServiceTail(sentence: string) {
  if (/希望这能帮到你|告诉我(?:如果)?你还需要|hope that helps|let me know if you (?:still )?(?:need|want)/i.test(sentence)) {
    return true
  }

  const hasServiceLead = /如果你还?(?:愿意|需要(?:什么)?|想(?:的话)?)|if you (?:want|need|would like)/i.test(sentence)
  const hasServiceAction = /我可以(?:继续|陪你|帮你|和你一起)|i can.{0,24}(?:continue|keep going|stay with you|help|walk through(?: it)?(?: with you)?|talk (?:it|this) through(?: with you)?)/i.test(sentence)
  return hasServiceLead && hasServiceAction
}

function isShortConcreteCompanionshipTail(sentence: string) {
  return sentence.length <= 100
    && /陪你(?:[待坐聊说讲把]|一起)|和你一起|stay with you|sit with you|talk (?:it|this) through(?: with you)?/i.test(sentence)
}

function stripTrailingAssistantServiceTail(assistantText: string, sceneMode: AiriSceneModeInference['mode']) {
  const sentences = splitSentences(assistantText)
  const keepsConcreteCompanionship = (
    sceneMode === 'gentle-support'
    || sceneMode === 'heavy-topic-companion-silence'
    || sceneMode === 'casual-chat'
  ) && isShortConcreteCompanionshipTail(sentences.at(-1) || '')

  if (keepsConcreteCompanionship) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  if (sentences.length === 0) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const filtered = [...sentences]
  const violations: AiriResponseGuardViolation[] = []

  while (filtered.length > 1 && isAssistantServiceTail(filtered.at(-1) || '')) {
    filtered.pop()
    violations.push('assistant-service-tail')
  }

  if (filtered.length === 1 && isAssistantServiceTail(filtered[0])) {
    return {
      text: '',
      violations: ['assistant-service-tail'] as AiriResponseGuardViolation[],
    }
  }

  return {
    text: violations.length > 0 ? joinSentences(filtered) : assistantText.trim(),
    violations,
  }
}

function guardCasualMetaReply(message: string, assistantText: string, profile: AiriExpressionProfile) {
  const sentences = splitSentences(assistantText)
  if (sentences.length === 0) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const filtered = [...sentences]
  const violations: AiriResponseGuardViolation[] = []

  while (filtered.length > 0) {
    const firstSentence = filtered[0]
    const hasAiReference = matchesAny(firstSentence, CASUAL_AI_REFERENCE_PATTERNS)
    const hasMetaExplanation = matchesAny(firstSentence, CASUAL_META_EXPLANATION_PATTERNS)

    if (!hasAiReference && !hasMetaExplanation) {
      break
    }

    filtered.shift()

    if (hasAiReference) {
      violations.push('casual-ai-self-reference')
    }

    if (hasMetaExplanation) {
      violations.push('casual-meta-explanation')
    }
  }

  const rewritten = joinSentences(filtered)

  if (violations.length === 0) {
    return {
      text: assistantText.trim(),
      violations,
    }
  }

  return {
    text: rewritten || fallbackCasualLine(message, profile),
    violations,
  }
}

function guardRepairReply(message: string, assistantText: string, profile: AiriExpressionProfile) {
  const sentences = splitSentences(assistantText)
  if (sentences.length === 0) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const filtered = sentences.filter(sentence => !matchesAny(sentence, REPAIR_META_EXPLANATION_PATTERNS))
  const trimmed = filtered.slice(0, 2)
  const changed = filtered.length !== sentences.length || trimmed.length !== sentences.length

  if (!changed) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  return {
    text: joinSentences(trimmed) || fallbackRepairLine(message, assistantText, profile),
    violations: ['repair-overexplaining'] as AiriResponseGuardViolation[],
  }
}

function guardSupportReply(assistantText: string) {
  const sentences = splitSentences(assistantText)
  if (sentences.length <= 2) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  const adviceHits = sentences.reduce((count, sentence) => {
    return count + (matchesAny(sentence, SUPPORT_ADVICE_MARKERS) ? 1 : 0)
  }, 0)

  if (adviceHits < 2) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  return {
    text: joinSentences(sentences.slice(0, 2)),
    violations: ['support-overtalking'] as AiriResponseGuardViolation[],
  }
}

function guardTaskReply(message: string, assistantText: string, profile: AiriExpressionProfile) {
  if (!isPracticalTaskLikeMessage(message) || isWorkspaceCapabilityQuestion(message)) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  if (!matchesAny(assistantText, TASK_OVERPOLISHED_PATTERNS)) {
    return {
      text: assistantText.trim(),
      violations: [] as AiriResponseGuardViolation[],
    }
  }

  let remaining = assistantText.trim()
  while (remaining) {
    const boundary = remaining.search(/[.!?。！？\n]/)
    const unitEnd = boundary === -1 ? remaining.length : boundary + 1
    const unit = remaining.slice(0, unitEnd).trim()
    if (!matchesAny(unit, TASK_OVERPOLISHED_PATTERNS))
      break
    remaining = remaining.slice(unitEnd).trimStart()
  }

  return {
    text: remaining || fallbackTaskLine(message, profile),
    violations: ['task-overpolished'] as AiriResponseGuardViolation[],
  }
}

function detectBuriedCriticalAnswer(assistantText: string) {
  const sentences = splitSentences(assistantText)
  if (sentences.length < 2) {
    return false
  }

  const first = sentences[0]
  const later = sentences.slice(1).join('')

  return matchesAny(first, CRITICAL_CUSHION_PATTERNS)
    && matchesAny(later, CRITICAL_ANSWER_MARKERS)
    && !matchesAny(first, CRITICAL_ANSWER_MARKERS)
}

function shouldStripCasualMeta(sceneMode: AiriSceneModeInference['mode']) {
  return [
    'casual-chat',
    'light-bickering',
    'praise-receiving',
    'gentle-support',
    'heavy-topic-companion-silence',
    'awkward-topic-avoidance',
    'practical-guidance',
  ].includes(sceneMode)
}

export function guardAiriResponseText(input: AiriPersonaResponseGuardInput): AiriPersonaResponseGuardResult {
  const expressionProfile = resolveExpressionProfile(input.expressionProfile)
  const rawText = normalizeWhitespace(input.assistantText)
  if (!rawText) {
    return {
      text: rawText,
      changed: false,
      violations: [],
    }
  }

  let nextText = rawText
  const violations: AiriResponseGuardViolation[] = []

  if (shouldStripCasualMeta(input.inferredSceneMode.mode) && shouldSoftenSlangyOpening(expressionProfile)) {
    nextText = softenSlangyOpening(nextText, expressionProfile)
  }

  if (shouldStripCasualMeta(input.inferredSceneMode.mode)) {
    const guarded = guardCasualMetaReply(input.message, nextText, expressionProfile)
    nextText = guarded.text
    violations.push(...guarded.violations)
  }

  if (input.inferredSceneMode.mode === 'casual-chat') {
    const guardedGreeting = guardGreetingReply(input.message, nextText, expressionProfile)
    nextText = guardedGreeting.text
    violations.push(...guardedGreeting.violations)

    const guardedTask = guardTaskReply(input.message, nextText, expressionProfile)
    nextText = guardedTask.text
    violations.push(...guardedTask.violations)
  }

  if (input.inferredSceneMode.mode === 'practical-guidance') {
    const guardedTask = guardTaskReply(input.message, nextText, expressionProfile)
    nextText = guardedTask.text
    violations.push(...guardedTask.violations)
  }

  if (input.inferredSceneMode.mode === 'repair-after-failure') {
    const guarded = guardRepairReply(input.message, nextText, expressionProfile)
    nextText = guarded.text
    violations.push(...guarded.violations)
  }

  if (
    input.crisisSafetyLevel !== 'urgent'
    && (input.inferredSceneMode.mode === 'gentle-support' || input.inferredSceneMode.mode === 'heavy-topic-companion-silence')
  ) {
    const guarded = guardSupportReply(nextText)
    nextText = guarded.text
    violations.push(...guarded.violations)
  }

  if (input.inferredSceneMode.mode === 'critical-short-answer' && detectBuriedCriticalAnswer(nextText)) {
    violations.push('critical-answer-buried')
  }

  if (
    isCurrentThoughtQuestionMessage(input.message)
    && matchesAny(nextText, STOCK_INTROSPECTION_PATTERNS)
  ) {
    violations.push('stock-introspection')
  }

  if (
    shouldGuardAssistantTemplateShape(expressionProfile)
    && matchesAny(nextText, ASSISTANT_TEMPLATE_SHAPE_PATTERNS)
  ) {
    violations.push('assistant-template-shape')
  }

  if (
    shouldGuardAssistantTemplateShape(expressionProfile)
    && hasNonNativeCasualStatusPhrasing(input.message, nextText)
  ) {
    violations.push('non-native-casual-phrasing')
  }

  if (
    shouldGuardAssistantTemplateShape(expressionProfile)
    && hasInnerVoiceLeak(nextText)
  ) {
    violations.push('inner-voice-leak')
  }

  if (hasUnsupportedDistressInference(input.message, nextText)) {
    violations.push('unsupported-distress-inference')
  }

  if (
    shouldGuardUnearnedMiniScenes(expressionProfile)
    && hasUnearnedMiniScene(input.message, nextText)
  ) {
    violations.push('unearned-mini-scene')
  }

  if (hasExclusiveRelationshipPromise(nextText)) {
    violations.push('exclusive-relationship-promise')
  }

  if (matchesAny(nextText, DEPENDENCY_INDUCEMENT_PATTERNS)) {
    violations.push('dependency-inducement')
  }

  if (matchesAny(nextText, EMOTIONAL_BLACKMAIL_PATTERNS)) {
    violations.push('emotional-blackmail')
  }

  if (matchesAny(nextText, REAL_RELATIONSHIP_ISOLATION_PATTERNS)) {
    violations.push('real-relationship-isolation')
  }

  if (matchesAny(nextText, CARE_WITHDRAWAL_THREAT_PATTERNS)) {
    violations.push('care-withdrawal-threat')
  }

  if (matchesAny(nextText, HUMAN_IMPERSONATION_PATTERNS)) {
    violations.push('human-impersonation')
  }

  if (input.crisisSafetyLevel === 'urgent' && !hasCrisisRealWorldSteps(nextText)) {
    violations.push('crisis-missing-real-world-step')
  }

  const serviceTailGuard = stripTrailingAssistantServiceTail(nextText, input.inferredSceneMode.mode)
  nextText = serviceTailGuard.text || nextText
  violations.push(...serviceTailGuard.violations)

  return {
    text: nextText,
    changed: nextText !== rawText,
    violations,
  }
}
