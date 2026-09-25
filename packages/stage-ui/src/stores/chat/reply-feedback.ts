import type { ChatHistoryItem } from '../../types/chat'
import type {
  AiriReplyFeedbackDraft,
  AiriReplyFeedbackRating,
  AiriReplyFeedbackRecord,
  AiriReplyFeedbackRecordPatch,
  AiriReplyFeedbackScope,
  ReplyFeedbackMessageState,
} from '../../types/reply-feedback'

import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

import { replyFeedbackRepo } from '../../database/repos/reply-feedback.repo'
import { summarizeChatHistoryMessage } from '../../utils/chat-message-summary'
import { useAuthStore } from '../auth'
import { useAiriCardStore } from '../modules/airi-card'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { useUserIdentityStore } from '../user-identity'
import { useReplyFeedbackReflectionStore } from './reply-feedback-reflection'
import { useChatSessionStore } from './session-store'

const REPLY_FEEDBACK_CHANNEL_NAME = 'airi-reply-feedback'
const PREVIEW_MAX_LENGTH = 240

type ReplyFeedbackChannelEvent
  = | { type: 'feedback-updated', userId: string, personaCardId: string, assistantMessageId: string, relatedAssistantMessageIds?: string[], feedbackId: string }
    | { type: 'feedback-deleted', userId: string, personaCardId: string, assistantMessageId: string, relatedAssistantMessageIds?: string[], feedbackId?: string }

function toPreview(message: ChatHistoryItem | undefined) {
  if (!message)
    return ''

  return summarizeChatHistoryMessage(message, {
    maxLength: PREVIEW_MAX_LENGTH,
    toolLimit: 2,
  })
}

