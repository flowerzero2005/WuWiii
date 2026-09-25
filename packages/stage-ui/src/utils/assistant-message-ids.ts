export function resolveAssistantSegmentMessageId(assistantTurnId: string, segmentIndex: number) {
  return segmentIndex === 0
    ? assistantTurnId
    : `${assistantTurnId}:segment:${segmentIndex}`
}

export function buildAssistantSegmentMessageIds(assistantTurnId: string, segmentCount: number) {
  return Array.from({ length: Math.max(0, segmentCount) }, (_, segmentIndex) => {
    return resolveAssistantSegmentMessageId(assistantTurnId, segmentIndex)
  })
}

/** Separate rendered tool phases while retaining one logical assistant turn. */
export function buildToolReplyMessageIds(assistantTurnId: string) {
  return {
    acknowledgementMessageId: `${assistantTurnId}:tool-acknowledgement`,
    conclusionMessageId: `${assistantTurnId}:tool-conclusion`,
  }
}
