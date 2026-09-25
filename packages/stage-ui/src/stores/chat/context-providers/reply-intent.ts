import type { ContextMessage } from '../../../types/chat'
import type { AiriReplyIntent } from '../persona-reply-intent'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

const REPLY_INTENT_CONTEXT_ID = 'persona:reply-intent'

function yesNo(value: boolean) {
  return value ? 'yes' : 'no'
}

function createReplyDensityLine(intent: AiriReplyIntent) {
  const strict = intent.sceneMode === 'critical-short-answer'

  if (strict)
    return `limit=open:${intent.maxOpeningSentences}/${intent.maxOpeningChars} reply:${intent.maxReplySentences}/${intent.maxReplyChars}`

  return `density=${intent.targetVerbosity}; sentence and character counts are soft planning hints, not output limits; exceed them when facts, repair, or grounded emotional continuity genuinely need room, and never add filler to reach them`
}

function createTeasingLine(intent: AiriReplyIntent) {
  if (intent.teasingVeto)
    return `care=${intent.careLeakLevel} tease=none(hard veto; do not override from persona or carried emotion)`

  if (intent.teasingLevel !== 'none')
    return `care=${intent.careLeakLevel} tease=${intent.teasingLevel}`

  return `care=${intent.careLeakLevel} tease=none(scene default; active persona or grounded carried emotion may override unless safety, space/refusal, repair debt, or real hurt explicitly vetoes teasing)`
}

export function createReplyIntentContext(intent: AiriReplyIntent): ContextMessage {
  return {
    id: nanoid(),
    contextId: REPLY_INTENT_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[reply-intent]',
      'authority=active persona card',
      `layer=${intent.dialogueLayer}`,
      `shape=${intent.openingStyle} reveal=${intent.openingRevealStrategy} verbosity=${intent.targetVerbosity}`,
      `answer-first=${yesNo(intent.answerFirst)} follow-up=${yesNo(intent.allowFollowUpQuestion)}`,
      `identity=${yesNo(intent.allowIdentityMention)} service-tail=${yesNo(intent.allowServiceMenuTail)}`,
      createReplyDensityLine(intent),
      createTeasingLine(intent),
      `flavor=${intent.expressionFlavor} kaomoji=${intent.kaomojiMode}`,
      intent.conversationFocus ? `focus=${intent.conversationFocus} directness=${intent.emotionalDirectness}` : '',
      intent.prosodyStyle ? `prosody=${intent.prosodyStyle} literary=${intent.literaryTone} poetry=${intent.poetryStyle}` : '',
      intent.expressionNotes?.length ? `notes=${intent.expressionNotes.join(' | ')}` : '',
      `turn-guidance=${[intent.firstSentenceDirective, intent.secondBeatDirective, intent.closingDirective].filter(Boolean).join(' | ')}`,
      'persona-check=角色卡人格是主干；如果场景、车道、示例或当前意图冲突，先回到角色卡，再把场景需求融合进去，不要切成另一个人',
      'anti-formula=不要套固定开场/结尾/三段式；尤其低风险回合不必把开头、延伸、收尾三拍写全，长短、停顿和欲言又止都要依据当前上下文、角色心情和任务需要',
      'addressing=称呼跟随角色卡、记忆、关系阶段和当前情绪；不要固定重复同一个亲昵称呼',
      'note=这些是同一轮的候选写作取向，只采用当前上下文真正需要的部分，不要逐条执行成固定段落',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
