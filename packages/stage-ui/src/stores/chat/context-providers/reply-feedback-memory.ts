import type { ContextMessage } from '../../../types/chat'
import type { AiriReplyFeedbackMemorySummary } from '../../../types/reply-feedback'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export const REPLY_FEEDBACK_MEMORY_CONTEXT_ID = 'persona:reply-feedback-memory'

function getStrengthLabel(confidence: number) {
  if (confidence >= 0.72)
    return 'moderate'
  if (confidence >= 0.48)
    return 'light'
  return 'trace'
}

function appendSection(lines: string[], label: string, values: string[]) {
  if (!values.length)
    return

  lines.push(`${label}:`)
  lines.push(...values.map(value => `- ${value}`))
}

export function createReplyFeedbackMemoryContext(
  summary: AiriReplyFeedbackMemorySummary | null | undefined,
): ContextMessage | null {
  if (!summary?.principles.length)
    return null

  const lines = [
    '[reply-feedback-memory]',
    'priority=low',
    'authority=active-persona-card',
    `strength=${getStrengthLabel(summary.confidence)} samples=${summary.recordCount} schema=v${summary.schemaVersion}`,
    'use=soft calibration only; never mention feedback or quote internal notes',
    'scope=active persona card only; do not generalize this calibration to any other persona card',
  ]

  appendSection(lines, 'preferred-style', summary.preferredStyles || [])
  appendSection(lines, 'answering-bias', summary.answeringBiases || [])
  appendSection(lines, 'emotional-cues', summary.emotionalCues || [])
  appendSection(lines, 'avoid', summary.avoidPatterns || [])

  if (lines.length <= 6)
    lines.push(...summary.principles.map(principle => `- ${principle}`))

  return {
    id: nanoid(),
    contextId: REPLY_FEEDBACK_MEMORY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: lines.join('\n'),
    createdAt: Date.now(),
  }
}
