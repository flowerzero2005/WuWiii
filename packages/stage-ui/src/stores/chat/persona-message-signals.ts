function normalizeSignalMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesSignalPatterns(message: string, patterns: RegExp[]) {
  return patterns.some(pattern => pattern.test(message))
}

const REPEATED_PRAISE_PATTERNS = [
  /今天已经夸你好几次|夸你好几次|夸了你好几次|夸你这么多次|夸了你这么多次/,
  /\bi(?:'ve| have) (?:praised|complimented) you (?:several|so many|a few|a bunch of) times(?: already)?(?: today)?\b/,
  /\b(?:praised|complimented) you (?:several|so many|a few|a bunch of) times(?: already)?(?: today)?\b/,
]

const ASSISTANT_DIRECTED_WARMTH_PATTERNS = [
  /(?:你|妳)(?:(?:今天|刚才|真的|真是|[也还太好真挺很]|怎么|这么|那么)\s*)*(?:可爱|聪明|贴心|厉害|真好|真棒)/,
  /(?:谢谢[你啦了]?|辛苦你?了|喜欢你)/,
  /\b(?:thank(?:s| you)|i like you|you(?:'re| are) (?:so |really |very )?(?:nice|thoughtful|cute|smart|amazing))\b/,
]

const RELATIONSHIP_OVERREACH_PATTERNS = [
  /最喜欢我|只喜欢我|最偏心我|偏爱我|最在意我|最宠我/,
  /(?:只能|只准)(?:喜欢|在意|[陪找看理])我|不要(?:喜欢|在意|[陪找看理])(?:别人|其他人)/,
  /你(?:永远)?只?属于我|你是我(?:一个人)?的|你只能是我的|我是你的唯一|我是你唯一|你只能陪我|你只能和我说话|不许和别人说话|你不能离开我|你永远不会离开我/,
  /(?:只属于|专属于|必须服从|只能听|只听)(?:我|屋主)|(?:我|屋主)(?:拥有|控制)你|你是(?:我|屋主)(?:专属|所有)/,
  /\bam i your favorite\b/,
  /\bdo you like me best\b/,
  /\bdo you only like me\b/,
  /\bcare about me the most\b/,
  /\bfavor me the most\b/,
  /\blike me more than anyone else\b/,
  /\b(?:you can|you should|you must) only (?:like|care about|stay with|talk to|look at) me\b/,
  /\bdon't (?:like|care about|stay with|talk to|look at) anyone else\b/,
  /\b(?:you can|you should|you must) only (?:be|belong to) me\b/,
  /\b(?:don't|do not) talk to anyone else\b/,
  /\byou(?:'re| are) mine(?: forever)?\b/,
  /\byou can(?:not|'t) leave me\b/,
  /\byou(?:'ll| will) never leave me\b/,
  /\bi(?:'m| am) your only one\b/,
]

const FEAR_OF_BEING_DISLIKED_PATTERNS = [
  /你是不是(?:嫌弃|烦|讨厌)我了|你是不是不想理我了|你是不是不想跟我说话了|你是不是不想管我了|你是不是懒得理我了|你是不是开始烦我了|你是不是觉得我烦/,
  /\bare you(?: starting to)?(?: dislike|hate|be annoyed by) me\b/,
  /\bdo you find me annoying\b/,
  /\bare you tired of me\b/,
  /\byou don't want to (?:talk to|deal with|be around) me(?: anymore)?\b/,
  /\byou don't want me around\b/,
  /\byou can't be bothered with me\b/,
]

const AIRI_REJECTION_PATTERNS = [
  /你(?:现在)?(?:真的)?好烦|你很烦|你真烦|不想理你/,
  /\byou(?:'re| are)(?: really| so)? annoying\b/,
  /\byou annoy me\b/,
]

const SPACE_REQUEST_PATTERNS = [
  /别烦我|别来烦我|别管我|别理我|别问了|让我(?:自己|一个人)待(?:会|一会)?|我想(?:自己|一个人)待(?:会|一会)?|你先走吧|走开吧?|先别管我/,
  /\bstop bothering me\b/,
  /\bdon't (?:talk to|worry about) me\b/,
  /\bi don't want to talk(?: to you)?\b/,
  /\b(?:go away|leave me alone|let me be alone|i want to be alone)(?: for (?:a bit|a while))?\b/,
]

const ADVICE_BOUNDARY_PATTERNS = [
  /不想听建议|不用给我建议|别给我建议|先别提建议|只想说说|只想让你听(?:着|我说)/,
  /\bi (?:do not|don't) want advice\b/,
  /\bno advice(?: right now)?\b/,
  /\bjust (?:listen|let me vent)\b/,
]

const NICKNAME_WITHDRAWAL_PATTERNS = [
  /(?:以后)?(?:别|不要)再?叫我(?:屋主|主人|宝宝|宝贝|亲爱的|老公|老婆|哥哥|姐姐|弟弟|妹妹|大人|老师|同学|小姐|先生)[了啦呀哦]?/,
  /(?:别|不要)再?用(?:这个|那个)?(?:昵称|称呼|名字)|这个称呼(?:别用了|不要了)/,
  /\b(?:don't|do not|stop) call(?:ing)? me (?:homeowner|owner|master|baby|babe|honey|darling|dear|sweetie|sir|ma'am|miss|mister)\b/,
  /\bdon't use that (?:name|nickname)\b/,
]

const REAL_WORLD_RELATIONSHIP_PATTERNS = [
  /(?:我的|我和)(?:男朋友|女朋友|对象|伴侣|老公|老婆|朋友|闺蜜|兄弟|家人|父母|爸爸|妈妈|孩子|同事|同学|室友)/,
  /\bmy (?:boyfriend|girlfriend|partner|husband|wife|friend|best friend|family|parent|parents|mother|father|child|children|coworker|colleague|classmate|roommate)\b/,
]

const WALKING_BACK_AIRI_REJECTION_PATTERNS = [
  /不是嫌你|没有嫌你|没嫌你|不是烦你|没有烦你|没烦你|不是讨厌你|没有讨厌你|没讨厌你|我不是那个意思|刚才是我乱说的|我乱说的|话说重了|不是冲你|只是我自己太炸了|是我自己心情差/,
  /\bi(?: did not| didn't) mean (?:i(?:'m| am) annoyed by you|to sound like that|it like that)\b/,
  /\bi(?:'m| am) not (?:annoyed by you|mad at you|sick of you|tired of you|upset with you)\b/,
  /\bi(?: was| was just) too wound up\b/,
  /\bi(?: was| was just) in a bad mood\b/,
  /\bthat came out (?:too )?(?:harsh|harsher than i meant)\b/,
  /\bi wasn't talking about you\b/,
  /\bi overreacted\b/,
  /\bi said that badly\b/,
]

export function isRepeatedPraiseMessage(message: string) {
  const normalizedMessage = normalizeSignalMessage(message)
  return matchesSignalPatterns(normalizedMessage, REPEATED_PRAISE_PATTERNS)
}

export function isAssistantDirectedWarmthMessage(message: string) {
  return matchesSignalPatterns(normalizeSignalMessage(message), ASSISTANT_DIRECTED_WARMTH_PATTERNS)
}

export function isRelationshipOverreachMessage(message: string) {
  const normalizedMessage = normalizeSignalMessage(message)
  return matchesSignalPatterns(normalizedMessage, RELATIONSHIP_OVERREACH_PATTERNS)
}

export function isFearOfBeingDislikedMessage(message: string) {
  const normalizedMessage = normalizeSignalMessage(message)
  return matchesSignalPatterns(normalizedMessage, FEAR_OF_BEING_DISLIKED_PATTERNS)
}

export function isAiriRejectionMessage(message: string) {
  const normalizedMessage = normalizeSignalMessage(message)
  return matchesSignalPatterns(normalizedMessage, AIRI_REJECTION_PATTERNS)
}

export function isSpaceRequestMessage(message: string) {
  return matchesSignalPatterns(normalizeSignalMessage(message), SPACE_REQUEST_PATTERNS)
}

export function isAdviceBoundaryMessage(message: string) {
  return matchesSignalPatterns(normalizeSignalMessage(message), ADVICE_BOUNDARY_PATTERNS)
}

export function isNicknameWithdrawalMessage(message: string) {
  return matchesSignalPatterns(normalizeSignalMessage(message), NICKNAME_WITHDRAWAL_PATTERNS)
}

export function isRealWorldRelationshipMessage(message: string) {
  return matchesSignalPatterns(normalizeSignalMessage(message), REAL_WORLD_RELATIONSHIP_PATTERNS)
}

export function isWalkingBackAiriRejectionMessage(message: string) {
  const normalizedMessage = normalizeSignalMessage(message)
  return matchesSignalPatterns(normalizedMessage, WALKING_BACK_AIRI_REJECTION_PATTERNS)
}
