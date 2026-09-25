import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const historySource = readFileSync(new URL('./history.vue', import.meta.url), 'utf8')
const assistantSource = readFileSync(new URL('./assistant-item.vue', import.meta.url), 'utf8')

describe('chat typewriter completion bridge', () => {
  it('forwards local assistant typing completion to the chat surface', () => {
    expect(assistantSource).toContain('(event: \'typingComplete\', payload: { messageId: string })')
    expect(assistantSource).toContain('emit(\'typingComplete\', { messageId: props.message.id })')
    expect(historySource).toContain('(event: \'typingComplete\', payload: { messageId: string, sessionId: string })')
    expect(historySource).toContain('handleTypingComplete')
  })

  it('acknowledges official chat delivery only after persisted text is visibly rendered', () => {
    expect(assistantSource).toContain('(event: \'deliveryVisible\', payload: { messageId: string, requestId: string })')
    expect(assistantSource).toContain('ready !== true')
    expect(assistantSource).toContain('!text.trim()')
    expect(historySource).toContain('acknowledgeOfficialCloudChatDelivery(payload.requestId)')
    expect(historySource).toContain('@delivery-visible="handleDeliveryVisible"')
  })

  it('keeps the initial scroll pending until restored session messages render', () => {
    expect(historySource).toContain('watch(currentSessionId, queueInitialSessionScroll, { flush: \'post\' })')
    expect(historySource).toContain('pendingInitialScrollSessionId = currentSessionId.value || undefined')
    expect(historySource).toContain('scrollToBottom(true)')
  })

  it('forces the current conversation to its latest message when the user sends', () => {
    expect(historySource).toContain('const latestUserMessageScrollKey = computed(() =>')
    expect(historySource).toContain('watch(latestUserMessageScrollKey, (key, previousKey) =>')
    expect(historySource).toContain('isPinnedToBottom.value = true')
    expect(historySource).toContain('scrollToBottom(true)')
  })

  it('observes rendered typewriter text so wrapped lines keep following the bottom', () => {
    expect(historySource).toContain('historyContentObserver = new MutationObserver(() => scrollToBottom())')
    expect(historySource).toContain('characterData: true')
    expect(historySource).toContain('historyContentObserver?.disconnect()')
  })

  it('follows the first desktop layout resize after restoring a session', () => {
    expect(historySource).toContain('historyViewportObserver = new ResizeObserver(() => scrollToBottom())')
    expect(historySource).toContain('observeHistoryViewport()')
    expect(historySource).toContain('historyViewportObserver?.disconnect()')
  })
})
