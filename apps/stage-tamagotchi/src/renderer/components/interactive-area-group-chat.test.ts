import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8')
const mentionPickerSource = readFileSync(new URL('./group-mention-picker.vue', import.meta.url), 'utf8')

describe('interactive area group chat UI', () => {
  it('exposes group creation and member controls on quick chat too', () => {
    expect(source).toContain('v-if="groupCreateOpen"')
    expect(source).not.toContain('v-if="groupCreateOpen && !isWidgetSurface"')
    expect(source).toContain('t(\'stage.chat.group.add-member\'')
    expect(source).toContain('t(\'stage.chat.group.remove-member\'')
  })

  it('requires an explicit responder before sending to a room', () => {
    expect(source).toContain('groupResponderIds.value = []')
    expect(source).toContain('&& (!activeGroupMeta.value || groupResponderIds.value.length > 0)')
  })

  it('keeps the four-member responder and participant limits in the UI', () => {
    expect(source).toContain('GROUP_CHAT_MAX_RESPONDERS')
    expect(source).toContain('groupResponderIds.value.length < GROUP_CHAT_MAX_RESPONDERS')
    expect(source).toContain('GROUP_CHAT_MAX_PARTICIPANTS')
    expect(source).toContain('groupCreateCharacterIds.length < GROUP_CHAT_MIN_PARTICIPANTS')
  })

  it('keeps the group responder bar collapsible so it does not cover chat history', () => {
    expect(source).toContain('const groupHeaderCollapsed = ref(true)')
    expect(source).toContain('groupHeaderCollapsed = !groupHeaderCollapsed')
    expect(source).toContain('v-if="!groupHeaderCollapsed" class="mt-2 flex flex-wrap gap-1.5"')
  })

  it('keeps a group script settings entry available while the group bar is collapsed', () => {
    expect(source).toContain('await openSettings({ route: \'/settings/group-scenarios\' })')
    expect(source).toContain('t(\'stage.chat.group.script-settings\')')
    expect(source).toContain('@click="openGroupScriptSettings"')

    const buttonIndex = source.indexOf('@click="openGroupScriptSettings"')
    const button = source.slice(source.lastIndexOf('<button', buttonIndex), buttonIndex)
    expect(button).not.toContain('v-if="!groupHeaderCollapsed"')
  })

  it('shows one actionable narration speech warning per room turn', () => {
    expect(source).toContain('let narrationSpeechWarningShown = false')
    expect(source).toContain('onNarrationSpeechUnavailable: (reason) =>')
    expect(source).toContain('\'stage.chat.group.narration-speech-not-configured\'')
    expect(source).toContain('\'stage.chat.group.narration-speech-failed\'')
  })

  it('freezes all public script relationships for the narrator request', () => {
    expect(source).toContain('buildGroupScriptRoomRelationships(groupRoomScriptSnapshot, groupRoomMembers)')
    expect(source).toContain('roomRelationships: groupTurnRelationships')
  })

  it('uses one delete confirmation handler without capture duplication', () => {
    expect(source).toContain('@click="confirmGroupDelete"')
    expect(source).not.toContain('@click.capture="confirmGroupDelete"')
  })

  it('uses bound model previews and keeps initials as an image-failure fallback', () => {
    expect(source).toContain('v-if="getParticipantAvatarUrl(contact.characterId, contact.avatarUrl)"')
    expect(source).toContain('const defaultModelPreview = displayModels.value.find(model => model.id === DEFAULT_STAGE_MODEL_ID)?.previewImage')
    expect(source).toContain('const assistantIdentityAvatarUrl = computed(() => resolvePersonaContactAvatarUrl(')
    expect(source).toContain('const cardAvatar = cards.value.get(characterId)?.metadata?.avatar')
    expect(source).toContain('{{ getPersonaContactInitial(contact) }}')
    expect(source).not.toContain('const activeModelPreview = characterId === activeCardId.value')
    expect(source).not.toContain('if (characterId === activeCardId.value && stageModelSelected.value)')
  })

  it('does not keep the interrupt action visible for a stale sending flag', () => {
    expect(source).toContain('activeGroupRun.value?.phase === \'running\'')
    expect(source).toContain('activeGroupRun.value.speaker?.phase !== \'draining\'')
    expect(source).toContain('responding.value\n    && activeTurnSessionId.value === activeSessionId.value')
    expect(source).not.toContain('const canInterrupt = computed(() => groupSending.value\n  || sending.value')
  })

  it('keeps group ownership until the matching send finally drains', () => {
    expect(source).toContain('activeGroupRun.value = drainGroupTurn(groupRun, groupRun.runId)')
    expect(source).toContain('const ownsGroupRun = activeGroupRunId.value === groupTurnId')
    expect(source).toContain('activeGroupRun.value = finishGroupTurn(activeGroupRun.value, groupTurnId)')
    expect(source).not.toContain('activeGroupRunId.value = undefined\n  groupSending.value = false')
  })

  it('uses per-speaker idle cancellation so one timeout does not abort later responders', () => {
    expect(source).toContain('const speakerAbortController = new AbortController()')
    expect(source).toContain('abortSignal: speakerAbortController.signal')
    expect(source).toContain('speakerAbortController.signal.reason === \'group-speaker-watchdog\'')
    expect(source).toContain('continue')
    expect(source).not.toContain('groupAbortController.value?.abort(\'group-turn-watchdog\')')
  })

  it('treats a staged speech-context reply as accepted output', () => {
    const watchdogStart = source.indexOf('function scheduleGroupSpeakerWatchdog')
    const watchdogBranch = source.slice(watchdogStart, source.indexOf('function noteGroupTurnProgress', watchdogStart))
    const speakerRequestErrorIndex = source.indexOf('logGroupDiagnostic(\'speaker-request-error\'')
    const requestCatchStart = source.lastIndexOf('catch (error) {', speakerRequestErrorIndex)
    const requestCatch = source.slice(requestCatchStart, source.indexOf('finally {', requestCatchStart))

    expect(watchdogBranch).toContain('const hasStagedSpeakerOutput = Boolean(')
    expect(watchdogBranch).toContain('const hasConfirmedSpeakerOutput = Boolean(')
    expect(watchdogBranch).toContain('message.metadata?.speaker?.groupTurnId === groupTurnId')
    expect(watchdogBranch.indexOf('if (hasStagedSpeakerOutput || hasConfirmedSpeakerOutput)')).toBeLessThan(watchdogBranch.indexOf('groupSpeakerAbortController.value?.abort(\'group-speaker-watchdog\')'))
    expect(source).toContain('speakerAbortController.signal.reason === \'group-speaker-watchdog\' && !hasAcceptedSpeakerOutput()')
    expect(requestCatch).toContain('hasSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)')
    expect(requestCatch).toContain('hasCompletedGroupTurnResponse(recoveryInput)')
    expect(source).toContain('const hasAcceptedSpeakerOutput = () => hasSpeakerResponseMessage(')
  })

  it('renews the 90-second speaker watchdog from real turn progress', () => {
    expect(source).toContain('GROUP_SPEAKER_IDLE_TIMEOUT_MS')
    expect(source).toContain('onProgress: () => noteGroupTurnProgress(groupTurnId, characterId)')
    expect(source).toContain('interruptActiveTurn(roomSessionId, \'group-speaker-watchdog\', { scope: \'active-turn\' })')
    expect(source).toContain('interruptActiveTurn(groupRun.sessionId, \'chat-interrupt-button\')')
  })

  it('retains the settled speaker ledger for late final typing and playback callbacks', () => {
    expect(source).toContain('const settledGroupRun = ref<GroupTurnRunState>()')
    expect(source).toContain('if (settledGroupRun.value?.runId === groupTurnId)')
    expect(source.indexOf('settledGroupRun.value = activeGroupRun.value')).toBeLessThan(source.indexOf('activeGroupRun.value = finishGroupTurn(activeGroupRun.value, groupTurnId)'))
    expect(source).toContain('noteGroupSpeakerLifecycle(speaker.groupTurnId, speaker.characterId, \'typing-completed\')')
    expect(source).toContain('\'speech-playback-completed\', event.emittedAt')
  })

  it('keeps request persona and header avatar bound to the exact group speaker card', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
    expect(source).toContain('const runtime = airiCardStore.getCardRuntime(characterId)')
    expect(source).toContain('currentGroupSpeakerId.value = characterId')
    expect(source).toContain('const currentGroupSpeakerParticipant = computed(() => {')
    expect(source).toContain('return resolvePersonaContactAvatarUrl(')
    expect(source).toContain('currentGroupSpeakerParticipant.value?.displayModelId ?? currentGroupSpeakerRuntime.value?.displayModelId')
    expect(source).toContain('displayModelId: resolvePersonaContactAvatarModelId(characterId, participant?.displayModelId)')
    expect(source).toContain(':assistant-avatar-url="currentGroupSpeakerAvatarUrl ?? assistantIdentityAvatarUrl"')
    expect(source).toContain(':assistant-avatar-model-id="currentGroupSpeakerAvatarModelId ?? assistantIdentityAvatarModelId"')
    expect(chatSource).toContain('const turnPersonaRuntime = groupRuntime')
    expect(chatSource).toContain('const requestedPersonaCardId = groupRuntime?.characterId')
  })

  it('resolves normal and quick-chat pending avatars from the active session contact', () => {
    expect(source).toContain('const activeSessionMeta = computed(() => chatSession.getSessionMeta(activeSessionId.value))')
    expect(source).toContain('return session?.characterId || activeCardId.value || \'default\'')
    expect(source).toContain('airiCardStore.getCardRuntime(assistantIdentityCharacterId.value)')
    expect(source).toContain('resolvePersonaContactAvatarUrl(\n  assistantIdentityCharacterId.value,')
    expect(source).toContain('resolvePersonaContactAvatarModelId(\n  assistantIdentityCharacterId.value,')
    expect(source).toContain('!activeGroupMeta && contact.characterId === assistantIdentityCharacterId')
    expect(source.match(/:model-id="getParticipantAvatarModelId\(contact\.characterId\)"/g)).toHaveLength(2)
  })

  it('does not switch the stage model while a group speaker replies', () => {
    expect(source).not.toContain('stageModelSettings.setStageModelOverride')
    expect(source).not.toContain('stageModelSettings.applyPersonaDisplayModel(nextModelId)')
    expect(source).not.toContain('stageModelSettings.refreshStageView()')
  })

  it('freezes each group speaker voice selection before starting the turn', () => {
    expect(source).toContain('speech: runtime.speech ? { ...runtime.speech } : null')
    expect(source).toContain('groupTurnId')
    expect(source).toContain('sourceUserMessageId')
  })

  it('resolves one room script snapshot per turn and freezes public member roles', () => {
    expect(source.match(/chatSession\.resolveGroupRoomScript\(roomSessionId\)/g)).toHaveLength(1)
    const resolveIndex = source.indexOf('await chatSession.resolveGroupRoomScript(roomSessionId)')
    const turnLockIndex = source.indexOf('activeGroupRun.value = startGroupTurn', source.indexOf('async function handleGroupSend'))
    const providerLoopIndex = source.indexOf('for (const characterId of responderIds)', resolveIndex)
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(resolveIndex).toBeGreaterThan(turnLockIndex)
    expect(providerLoopIndex).toBeGreaterThan(resolveIndex)
    expect(source).toContain('buildGroupScriptRoomMembers(groupRoomScriptSnapshot, groupRoomMembers)')
    expect(source).toContain('buildGroupScriptSpeakerContext(groupRoomScriptSnapshot, characterId, groupTurnMembers)')
    expect(source).toContain('members: groupTurnMembers')
    expect(source).toContain('scriptContext,')
  })

  it('keeps mentions separate from responder selection and clears them after send', () => {
    expect(source).toContain('const groupMentionedIds = ref<string[]>([])')
    expect(source).toContain('const mentionedCharacterIds = [...groupMentionedIds.value]')
    expect(source).toContain('mentionedCharacterIds,')
    expect(source.match(/<GroupMentionPicker/g)).toHaveLength(2)
    expect(source.match(/v-model:selected-ids="groupMentionedIds"/g)).toHaveLength(2)
    expect(mentionPickerSource).toContain('t(\'stage.chat.group.mention-members\')')
    expect(mentionPickerSource).toContain('t(\'stage.chat.group.mention-hint\')')
    expect(mentionPickerSource).toContain('emit(\'update:selectedIds\', selectedIds)')
    expect(mentionPickerSource).not.toContain('groupResponderIds')
    expect(mentionPickerSource).not.toContain('resolveGroupResponderIds')
    expect(source).toContain('groupMentionedIds.value = []')
  })

  it('does not accept a prior speaker response when this speaker returned no text', () => {
    expect(source).toContain('if (sourceUserMessageId)')
    // 12.2：仍按 sourceUserMessageId 匹配且绝不回落上一位说话人；本轮在该匹配上
    // 增加 speakerCharacterId 区分与 speechDisplayPending 排除（12.2/13 收尾）。
    expect(source).toContain('speaker?.sourceUserMessageId !== sourceUserMessageId')
    expect(source).toContain('speakerCharacterId && speaker.characterId !== speakerCharacterId')
    expect(source).toContain('includeSpeechPending || !message.metadata?.speechDisplayPending')
    expect(source).not.toContain('?? assistantMessages.at(-1)')
  })

  it('recognizes the structured LLM empty result as a silent group speaker', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toContain('code: \'LLM_EMPTY_RESULT\'')
    expect(source).toContain('(error as { code?: unknown }).code === \'LLM_EMPTY_RESULT\'')
  })

  it('recovers user-visible group text when marker parsing consumed the draft', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toContain('const recoveredCompletedText = groupRuntime && !parsedVisibleText')
    expect(chatSource).toContain('? createReadableFinalText(rawProviderText, turnProviderId)')
    expect(chatSource).not.toContain('createReadableFinalText(rawProviderText, turnProviderId) || completedText')
    expect(chatSource).toContain('rawProviderText += event.text')
  })

  it('re-inserts the current room prompt after context trimming', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toContain('Context fitting can remove the room\'s source user message')
    expect(chatSource).toContain('const hasLatestRoomPrompt = promptBeforeInstruction?.role === \'user\'')
    expect(chatSource).toContain('newMessages.splice(insertionIndex, 0, { role: \'user\', content: sendingMessage })')
  })

  it('passes the exact room-turn user text outside the persisted transcript', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat/group-chat.ts', import.meta.url), 'utf8')
    expect(chatSource).toContain('currentUserMessage?: string')
    expect(chatSource).toContain('Latest real user message:')
    expect(source).toContain('currentUserMessage: textToSend')
  })

  it('never restores internal-only group output or uses it for recommendations', () => {
    expect(source).toContain('const readableOutputText = createReadableFinalText(outputText, context.turn?.persona?.providerId)')
    expect(source).toContain('const readableText = createReadableFinalText(candidate || \'\')')
    expect(source).not.toContain('function restoreCompletedGroupTurnResponse')
  })

  it('waits for an actual staged or visible speaker before recommendation polling', () => {
    expect(source).toContain('groupTurnId?: string')
    const pollSource = source.slice(
      source.indexOf('function scheduleRecommendedRepliesWhenAvailable'),
      source.indexOf('function hasSpeakerResponseMessage'),
    )
    expect(pollSource).toContain('const message = storedMessage')
    expect(pollSource).not.toContain('restoreCompletedGroupTurnResponse')
  })

  it('does not warn when the speaker response exists but is still pending speech reveal', () => {
    // 误报根治：语音同步回合 ingest 返回时消息可能仍是 speechDisplayPending /
    // speech-context 占位——存在即不弹"没有返回可显示的内容"，揭示交给播放节奏。
    expect(source).toContain('if (!hasSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)')
    expect(source).toContain('hasCompletedGroupTurnResponse({')
    expect(source).toContain('function hasSpeakerResponseMessage(sessionId: string, sourceUserMessageId: string, speakerCharacterId: string)')
    // 警告只在真正无任何匹配消息时触发，且必须在宽松检查之后。
    // （用完整错误文案匹配——行 1513 的历史注释也包含短语本身。）
    const warningIndex = source.indexOf('speaker-empty-status-shown')
    const pendingGuardIndex = source.indexOf('if (!hasSpeakerResponseMessage(roomSessionId')
    expect(warningIndex).toBeGreaterThan(-1)
    expect(pendingGuardIndex).toBeGreaterThan(-1)
    expect(pendingGuardIndex).toBeLessThan(warningIndex)
  })

  it('records non-empty group turn completions before the empty-response watchdog runs', () => {
    expect(source).toContain('const stopGroupTurnCompleteHook = chatOrchestrator.onChatTurnComplete')
    expect(source).toContain('const outputText = removeSpecialMarkers(chat.outputText).trim()')
    expect(source).toContain('completedGroupTurnResponses.set(key, {')
    expect(source).toContain('stopGroupTurnCompleteHook()')
  })

  it('retains an earlier successful speaker through later responder watchdog budgets', () => {
    expect(source).toContain('COMPLETED_GROUP_TURN_RESPONSE_TTL_MS = 10 * 60_000')
    expect(source).toContain('setTimeout(() => completedGroupTurnResponses.delete(key), COMPLETED_GROUP_TURN_RESPONSE_TTL_MS)')
  })

  it('does not bypass the display queue when a completed paid response is still pending', () => {
    expect(source).toContain(`logGroupDiagnostic('speaker-output-awaiting-display'`)
    expect(source).not.toContain('restoreCompletedGroupTurnResponse')
  })

  it('keeps recommendation polling beyond the 30-second speech fallback', () => {
    expect(source).toContain('RECOMMENDED_REPLY_ATTACH_POLL_ATTEMPTS = 140')
    expect(source).not.toContain('RECOMMENDED_REPLY_ATTACH_POLL_MS * RECOMMENDED_REPLY_ATTACH_POLL_ATTEMPTS + 500')
  })

  it('persists each speaker narration before the next model request', () => {
    const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('primarySpeakerRequestsSettled')
    expect(chatSource).toContain('await stageGroupNarrationMessages(prepared)')
    expect(chatSource).toContain('await groupNarrationPreparation')
    expect(chatSource).not.toContain('groupSpeechSynthesisBarrier: groupRuntime?.primarySpeakerRequestsSettled')
  })

  it('reports a conclusively missing group speaker reply before showing its retryable error', () => {
    expect(source).toContain('onRequestTrace: (requestId) => { speakerRequestId = requestId }')
    expect(source).toContain('reportOfficialCloudReplyDisplayFailure(speakerRequestId)')
    expect(source).toContain('!runAbortController.signal.aborted && speakerRequestId')
    expect(source.indexOf('reportOfficialCloudReplyDisplayFailure(speakerRequestId)')).toBeLessThan(source.indexOf('speaker-empty-status-shown'))
  })

  it('persists direct-chat error bubbles so a refresh cannot erase them', () => {
    expect(source).toContain(`await chatSession.persistSessionMessages(targetSessionId, { immediate: true })`)
    expect(source).toContain('Keep the submitted user message as the durable request record.')
    expect(source).not.toContain('targetMessages.splice(targetMessages.length - 1 - optimisticUserIndex, 1)')
  })

  it('renders and persists true empty replies as context-free neutral status messages', () => {
    const historySource = readFileSync(new URL('../../../../../packages/stage-ui/src/components/scenarios/chat/history.vue', import.meta.url), 'utf8')
    const groupChatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat/group-chat.ts', import.meta.url), 'utf8')
    const helperStart = source.indexOf('function createGroupEmptyReplyStatus')
    const helperSource = source.slice(helperStart, source.indexOf('const activeGroupMentionParticipants', helperStart))
    const recommendationFinderStart = source.indexOf('function findLatestAssistantMessage')
    const recommendationFinder = source.slice(recommendationFinderStart, source.indexOf('function findSpeakerResponseMessage', recommendationFinderStart))

    expect(helperSource).toContain('role: \'system\'')
    expect(helperSource).toContain('metadata: { messageKind: \'status\' }')
    expect(source.match(/createGroupEmptyReplyStatus\(\{/g)).toHaveLength(2)
    expect(helperSource).toMatch(/id: `\$\{input\.groupTurnId\}:\$\{input\.characterId\}:empty-status`/)
    expect(helperSource).toContain('createdAt: Date.now()')
    expect(source).toContain('speakerTerminalStatus = emptyReply ? \'empty\' : \'error\'')
    expect(source).toMatch(/: \{ role: 'error', content: `\$\{displayName\}: \$\{getChatErrorMessage\(error\)\}` \}/)
    expect(source).toMatch(/if \(!emptyReply\)\r?\n\s+console\.warn\('\[GroupChat\]\[Speaker\] failed'/)
    expect(historySource).toContain(`message.role === 'system' && message.metadata?.messageKind === 'status'`)
    expect(historySource).toContain('airi-text-muted')
    expect(groupChatSource).toContain('message.role === \'system\' || message.role === \'error\' || message.role === \'tool\'')
    expect(recommendationFinder).toContain('message.role === \'assistant\'')
    expect(source).toContain(`console.warn('[Chat] Failed to persist group empty-response status:', error)`)
    const statusIndex = source.indexOf('speaker-empty-status-shown')
    const persistIndex = source.lastIndexOf('persistSessionMessages(roomSessionId, { immediate: true })', statusIndex)
    expect(persistIndex).toBeGreaterThan(-1)
  })

  it('maps empty model replies before broad provider-unavailable errors', () => {
    const helperStart = source.indexOf('function getLocalizedChatErrorMessage')
    const helperEnd = source.indexOf('/**', helperStart)
    const helperSource = source.slice(helperStart, helperEnd)

    expect(helperSource).toContain('模型没有返回可显示的内容，请重试。')
    expect(helperSource.indexOf("normalizedMessage.includes('model returned no visible reply')"))
      .toBeLessThan(helperSource.indexOf("normalizedMessage.includes('temporarily unavailable')"))
  })

  it('finalizes or resets a background group draft in its owning room', () => {
    expect(source).toContain('chatStream.finalizeStream(typeof pendingStream.content === \'string\' ? pendingStream.content : undefined, roomSessionId)')
    expect(source).toContain('chatStream.resetStream(roomSessionId)')
  })

  it('lets the next speaker prepare while prior speech playback continues', () => {
    expect(source).toContain('groupRecommendationInputs')
    expect(source).toContain('sourceUserMessageId')
  })

  it('defers group recommendations until primary speaker requests settle', () => {
    expect(source).toContain('groupRecommendationInputs')
    expect(source).toContain('scheduleRecommendedRepliesWhenAvailable(latestRecommendation)')
    expect(source).not.toContain('scheduleRecommendedReplies({\n            message: assistantMessage')
  })

  it('refreshes narration state when a room script revision changes', () => {
    expect(source).toContain('activeGroupMeta.value?.roomScriptRevision')
    expect(source).toContain('revision !== previous?.[1]')
    expect(source).toContain('void refreshActiveGroupRoomScript()')
  })

  it('normalizes the reactive narration snapshot before toggling it', () => {
    const toggleStart = source.indexOf('async function toggleActiveGroupNarration()')
    const toggleEnd = source.indexOf('const groupSendingForActiveSession', toggleStart)
    const toggleSource = source.slice(toggleStart, toggleEnd)

    expect(toggleSource).toContain('parseGroupRoomScriptState(')
    expect(toggleSource).not.toContain('structuredClone(')
    expect(toggleSource).toContain('chatSession.updateGroupRoomScript(room.sessionId, next)')
    expect(toggleSource).toContain('activeGroupRoomScript.value = saved')
  })
})
