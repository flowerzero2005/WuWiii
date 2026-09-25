import type { MemoryExtractionResult, MemoryExtractionRuntime } from './memory-extractor'

import { analyzeMessageImportance } from './memory-heuristics'

const SECRET_OR_CREDENTIAL_RE = /password|passcode|验证码|密码|私钥|private\s+key|api\s*key|token|信用卡|银行卡/iu
const DURABLE_STATEMENT_RE = /^\s*(?:我|我的|平时我|通常我|一直都|i|my|usually i|i always)\s+.{1,120}(?:喜欢|爱吃|爱喝|讨厌|不喜欢|习惯|偏好|是|住在|来自|从事|计划|打算|准备|希望|prefer|like|love|hate|usually|plan|intend)\b/iu
const AI_SETTING_PATTERNS = [
  /你([是叫要会得]|的名字|应该|需要|可以)/,
  /你的(名字|性格|角色|设定|特点)/,
  /把你(叫|称为|当作|设定为)/,
  /称呼你/,
  /叫你/,
  /扮演|角色|人设|性格|特点/,
  /你要(表现|展现|体现)/,
  /你(不能|不要|不可以|禁止|必须|一定要)/,
  /规则|要求|限制/,
  /你(能|会|可以|擅长|精通)/,
]

function createHeuristicMemoryResult(
  heuristicResult: ReturnType<typeof analyzeMessageImportance>,
  reasonPrefix = '匹配规则',
) {
  return {
    shouldRemember: true,
    importance: heuristicResult.importance,
    summary: heuristicResult.summary,
    tags: heuristicResult.tags,
    reason: `${reasonPrefix}：${heuristicResult.matchedRules.map(r => r.description).join(', ')}`,
  }
}

export async function hybridMemoryExtraction(
  userMessage: string,
  assistantMessage: string,
  _trace?: unknown,
  _runtime?: MemoryExtractionRuntime,
): Promise<MemoryExtractionResult | null> {
  // Memory maintenance runs after the reply and must not create a second paid
  // model request. The primary reply owns the model decision; this local pass
  // only persists an explicit, user-authored durable fact. The assistant text
  // is intentionally ignored because it cannot establish a user fact.
  if (!userMessage.trim() || !assistantMessage.trim() || SECRET_OR_CREDENTIAL_RE.test(userMessage))
    return null

  const heuristicResult = analyzeMessageImportance(userMessage)
  // Broaden the local safety fallback beyond the keyword table: a concise
  // first-person durable statement is a useful candidate even when wording is
  // unfamiliar. This is still conservative and never treats assistant prose
  // as evidence; the primary reply remains the intended semantic judge.
  if (!heuristicResult.shouldRemember && DURABLE_STATEMENT_RE.test(userMessage)) {
    heuristicResult.shouldRemember = true
    heuristicResult.importance = 'medium'
    heuristicResult.summary = userMessage.trim().slice(0, 160)
    heuristicResult.tags = Array.from(new Set([...heuristicResult.tags, 'durable-user-statement']))
  }

  // 检测是否是 AI 设定相关的记忆
  const isAiSetting = detectAiSetting(userMessage)
  if (isAiSetting) {
    // 确保包含 AI设定 标签
    if (!heuristicResult.tags.includes('AI设定')) {
      heuristicResult.tags.push('AI设定')
    }
  }

  return heuristicResult.shouldRemember
    ? createHeuristicMemoryResult(heuristicResult, '本地语义候选（主回复已完成）')
    : null
}

/**
 * 检测用户消息是否是对 AI 的设定
 * 返回 true 表示这是用户对 AI 的设定或期望
 */
function detectAiSetting(userMessage: string): boolean {
  const text = userMessage.toLowerCase()
  return AI_SETTING_PATTERNS.some(pattern => pattern.test(text))
}
