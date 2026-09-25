import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createVoiceCallTranscriptQueue } from '../modules/voice-call-transcripts'

const readSource = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
const interactiveAreaSource = readSource(new URL('./InteractiveArea.vue', import.meta.url))
const appSource = readSource(new URL('../App.vue', import.meta.url))
const stagePageSource = readSource(new URL('../pages/index.vue', import.meta.url))
const quickChatSource = readSource(new URL('../widgets/quick-chat/components/QuickChat.vue', import.meta.url))
const floatingRepliesSource = readSource(new URL('./stage-overlays/quick-chat-floating-replies.vue', import.meta.url))
const quickChatSettingsPageSource = readSource(new URL('../pages/settings/system/quick-chat.vue', import.meta.url))
const speechPlaybackSettingsSource = readSource(new URL('../../../../../packages/stage-ui/src/stores/settings/speech-playback.ts', import.meta.url))

describe('voice call session state', () => {
  it('does not restore an active call from persisted hearing and speech preferences', () => {
    expect(interactiveAreaSource).toContain('const voiceCallSessionActive = ref(false)')
    expect(interactiveAreaSource).toContain('voiceCallSessionActive.value = true')
    expect(interactiveAreaSource).not.toContain('computed(() => audioInputEnabled.value && speechPlayback.value.speechOutputEnabled)')
  })

  it('keeps transcription and chat ingestion in the active call window', () => {
    expect(interactiveAreaSource).toContain('setHearingStreamOwner(\'voice-call\')')
    expect(interactiveAreaSource).toContain('async function startVoiceCallTranscription()')
    expect(interactiveAreaSource).toContain('audioDeviceSettings.startStream(),')
    expect(interactiveAreaSource).toContain('hearingPipeline.transcribeForMediaStream(stream')
    expect(interactiveAreaSource).toContain('idleTimeoutMs: 0')
    expect(interactiveAreaSource).toContain('sourceSurface: \'voice-call\'')
    expect(interactiveAreaSource).toContain('disableMessageMerging: true')
    expect(interactiveAreaSource).toContain('targetSessionId: voiceCallSessionId')
    expect(interactiveAreaSource).toContain('}, options.targetSessionId)')
  })

  it('keeps voice-call interruption detection and cleanup in the active call window', () => {
    expect(interactiveAreaSource).toContain('useVAD(workletUrl')
    expect(interactiveAreaSource).toContain('speechRuntimeStore.interrupt(\'voice-call-user-speaking\')')
    expect(interactiveAreaSource).toContain('interruptActiveTurn(activeVoiceCallSessionId, \'voice-call-user-speaking\')')
    expect(interactiveAreaSource).toContain('postVoiceCallPresentEvent({ type: \'quick-chat-turn-dismiss\', turnId })')
    expect(interactiveAreaSource).toContain('clearVoiceCallAssistantSegments()')
    expect(speechPlaybackSettingsSource).toContain('continuousDetectionThreshold: 1000')
    expect(interactiveAreaSource).toContain('disposeVoiceCallVAD()')
    expect(interactiveAreaSource).toContain('resetUserSpeaking()')
    expect(stagePageSource).not.toContain('useVAD(')
  })

  it('stops shared speech when full chat or Quick Chat interrupts a turn', () => {
    expect(interactiveAreaSource).toContain('speechRuntimeStore.interrupt(\'chat-interrupt-button\')')
  })

  it('keeps completed call replies interruptible while speech and typing finish', () => {
    expect(interactiveAreaSource).toContain('postVoiceCallPresentEvent({ type: \'quick-chat-turn-complete\', turnId })\n})')
    expect(interactiveAreaSource).toContain('activeVoiceCallTurnIds.clear()\n  activeVoiceCallTurnIds.add(turnId)')
  })

  it('defers call teardown until the cancellation tool turn is committed', () => {
    const start = interactiveAreaSource.indexOf('function cancelIncomingVoiceCall()')
    const end = interactiveAreaSource.indexOf('async function acceptIncomingVoiceCall()', start)
    const cancellation = interactiveAreaSource.slice(start, end)

    expect(cancellation).toContain('voiceCallHangupState.request(')
    expect(interactiveAreaSource).toContain('const pendingHangup = voiceCallHangupState.snapshotForTurn(turnId)')
    expect(interactiveAreaSource).toContain('scheduleVoiceCallHangupAfterReply(')
    expect(interactiveAreaSource).toContain('VOICE_CALL_HANGUP_AFTER_PLAYBACK_MS = 1000')
    expect(interactiveAreaSource).toContain("event.type === 'playback-end'")
  })

  it('persists the final hangup conclusion after the settle window', () => {
    expect(interactiveAreaSource).toContain('function persistVoiceCallFinalMessage(input: {')
    expect(interactiveAreaSource).toContain('persistVoiceCallFinalMessage(input)')
    expect(interactiveAreaSource).toContain("messageId = `${input.assistantTurnId}:hangup-complete`")
    expect(interactiveAreaSource).toContain("persistSessionMessages(input.sessionId, { immediate: true })")
    const teardownIndex = interactiveAreaSource.indexOf("endVoiceCallSession()\n    // Persist only after the call teardown")
    const persistIndex = interactiveAreaSource.indexOf('persistVoiceCallFinalMessage(input)', teardownIndex)
    expect(teardownIndex).toBeGreaterThan(-1)
    expect(persistIndex).toBeGreaterThan(teardownIndex)
  })

  it('keeps final hangup text independent from speech output state', () => {
    const start = interactiveAreaSource.indexOf('if (pendingHangup) {')
    const end = interactiveAreaSource.indexOf("postVoiceCallPresentEvent({ type: 'quick-chat-turn-complete'", start)
    const hangup = interactiveAreaSource.slice(start, end)
    expect(hangup).toContain('const finalText = segments.join(\' \').trim() || acknowledgement.trim()')
    expect(hangup).toContain('scheduleVoiceCallHangupAfterReply({')
    expect(hangup).toContain('sessionId: activeVoiceCallSessionId ?? activeSessionId.value')
  })

  it('keeps the call thinking bubble visible until the whole tool turn completes', () => {
    expect(interactiveAreaSource).toContain('v-if="voiceCallWaiting"')
    expect(interactiveAreaSource).toContain('case \'quick-chat-turn-segment\':\n      appendVoiceCallAssistantSegment(event)\n      break')
  })

  it('prewarms and reuses the call VAD between calls', () => {
    expect(interactiveAreaSource).toContain('void initVoiceCallVAD()')
    expect(interactiveAreaSource).toContain('if (vadModelEnabled.value)')
    expect(interactiveAreaSource).toContain('voiceCallVADLoaded.value')
    expect(interactiveAreaSource).toContain('continuing without interruption detection')
    expect(interactiveAreaSource).toContain('stopVoiceCallVAD()')
    expect(interactiveAreaSource).toContain('disposeVoiceCallVAD()')
  })

  it('distinguishes microphone startup failures from realtime transcription failures', () => {
    expect(interactiveAreaSource).toContain('voiceCallStartupFailure(\'microphone\', error)')
    expect(interactiveAreaSource).toContain('voiceCallStartupFailure(\'transcription\', error)')
    expect(interactiveAreaSource).toContain('voiceCallTranscriptionErrorText(message)')
    expect(interactiveAreaSource).toContain('ASR_SESSION_START_RATE_LIMITED')
  })

  it('only marks a call active after hearing is ready and waits for the prior call to release', () => {
    const start = interactiveAreaSource.indexOf('async function startVoiceCallTranscription()')
    const active = interactiveAreaSource.indexOf('voiceCallSessionActive.value = true', start)
    const transcription = interactiveAreaSource.indexOf('if (!await startVoiceCallTranscription())', start)

    expect(interactiveAreaSource).toContain('voiceCallTranscriptionStop,')
    expect(interactiveAreaSource).toContain('voiceCallTranscriptionStop = hearingPipeline.stopStreamingTranscription(false)')
    expect(transcription).toBeGreaterThan(start)
    expect(active).toBeGreaterThan(transcription)
  })

  it('interrupts call playback when ASR returns a sentence without local VAD', () => {
    expect(interactiveAreaSource).toContain('interruptVoiceCallOutput(\'voice-call-asr-user-speaking\')')
    expect(interactiveAreaSource).toContain('onSentenceEnd: (text) => {')
    expect(interactiveAreaSource).toContain('voiceCallHangupState.supersedeForNewInput()')
    expect(interactiveAreaSource).not.toContain('isVoiceCallHangupCancellationText')
  })

  it('lets the main reply semantically keep a pending call open', () => {
    expect(interactiveAreaSource).toContain('voiceCallSessionActive.value && voiceCallHangupState.isPending()')
    expect(interactiveAreaSource).toContain('createVoiceCallTools(inviteVoiceCall, cancelIncomingVoiceCall, keepVoiceCallOpen)')
    expect(interactiveAreaSource).toContain('function keepActiveVoiceCallOpen()')
    expect(interactiveAreaSource).toContain('voiceCallHangupState.clear()')
  })

  it('bounds microphone and stale transcription startup so the call spinner cannot hang forever', () => {
    expect(interactiveAreaSource).toContain('VOICE_CALL_STREAM_TIMEOUT_MS = 5000')
    expect(interactiveAreaSource).toContain('VOICE_CALL_STOP_TIMEOUT_MS = 3000')
    expect(interactiveAreaSource).toContain('VOICE_CALL_TRANSCRIPTION_TIMEOUT_MS = 10000')
    expect(interactiveAreaSource).toContain('until(audioInputStream).toBeTruthy')
    expect(interactiveAreaSource).toContain('!voiceCallOwnsHearingStream')
    expect(interactiveAreaSource).toContain('Promise.race([')
    expect(interactiveAreaSource).toContain('new Promise<void>(resolve => setTimeout(resolve, VOICE_CALL_STOP_TIMEOUT_MS))')
  })

  it('allows cancelling a call while microphone or ASR startup is pending', () => {
    expect(interactiveAreaSource).toContain('if (voiceCallStarting.value) {')
    expect(interactiveAreaSource).toContain('voiceCallStartupCancelled = true')
    expect(interactiveAreaSource).toContain('voiceCallLifecycleToken += 1')
  })

  it('correlates call, ASR session, and transcript turns without recording transcript content', () => {
    expect(interactiveAreaSource).toContain('console.info(\'[VoiceCallLifecycle]\'')
    expect(interactiveAreaSource).toContain('sourceSurface: \'voice-call\'')
    expect(interactiveAreaSource).toContain('traceVoiceCall(\'transcript-turn-created\', { turnId })')
    expect(interactiveAreaSource).toContain('callId: voiceCallTraceId')
    expect(interactiveAreaSource).not.toContain('traceVoiceCall(\'transcript-turn-created\', { text')
  })

  it('mounts the speech runtime for full chat and Quick Chat', () => {
    expect(appSource).toContain('computed(() => isChatRoute.value || isQuickChatRoute.value)')
  })

  it('releases only the hearing ownership acquired by this call window', () => {
    expect(interactiveAreaSource).toContain('let voiceCallOwnsHearingStream = false')
    expect(interactiveAreaSource).toContain('voiceCallOwnsHearingStream = true')
    expect(interactiveAreaSource).toContain('voiceCallOwnsHearingStream && isCurrentWindowHearingStreamOwner()')
    expect(interactiveAreaSource).toContain('if (!voiceCallSessionActive.value && !voiceCallOwnsHearingStream)')
    expect(interactiveAreaSource).toContain('if (!voiceCallOwnsHearingStream)')
  })

  it('exposes the persisted floating-reply switch in expanded chat, Quick Chat, voice call, and settings', () => {
    expect(interactiveAreaSource).toContain('data-floating-replies-toggle="chat"')
    expect(interactiveAreaSource).toContain('data-floating-replies-toggle="quick-chat"')
    expect(interactiveAreaSource).toContain('data-floating-replies-toggle="voice-call"')
    expect(interactiveAreaSource.match(/quickChatSettingsStore\.setFloatingRepliesEnabled/g)).toHaveLength(3)
    expect(quickChatSettingsPageSource).toContain(':model-value="settings.floatingRepliesEnabled"')
    expect(quickChatSettingsPageSource).toContain('@update:model-value="quickChatSettingsStore.setFloatingRepliesEnabled"')
  })

  it('clears visible floating bubbles when the shared switch is disabled', () => {
    expect(floatingRepliesSource).toContain('watch(() => quickChatSettings.value.floatingRepliesEnabled, (enabled) => {')
    expect(floatingRepliesSource).toContain('dismissAll()\n  activePresentationMode.value = undefined\n}, { flush: \'sync\' })')
  })

  it('routes only matching call turns back to the active call window', () => {
    expect(interactiveAreaSource).toContain('const stopVoiceCallTurnHook = chatOrchestrator.onChatTurnComplete')
    expect(interactiveAreaSource).toContain('context.internal?.sourceSurface !== \'voice-call\'')
    expect(interactiveAreaSource).toContain('activeVoiceCallTurnIds.delete(turnId)')
    expect(interactiveAreaSource).toContain('sourceUserMessageId: turnId')
    expect(stagePageSource).not.toContain('transcribeForMediaStream')
    expect(stagePageSource).not.toContain('sourceSurface: \'voice-call\'')
  })

  it('uses the complete configured chat pipeline for typed and voice-call turns', () => {
    expect(interactiveAreaSource).toContain('async function sendConfiguredChatMessage(')
    expect(interactiveAreaSource).toContain('await sendConfiguredChatMessage(text, {')
    expect(interactiveAreaSource).toContain('await sendConfiguredChatMessage(textToSend, {')
    expect(interactiveAreaSource).toContain('providerConfig,')
    expect(interactiveAreaSource).toContain('toolBundles,')
    expect(interactiveAreaSource).toContain('memoryContextMode: \'automatic\'')
    expect(interactiveAreaSource).toContain('workspaceAccess: \'full\'')
    expect(interactiveAreaSource).toContain('hasPendingWorkspaceEditProposal: hasPendingDesktopTextEditProposal()')
    expect(interactiveAreaSource).toContain('toolBundleRoutingMode: toolBundleBuildResult.intent.wantsButlerTasks ? \'eager\' : \'auto\'')
    expect(interactiveAreaSource).not.toContain('toolBundleRoutingMode: \'eager\'')
    expect(interactiveAreaSource).not.toContain('memoryContextMode: semanticMemoryEnabled.value ? \'tool\' : \'disabled\'')
  })

  it('types call reply segments sequentially on one speech-synced timeline', () => {
    expect(interactiveAreaSource).toContain('const voiceCallTypingQueue:')
    expect(interactiveAreaSource).toContain('function runNextVoiceCallTypingSegment()')
    expect(interactiveAreaSource).toContain('if (voiceCallTypingTimer || voiceCallTypingQueue.length === 0)')
    expect(interactiveAreaSource).not.toContain('const voiceCallTypingTimers = new Map')
  })

  it('resets call-only content and uses an opaque call surface', () => {
    expect(interactiveAreaSource).toContain('function resetVoiceCallSurface()')
    expect(interactiveAreaSource).toContain('resetVoiceCallSurface()')
    expect(interactiveAreaSource).toContain('bg-[var(--airi-surface-panel-base)]')
  })

  it('drives the Quick Chat call layout from the current child session', () => {
    expect(quickChatSource).toContain('const voiceCallActive = ref(false)')
    expect(quickChatSource).toContain('@voice-call-active-change="handleVoiceCallActiveChange"')
    expect(quickChatSource).not.toContain('audioInputEnabled.value && speechPlaybackSettingsStore.settings.speechOutputEnabled')
  })

  it('restores expanded window bounds when a compact call ends', () => {
    expect(quickChatSource).toMatch(/if \(!active && voiceCallCompact\.value\) \{\s+voiceCallCompact\.value = false\s+scheduleWindowBoundsSync\(\)/)
  })

  it('serializes immutable voice transcripts exactly once and in order', async () => {
    const received: Array<{ text: string, turnId: string }> = []
    let id = 0
    const enqueue = createVoiceCallTranscriptQueue(async (transcript) => {
      await Promise.resolve()
      received.push(transcript)
    }, () => `turn-${++id}`)

    await Promise.all([enqueue(' first '), enqueue('second'), enqueue('')])

    expect(received).toEqual([
      { text: 'first', turnId: 'turn-1' },
      { text: 'second', turnId: 'turn-2' },
    ])
    expect(Object.isFrozen(received[0]!)).toBe(true)
  })
})
