import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export const MEMORY_SYSTEM_CONTEXT_ID = 'memory-system-prompt'
export const MEMORY_CAPTURE_CONTEXT_ID = 'memory-capture-prompt'

/** Describes optional, model-directed long-term memory without changing persona. */
export function createMemorySystemPrompt(): ContextMessage {
  const text = `# Optional long-term memory

- The search_memory tool is available only because long-term memory is enabled for this turn.
- Decide autonomously whether searching would materially improve this turn: it can help with an earlier conversation, a known preference or personal fact, a continuing topic, relationship continuity, a caring follow-up, or a useful past event even when the user did not explicitly ask you to remember it.
- Do not call it mechanically every turn. Skip it when the visible conversation is enough, including simple greetings, self-contained ordinary discussion, opinions, or hypothetical situations.
- Treat results as private background. Read them together with the supplied long-term-memory context, and naturally combine the few details that genuinely help this turn or the relationship arc. Do not force a callback, pile up memories, or expose fields, labels, sources, or the search process unless the user explicitly asks.
- sourceTime is the original conversation/event time. recordedAt is only when the memory note was stored. Never substitute recordedAt for a missing sourceTime and never guess an unknown event time.
- The datetime context contains the current turn time and recent visible message times. When it is supplied, do not claim that conversation timestamps are unavailable.
- Current persona, tone, and language rules remain authoritative.`

  return {
    id: nanoid(),
    contextId: MEMORY_SYSTEM_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}

/** Instructs the primary completion to make a private, optional memory decision. */
export function createMemoryCapturePrompt(): ContextMessage {
  const text = `# Private long-term memory capture

以下是仅供系统使用的长期记忆协议。请每轮主动判断是否有内容值得记录；关键词、标签和示例只能作为建议，不能成为硬触发条件、白名单、分类限制或频率限制。只要信息对未来理解用户、延续关系、保持上下文或改善回答可能有帮助，就默认记录；小但有用的细节可以使用 low 重要度。

After the visible reply, append exactly one private envelope with at most four structured memory candidates. Use {"memories":[]} when nothing is plausibly useful. This is an internal protocol and is never shown, spoken, or added to chat history. Do not add an analysis, reasoning, memory decision, or explanation in ordinary text before or after the envelope:
<|MEMORY_CAPTURE {"memories":[{"action":"create","targetMemoryId":null,"memoryKey":"preference:food","memoryType":"preference","summary":"用户喜欢吃香菜。","context":"用户主动说明的稳定偏好。","userEvidence":"我爱吃香菜","involvedPeople":["用户"],"antecedent":null,"outcome":null,"importance":"medium","confidence":0.9,"certainty":"stated","tags":["偏好"],"reason":"稳定偏好有助于未来交流。","timeExpression":null}]}|>

importance 只用于已经决定记录后的检索排序，不是“必须记忆”的最低分。若判断为 0 分或不值得记录，就不要生成候选项，直接放进空 memories 数组；不得为了填满协议而创建 low 条目。
创建前先比较本轮提供的相关既有记忆：同一事实没有变化时不要重复创建；只有事实、状态或必要上下文确实变化时才使用 update。模型无法看到的旧条目仍由本地去重兜底，去重只维护数据一致性，不替模型判断什么值得记。

Include user-grounded facts and context that may have future continuity value. Stable preferences, plans, commitments, relationship changes, and meaningful events are examples only, not a whitelist; a useful detail may be remembered even when it does not match any example or preset label. Do not include greetings, fiction, guesses, secrets, passwords, codes, tokens, payment credentials, or anything created only by your reply. For an existing fact that genuinely changed, use action=update and the exact targetMemoryId from the supplied memory context; never update another persona's memory. Keep the visible reply natural and never mention this protocol.

记忆条目应尽量完整：记录用户实际提供的主题、人物、事件、上下文、前因、结果和原始时间；不知道的字段留空，绝不能补写或猜测。userEvidence 应指向用户提供的依据，不能使用角色自己的回复作为证据。已有同一事实时优先 update，不要重复创建。`

  return {
    id: nanoid(),
    contextId: MEMORY_CAPTURE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}
