import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('interactive area recommended replies', () => {
  it('shares one candidate component across page and quick-chat surfaces', () => {
    expect(source).toContain(':recommended-replies="isCollapsed ? [] : visibleRecommendedReplies"')
    expect(source).toContain('@recommended-reply-select="fillRecommendedReply"')
  })

  it('fills the composer without sending the selected reply', () => {
    expect(source).toContain('function fillRecommendedReply(reply: string) {\n  messageInput.value = reply\n}')
    expect(source).not.toContain('function fillRecommendedReply(reply: string) {\n  void handleSend')
  })

  it('persists generated candidates on their assistant message', () => {
    expect(source).toContain('!quickChatSettings.value.recommendedRepliesEnabled')
    expect(source).toContain('recommendedReplies: replies')
    expect(source).toContain('persistSessionMessages(input.sessionId, { immediate: true })')
  })

  it('reconciles candidates onto the final typed message before restart', () => {
    expect(source).toContain('belongsToRecommendedTurn')
    expect(source).toContain('attachRecommendedReplies(sessionMessages, payload.messageId, replyState!.replies)')
    expect(source).toContain('Failed to persist recommended replies after typing')
    expect(chatSource).toContain('metadata: { ...stagedMessage.metadata, recommendedReplies: [...recommendedReplies] }')
  })

  it('acknowledges recommendation billing only after candidates attach and persist', () => {
    expect(source).toContain('onRequestTrace: (requestId) => { recommendationRequestId = requestId }')
    expect(source).toContain('if (attached && recommendationRequestId)')
    expect(source).toContain('acknowledgeRecommendedRepliesDelivery(recommendationRequestId)')
  })

  it('uses the packaged visibility gate with local completion fallback', () => {
    expect(source).toContain('locallyCompletedTypingBySession')
    expect(source).toContain('handleHistoryTypingComplete')
    expect(source).toContain('const locallyCompleted = Boolean(')
    expect(source).toContain('locallyCompletedTypingBySession.value[activeSessionId.value]?.includes(lastAssistant.id)')
    expect(source).toContain('lastAssistant.metadata?.typingCompleted === false')
    expect(source).toContain('&& !lastAssistant.metadata?.recommendedReplies?.length')
    expect(source).not.toContain('|| sending.value || responding.value || groupSending.value)')
    expect(source).toContain('metadataReplies?.length ? metadataReplies : sessionReplies')
  })

  it('keeps delayed requests scoped to their turn instead of global assistant recency', () => {
    expect(source).toContain('recommendedReplyGenerationBySession')
    expect(source).toContain('requestGeneration !== (recommendedReplyGenerationBySession.value[input.sessionId] ?? 0)')
    expect(source).toContain('targetSourceUserMessageId !== sourceUserMessageId')
    expect(source).not.toContain('latestAssistant.id !== messageId')
  })

  it('matches direct turns whose assistant bubble has no speaker metadata', () => {
    expect(source).toContain('if (!speakerCharacterId)')
    expect(source).toContain('messageIndex > sourceUserIndex')
  })

  it('does not discard restored assistant messages that lack createdAt', () => {
    expect(source).toContain('message.createdAt === undefined || message.createdAt >= afterCreatedAt')
  })

  it('keeps session replies visible when a typewriter replaces a segment object', () => {
    expect(source).toContain('const sameAssistantTurn = Boolean(')
    expect(source).toContain('stateTarget.metadata.assistantTurnId === lastAssistant.metadata?.assistantTurnId')
    expect(source).toContain('sessionReplyState.assistantTurnId === lastAssistant.metadata?.assistantTurnId')
    expect(source).toContain('sessionReplyState.messageId === lastAssistant.id || sameAssistantTurn')
  })

  it('waits for the committed assistant text before starting generation', () => {
    expect(source).toContain('if (message && getRecommendedReplyAssistantText(message))')
    expect(source).toContain('const assistantText = getRecommendedReplyAssistantText(input.message)')
  })

  it('moves recommendation requests out of loading on timeout or failure', () => {
    expect(source).toContain(`type RecommendedReplyStatus = 'idle' | 'loading' | 'success' | 'failed' | 'cancelled'`)
    expect(source).toContain('RECOMMENDED_REPLY_REQUEST_TIMEOUT_MS = 30_000')
    expect(source).toContain('withRecommendedReplyTimeout(generateRecommendedReplies(')
    expect(source).toContain(`setRecommendedReplyStatus(input.sessionId, 'failed'`)
    expect(source).toContain(`setRecommendedReplyStatus(input.sessionId, 'cancelled'`)
  })

  it('starts direct preparation after provider parsing but before local playback settles', () => {
    const parserEndIndex = chatSource.indexOf('await parser.end()')
    const responseReadyIndex = chatSource.indexOf('options.onResponseReady?.()', parserEndIndex)
    const displayWaitIndex = chatSource.indexOf('await segmentedReplyPlayback', responseReadyIndex)
    expect(parserEndIndex).toBeGreaterThan(-1)
    expect(responseReadyIndex).toBeGreaterThan(parserEndIndex)
    expect(displayWaitIndex).toBeGreaterThan(responseReadyIndex)
    expect(source).toContain('onResponseReady: scheduleDirectRecommendations')
    expect(source).toContain('if (recommendationsScheduled || !providerId || !modelId)')
    expect(source).toContain('scheduleDirectRecommendations()')
  })

  it('binds group recommendations to the latest speaker that actually completed', () => {
    expect(source).toContain('const latestRecommendation = [...groupRecommendationInputs].reverse().find((input) =>')
    expect(source).toContain('Boolean(message && getRecommendedReplyAssistantText(message))')
    expect(source).toContain('hasCompletedGroupTurnResponse({')
    expect(source).toContain('groupTurnId: input.message.metadata?.speaker?.groupTurnId')
    expect(source).toContain(`message.metadata?.messageKind !== 'narration'`)
  })

  it('waits for every group speaker and narration bubble before generating recommendations', () => {
    expect(source).toContain('function hasPendingGroupTurnDisplay(input: {')
    expect(source).toContain('if (input.groupTurnId && hasPendingGroupTurnDisplay(input))')
    expect(source).toContain('speaker and narration bubble to finish its own speech/typewriter reveal')
  })

  it('uses the card avatar before the selected model preview fallback', () => {
    expect(source).toContain('const assistantIdentityAvatarUrl = computed(() => resolvePersonaContactAvatarUrl(')
    expect(source).toContain('const cardAvatar = cards.value.get(characterId)?.metadata?.avatar')
  })
})
