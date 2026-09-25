import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./chat-speech-runtime.vue', import.meta.url), 'utf8')

describe('chat speech billing trace', () => {
  it('forwards the owning chat turn trace to each official speech request', () => {
    expect(source).toContain('requestHeaders: createChatTraceHeaders(undefined, requestTrace)')
    expect(source).toContain('characterName: turn.speaker?.displayName')
    expect(source).toContain('groupTurnId: turn.speaker?.groupTurnId')
    expect(source).toContain('roomName: turn.speaker?.roomName ?? context.internal?.roomName')
    expect(source).toContain('characterName: context.turn?.speaker?.displayName')
    expect(source).toContain('groupTurnId: context.turn?.speaker?.groupTurnId')
    expect(source).toContain('roomName: context.turn?.speaker?.roomName ?? context.internal?.roomName')
  })

  it('releases speech-gated text immediately when speech is disabled or playback fails', () => {
    expect(source).toContain(`cancelChatSpeechIntents('speech-output-disabled')`)
    expect(source).toContain('playbackManager.onInterrupt(({ item, reason }) => {')
    expect(source).toContain('playbackManager.onReject(({ item, reason }) => {')
    expect(source).toContain('speechDisplaySyncStore.markIntentCancel({ intentId: item.intentId, reason })')
    expect(source).toMatch(/speechPipeline\.on\('onIntentCancel',[\s\S]*?clearSpeechPlaybackBarrier\(intentId\)/)
  })

  it('defers group TTS synthesis until all primary speaker requests settle', () => {
    expect(source).toContain('speechSynthesisBarrierByIntentId.set(speechSnapshot.intentId, context.internal.groupSpeechSynthesisBarrier)')
    const ttsGateIndex = source.indexOf('await groupSynthesisBarrier.catch(() => undefined)')
    const providerIndex = source.indexOf('providersStore.getProviderInstance(providerId)', ttsGateIndex)
    const requestIndex = source.indexOf('generateChatSpeechWithRateLimit({', ttsGateIndex)
    expect(ttsGateIndex).toBeGreaterThan(-1)
    expect(providerIndex).toBeGreaterThan(ttsGateIndex)
    expect(requestIndex).toBeGreaterThan(providerIndex)
  })

  it('waits for direct narrator audio before starting role playback', () => {
    const playbackBarrierIndex = source.indexOf('const groupPlaybackBarrier =')
    const narratorBarrierIndex = source.indexOf('await waitForGroupNarrationPlaybackIdle()', playbackBarrierIndex)

    expect(playbackBarrierIndex).toBeGreaterThan(-1)
    expect(narratorBarrierIndex).toBeGreaterThan(-1)
    expect(narratorBarrierIndex).toBeGreaterThan(playbackBarrierIndex)
  })

  it('does not open group whole speech from stream-end before its display turn', () => {
    const streamEndStart = source.indexOf('chatHookCleanups.push(onStreamEnd(async (context) => {')
    const streamEndEnd = source.indexOf('chatHookCleanups.push(onAssistantResponseEnd', streamEndStart)
    const streamEndHook = source.slice(streamEndStart, streamEndEnd)

    expect(streamEndHook).toContain('if (!context.internal?.groupChat && state.segmentation === \'streaming\')')
    expect(streamEndHook).not.toContain('speechRuntimeStore.openIntent({')
  })

  it('opens each queued group whole intent at most once', () => {
    const openStart = source.indexOf('chatHookCleanups.push(onGroupWholeSpeechOpen(async (context) => {')
    const openEnd = source.indexOf('chatHookCleanups.push(onStreamEnd', openStart)
    const openHook = source.slice(openStart, openEnd)
    const guardIndex = openHook.indexOf('if (state.handle)')
    const openIntentIndex = openHook.indexOf('speechRuntimeStore.openIntent({')

    expect(guardIndex).toBeGreaterThan(-1)
    expect(openIntentIndex).toBeGreaterThan(guardIndex)
  })

  it('forwards the frozen selection when a direct whole reply opens after streaming', () => {
    const responseEndStart = source.indexOf('chatHookCleanups.push(onAssistantResponseEnd(async (_message, context) => {')
    const responseEndEnd = source.indexOf('onUnmounted(() => {', responseEndStart)
    const responseEndHook = source.slice(responseEndStart, responseEndEnd)
    const directWholeStart = responseEndHook.indexOf('if (state.segmentation === \'whole\' && context.speech?.finalText)')
    const directWholeEnd = responseEndHook.indexOf('state.handle?.end()', directWholeStart)
    const directWholeOpen = responseEndHook.slice(directWholeStart, directWholeEnd)

    expect(directWholeOpen).toContain('selection: speechSnapshot.selection')
    expect(directWholeOpen).toContain('tone: speechSnapshot.tone')
  })

  it('keeps pending direct whole speech cancellable by the next user turn', () => {
    const responseEndStart = source.indexOf('chatHookCleanups.push(onAssistantResponseEnd(async (_message, context) => {')
    const responseEndEnd = source.indexOf('onUnmounted(() => {', responseEndStart)
    const responseEndHook = source.slice(responseEndStart, responseEndEnd)
    const directBranchStart = responseEndHook.indexOf('if (state.segmentation === \'whole\' && context.speech?.finalText)')
    const directBranch = responseEndHook.slice(directBranchStart)

    expect(directBranch).toContain('state.handle?.end()')
    expect(directBranch).not.toContain('chatSpeechIntents.delete(intentId)')
    expect(source).toMatch(/cancelChatSpeechIntents\('new-message'\)/)
  })

  it('cancels display sync for a group whole intent that never opened', () => {
    const cancelStart = source.indexOf('function cancelChatSpeechIntents(reason: string) {')
    const cancelEnd = source.indexOf('speechPipeline.on(\'onTtsResult\'', cancelStart)
    const cancelFunction = source.slice(cancelStart, cancelEnd)

    expect(cancelFunction).toContain('if (state.handle)')
    expect(cancelFunction).toContain('clearSpeechPlaybackBarrier(intentId)')
    expect(cancelFunction).toContain('speechDisplaySyncStore.markIntentCancel({ intentId, reason })')
    expect(source).toMatch(/speechPipeline\.on\('onIntentEnd',[\s\S]*?clearSpeechPlaybackBarrier\(intentId\)/)
  })
})