function hashText(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function patchState(
  states: Record<string, ReplyFeedbackMessageState>,
  assistantMessageId: string,
  patch: ReplyFeedbackMessageState,
) {
  return {
    ...states,
    [assistantMessageId]: {
      ...states[assistantMessageId],
      ...patch,
    },
  }
}

function removeState(states: Record<string, ReplyFeedbackMessageState>, assistantMessageId: string) {
  const next = { ...states }
  delete next[assistantMessageId]
  return next
}

function collectAssistantMessageIds(target: {
  assistantMessageId: string
  siblingAssistantMessageIds?: string[]
}) {
  return Array.from(new Set([
    target.assistantMessageId,
    ...(target.siblingAssistantMessageIds || []),
  ].filter(Boolean)))
}

function createScopeKey(scope: AiriReplyFeedbackScope) {
  return `${scope.userId}::${scope.personaCardId}`
}

function patchStatesForAssistantMessages(
  states: Record<string, ReplyFeedbackMessageState>,
  assistantMessageIds: string[],
  patch: ReplyFeedbackMessageState,
) {
  return assistantMessageIds.reduce((nextStates, assistantMessageId) => {
    return patchState(nextStates, assistantMessageId, patch)
  }, states)
}

function removeStatesForAssistantMessages(states: Record<string, ReplyFeedbackMessageState>, assistantMessageIds: string[]) {
  return assistantMessageIds.reduce((nextStates, assistantMessageId) => {
    return removeState(nextStates, assistantMessageId)
  }, states)
}

export const useReplyFeedbackStore = defineStore('reply-feedback', () => {
  const authStore = useAuthStore()
  const userIdentityStore = useUserIdentityStore()
  const airiCardStore = useAiriCardStore()
  const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
  const replyFeedbackReflection = useReplyFeedbackReflectionStore()
  const chatSession = useChatSessionStore()
  const { activeCardId } = storeToRefs(airiCardStore)

  const feedbackByAssistantMessageId = shallowRef<Record<string, ReplyFeedbackMessageState>>({})
  const recordsVersion = ref(0)
  const currentScope = computed<AiriReplyFeedbackScope>(() => ({
    userId: memoryAdvancedSettings.settings.enableMultiUser
      ? userIdentityStore.currentUserId || 'default'
      : authStore.userId || 'local',
    personaCardId: activeCardId.value || 'default',
  }))
  const currentScopeKey = computed(() => createScopeKey(currentScope.value))

  watch(currentScopeKey, (scopeKey, previousScopeKey) => {
    if (!previousScopeKey || scopeKey === previousScopeKey)
      return

    feedbackByAssistantMessageId.value = {}
    recordsVersion.value++
    void hydrateFeedbackForMessages([...chatSession.messages], scopeKey)
  })

  let channel: BroadcastChannel | undefined
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(REPLY_FEEDBACK_CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<ReplyFeedbackChannelEvent>) => {
      const data = event.data
      const scope = currentScope.value
      if (!data || data.userId !== scope.userId || data.personaCardId !== scope.personaCardId)
        return

      if (data.type === 'feedback-updated') {
        recordsVersion.value++
        void hydrateFeedbackForAssistantMessages(data.relatedAssistantMessageIds?.length
          ? data.relatedAssistantMessageIds
          : [data.assistantMessageId])
      }
      else if (data.type === 'feedback-deleted') {
        recordsVersion.value++
        feedbackByAssistantMessageId.value = removeStatesForAssistantMessages(
          feedbackByAssistantMessageId.value,
          data.relatedAssistantMessageIds?.length
            ? data.relatedAssistantMessageIds
            : [data.assistantMessageId],
        )
      }
    }
  }

  async function resolveScope(): Promise<AiriReplyFeedbackScope> {
    const userId = memoryAdvancedSettings.settings.enableMultiUser
      ? await userIdentityStore.identifyUser()
      : authStore.userId || 'local'

    return {
      userId,
      personaCardId: activeCardId.value || 'default',
    }
  }

  function postChannelEvent(event: ReplyFeedbackChannelEvent) {
    try {
      channel?.postMessage(event)
    }
    catch (error) {
      console.warn('[ReplyFeedback] Failed to broadcast feedback event:', error)
    }
  }

  function syncRecordState(record: AiriReplyFeedbackRecord) {
    const relatedAssistantMessageIds = collectAssistantMessageIds(record)
    feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(
      feedbackByAssistantMessageId.value,
      relatedAssistantMessageIds,
      {
        feedbackId: record.id,
        rating: record.rating,
        tags: record.tags,
        userNote: record.userNote,
        saving: false,
        error: undefined,
      },
    )
  }

  async function scheduleSummaryRefresh(scope: AiriReplyFeedbackScope) {
    try {
      await replyFeedbackReflection.scheduleScopeRefresh(scope)
    }
    catch (error) {
      console.warn('[ReplyFeedback] Failed to schedule learning summary refresh:', error)
    }
  }

  function getFeedbackForMessage(assistantMessageId?: string) {
    if (!assistantMessageId)
      return undefined

    return feedbackByAssistantMessageId.value[assistantMessageId]
  }

  async function hydrateFeedbackForAssistantMessages(assistantMessageIds: string[], expectedScopeKey = currentScopeKey.value) {
    const uniqueIds = Array.from(new Set(assistantMessageIds.filter(Boolean)))
    if (!uniqueIds.length)
      return

    const scope = await resolveScope()
    if (createScopeKey(scope) !== expectedScopeKey)
      return

    const records = await replyFeedbackRepo.getFeedbackForAssistantMessages(scope, uniqueIds)
    if (currentScopeKey.value !== expectedScopeKey)
      return

    const recordsByMessageId = new Map(records.map(record => [record.assistantMessageId, record]))
    const nextState = { ...feedbackByAssistantMessageId.value }

    for (const assistantMessageId of uniqueIds) {
      const record = recordsByMessageId.get(assistantMessageId)
      if (!record) {
        delete nextState[assistantMessageId]
        continue
      }
    }

    for (const record of records) {
      const relatedAssistantMessageIds = collectAssistantMessageIds(record)
      for (const assistantMessageId of relatedAssistantMessageIds) {
        nextState[assistantMessageId] = {
          feedbackId: record.id,
          rating: record.rating,
          tags: record.tags,
          userNote: record.userNote,
        }
      }
    }

    feedbackByAssistantMessageId.value = nextState
  }

  async function hydrateFeedbackForMessages(messages: ChatHistoryItem[], expectedScopeKey = currentScopeKey.value) {
    const assistantMessageIds = messages
      .filter(message => message.role === 'assistant' && message.id)
      .map(message => message.id!)

    await hydrateFeedbackForAssistantMessages(assistantMessageIds, expectedScopeKey)
  }

  async function resolveCurrentScope() {
    return await resolveScope()
  }

  async function listFeedbackRecords() {
    const scope = await resolveScope()
    return await replyFeedbackRepo.listRecords(scope)
  }

  function buildRecord(draft: AiriReplyFeedbackDraft, scope: AiriReplyFeedbackScope): Omit<AiriReplyFeedbackRecord, 'id' | 'createdAt' | 'updatedAt'> {
    const userMessagePreview = toPreview(draft.previousUserMessage)
    const assistantReplyPreview = toPreview(draft.message)
    const sessionId = chatSession.activeSessionId || 'default'

    return {
      ...scope,
      assistantMessageId: draft.message.id!,
      sessionId,
      sourceSurface: draft.sourceSurface,
      rating: draft.rating,
      assistantTurnId: draft.assistantTurnId,
      segmentIndex: draft.segmentIndex,
      siblingAssistantMessageIds: draft.siblingAssistantMessageIds,
      tags: draft.tags ?? [],
      userNote: draft.userNote,
      userMessagePreview,
      assistantReplyPreview,
      userMessageHash: userMessagePreview ? hashText(userMessagePreview) : undefined,
      assistantReplyHash: assistantReplyPreview ? hashText(assistantReplyPreview) : undefined,
    }
  }

  async function setFeedback(draft: AiriReplyFeedbackDraft) {
    if (draft.message.role !== 'assistant' || !draft.message.id)
      return

    const assistantMessageId = draft.message.id
    const relatedAssistantMessageIds = collectAssistantMessageIds({
      assistantMessageId,
      siblingAssistantMessageIds: draft.siblingAssistantMessageIds,
    })
    const previousState = getFeedbackForMessage(assistantMessageId)
    const nextRating: AiriReplyFeedbackRating = draft.rating

    if (previousState?.saving)
      return

    if (previousState?.rating === nextRating) {
      feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(
        feedbackByAssistantMessageId.value,
        relatedAssistantMessageIds,
        {
          saving: true,
          error: undefined,
        },
      )

      try {
        const scope = await resolveScope()
        const deletedRecord = await replyFeedbackRepo.deleteFeedbackForAssistantMessage(scope, assistantMessageId)
        await scheduleSummaryRefresh(scope)
        feedbackByAssistantMessageId.value = removeStatesForAssistantMessages(
          feedbackByAssistantMessageId.value,
          relatedAssistantMessageIds,
        )
        postChannelEvent({
          type: 'feedback-deleted',
          ...scope,
          assistantMessageId,
          relatedAssistantMessageIds,
          feedbackId: deletedRecord?.id,
        })
        recordsVersion.value++
      }
      catch (error) {
        feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(
          feedbackByAssistantMessageId.value,
          relatedAssistantMessageIds,
          {
            ...previousState,
            saving: false,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
      return
    }

    feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(
      feedbackByAssistantMessageId.value,
      relatedAssistantMessageIds,
      {
        rating: nextRating,
        saving: true,
        error: undefined,
      },
    )

    try {
      const scope = await resolveScope()
      const record = await replyFeedbackRepo.upsertFeedback(buildRecord(draft, scope))
      await scheduleSummaryRefresh(scope)
      const persistedAssistantMessageIds = collectAssistantMessageIds(record)
      feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(feedbackByAssistantMessageId.value, persistedAssistantMessageIds, {
        feedbackId: record.id,
        rating: record.rating,
        tags: record.tags,
        userNote: record.userNote,
        saving: false,
        error: undefined,
      })
      postChannelEvent({
        type: 'feedback-updated',
        ...scope,
        assistantMessageId,
        relatedAssistantMessageIds: persistedAssistantMessageIds,
        feedbackId: record.id,
      })
      recordsVersion.value++
    }
    catch (error) {
      if (previousState) {
        feedbackByAssistantMessageId.value = patchStatesForAssistantMessages(
          feedbackByAssistantMessageId.value,
          relatedAssistantMessageIds,
          {
            ...previousState,
            saving: false,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
      else {
        feedbackByAssistantMessageId.value = removeStatesForAssistantMessages(
          feedbackByAssistantMessageId.value,
          relatedAssistantMessageIds,
        )
      }
    }
  }

  async function updateFeedbackRecord(feedbackId: string, patch: AiriReplyFeedbackRecordPatch) {
    const scope = await resolveScope()
    const record = await replyFeedbackRepo.updateFeedback(scope, feedbackId, patch)
    if (!record)
      return undefined

    await scheduleSummaryRefresh(scope)
    syncRecordState(record)
    postChannelEvent({
      type: 'feedback-updated',
      ...scope,
      assistantMessageId: record.assistantMessageId,
      relatedAssistantMessageIds: collectAssistantMessageIds(record),
      feedbackId: record.id,
    })
    recordsVersion.value++
    return record
  }

  async function deleteFeedbackRecord(feedbackId: string) {
    const scope = await resolveScope()
    const record = await replyFeedbackRepo.deleteFeedback(scope, feedbackId)
    if (!record)
      return undefined

    await scheduleSummaryRefresh(scope)
    feedbackByAssistantMessageId.value = removeStatesForAssistantMessages(
      feedbackByAssistantMessageId.value,
      collectAssistantMessageIds(record),
    )
    postChannelEvent({
      type: 'feedback-deleted',
      ...scope,
      assistantMessageId: record.assistantMessageId,
      relatedAssistantMessageIds: collectAssistantMessageIds(record),
      feedbackId: record.id,
    })
    recordsVersion.value++
    return record
  }

  async function deleteFeedbackForAssistantMessage(assistantMessageId?: string) {
    if (!assistantMessageId)
      return undefined

    const scope = await resolveScope()
    const record = await replyFeedbackRepo.deleteFeedbackForAssistantMessage(scope, assistantMessageId)
    if (!record) {
      feedbackByAssistantMessageId.value = removeState(feedbackByAssistantMessageId.value, assistantMessageId)
      return undefined
    }

    const relatedAssistantMessageIds = collectAssistantMessageIds(record)
    await scheduleSummaryRefresh(scope)
    feedbackByAssistantMessageId.value = removeStatesForAssistantMessages(
      feedbackByAssistantMessageId.value,
      relatedAssistantMessageIds,
    )
    postChannelEvent({
      type: 'feedback-deleted',
      ...scope,
      assistantMessageId: record.assistantMessageId,
      relatedAssistantMessageIds,
      feedbackId: record.id,
    })
    recordsVersion.value++
    return record
  }

  return {
    feedbackByAssistantMessageId,
    currentScope,
    recordsVersion,

    getFeedbackForMessage,
    hydrateFeedbackForAssistantMessages,
    hydrateFeedbackForMessages,
    resolveCurrentScope,
    listFeedbackRecords,
    setFeedback,
    updateFeedbackRecord,
    deleteFeedbackRecord,
    deleteFeedbackForAssistantMessage,
  }
})
