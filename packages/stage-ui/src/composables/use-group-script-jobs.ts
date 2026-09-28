import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { MaybeRefOrGetter } from 'vue'

import { computed, onScopeDispose, ref, toValue, watch } from 'vue'

import { useAuthStore } from '../stores/auth'
import { createChatTraceRequest } from '../stores/chat/chat-diagnostics'
import { generateGroupScriptResponse, parseGroupScriptEvaluation, parseGroupScriptSequelResponse } from '../stores/chat/group-script-runtime'
import { withSessionActivity } from '../stores/chat/session-record-lock'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useProvidersStore } from '../stores/providers'
import { useOfficialCapabilityConsentStore } from '../stores/settings/official-capability-consent'
import { summarizeChatHistoryMessage } from '../utils/chat-message-summary'

interface ChapterJobInput { sessionId: string, turnId: string, groupTurnId?: string, language: string }

/** A provider may ignore AbortSignal; release the caller without accepting its late result. */
function withChapterAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('The chapter request was cancelled.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted)
      abort()
  })
}

/** Runs one opted-in chapter child request with a durable attempt lease. */
export function useGroupScriptJobs(currentSessionId: MaybeRefOrGetter<string>) {
  const session = useChatSessionStore()
  const consciousness = useConsciousnessStore()
  const providers = useProvidersStore()
  const auth = useAuthStore()
  const consent = useOfficialCapabilityConsentStore()
  const pending = ref(false)
  let active: { sessionId: string, expectedRevision: number, controller: AbortController } | undefined
  let scheduled: AbortController | undefined
  const configuration = computed(() => JSON.stringify([
    consciousness.activeProvider,
    consciousness.activeModel,
    providers.getProviderConfig(consciousness.activeProvider),
    auth.userId,
    auth.isAuthenticated,
    consciousness.activeProvider === 'official-cloud' ? consent.getQuote('group-script', { modelId: consciousness.activeModel })?.fingerprint : undefined,
    consciousness.activeProvider === 'official-cloud' ? consent.getAcceptance(auth.userId, 'group-script')?.quote.fingerprint : undefined,
  ]))

  function cancel() {
    scheduled?.abort()
    active?.controller.abort()
  }

  watch(configuration, cancel, { flush: 'sync' })
  watch(() => toValue(currentSessionId), cancel, { flush: 'sync' })
  watch(() => session.getSessionMeta(toValue(currentSessionId))?.roomScriptRevision, (revision) => {
    if (active && revision !== active.expectedRevision)
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(cancel)

  async function run(kind: 'evaluation' | 'sequel', input: ChapterJobInput) {
    if (pending.value || input.sessionId !== toValue(currentSessionId))
      return
    const snapshot = configuration.value
    const providerId = consciousness.activeProvider
    const model = consciousness.activeModel
    const account = auth.userId
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new DOMException('The chapter request timed out.', 'AbortError')), 90_000)
    const owner = { sessionId: input.sessionId, controller, expectedRevision: session.getSessionMeta(input.sessionId)?.roomScriptRevision ?? 0 }
    active = owner
    pending.value = true
    let claimed = false
    let requestId = ''
    const assertCurrent = () => {
      controller.signal.throwIfAborted()
      if (active !== owner || snapshot !== configuration.value || input.sessionId !== toValue(currentSessionId)
        || session.getSessionMeta(input.sessionId)?.roomScriptRevision !== owner.expectedRevision) {
        throw new DOMException('The chapter request configuration changed.', 'AbortError')
      }
      if (providerId === 'official-cloud') {
        const quote = consent.getQuote('group-script', { modelId: model })
        if (!auth.isAuthenticated || account !== auth.userId || !quote || consent.needsConsent(account, 'group-script', quote))
          throw new Error('Confirm the current official model price in the script settings before continuing.')
      }
    }
    try {
      assertCurrent()
      if (!providerId || !model)
        throw new Error('Choose a conversation provider and model first.')
      const state = await session.resolveGroupRoomScript(input.sessionId)
      assertCurrent()
      const act = state?.templateSnapshot.acts?.find(item => item.actId === state.progress?.currentActId)
      if (!state?.progress || !act || (kind === 'evaluation' && (!state.chapterSettings?.automaticEvaluationEnabled || state.progress.isComplete || !act.unlockConditions.length)))
        return
      const trace = createChatTraceRequest({
        sourceSurface: 'group-chat',
        turnId: input.turnId,
        groupTurnId: input.groupTurnId,
        parentRequestId: input.turnId,
        roomName: session.getSessionMeta(input.sessionId)?.title,
      }, kind === 'evaluation' ? 'group-script-evaluation' : 'group-script-sequel')
      requestId = trace.requestId!
      const operationId = `chapter-${crypto.randomUUID()}`
      const expectedRevision = owner.expectedRevision
      owner.expectedRevision += 1
      const leased = await session.executeGroupScriptCommand(input.sessionId, expectedRevision, {
        type: 'claim',
        job: { kind, turnId: kind === 'evaluation' ? input.turnId : operationId, requestId, operationId, expiresAt: Date.now() + 120_000, progressRevision: state.progress.revision },
      }, controller.signal)
      claimed = true
      assertCurrent()
      const messages = session.getSessionMessages(input.sessionId).flatMap((message) => {
        if (!message.id || (message.role !== 'user' && message.role !== 'assistant')
          || (message.role === 'assistant' && (message.metadata?.messageKind === 'narration' || message.metadata?.messageKind === 'status' || message.metadata?.speechDisplayPending))) {
          return []
        }
        const text = summarizeChatHistoryMessage(message, { maxLength: 4000, toolLimit: 0 })
        return text && text !== '[无内容]' ? [{ id: message.id, role: message.role, text }] : []
      }).slice(-48)
      if (!messages.some(message => message.id === input.turnId))
        throw new Error('The source conversation turn is no longer available.')
      const chatProvider = await withChapterAbort(providers.getProviderInstance<ChatProvider>(providerId), controller.signal)
      assertCurrent()
      const raw = await withChapterAbort(generateGroupScriptResponse({ kind, state: leased, messages, chatConfig: chatProvider.chat(model), model, language: input.language, signal: controller.signal, trace, assertCurrent }), controller.signal)
      assertCurrent()
      const command = kind === 'evaluation'
        ? { type: 'evaluate' as const, requestId, evaluation: parseGroupScriptEvaluation(raw, leased, { operationId, evaluationTurnId: input.turnId, evaluatedAt: Date.now() }, messages.map(message => message.id)) }
        : { type: 'propose' as const, requestId, draft: parseGroupScriptSequelResponse(raw, leased, { requestId, generatedAt: Date.now() }) }
      const revisionBeforeCommit = owner.expectedRevision
      owner.expectedRevision += 1
      return await session.executeGroupScriptCommand(input.sessionId, revisionBeforeCommit, command, controller.signal)
    }
    catch (error) {
      // An attempt marker survives malformed output, cancellation and crashes.
      // Recording failure starts no provider request and may target the old room.
      if (claimed) {
        const revision = session.getSessionMeta(input.sessionId)?.roomScriptRevision ?? 0
        await session.executeGroupScriptCommand(input.sessionId, revision, { type: 'fail', requestId, at: Date.now() }).catch(() => undefined)
      }
      throw error
    }
    finally {
      clearTimeout(timeout)
      if (active === owner) {
        active = undefined
        pending.value = false
      }
    }
  }

  /** Called only after the group speaker requests have reached their final state. */
  async function scheduleEvaluation(input: ChapterJobInput, display: { isPending: () => boolean, hasVisibleResponse: () => boolean, shouldEvaluate?: () => boolean }) {
    cancel()
    const controller = new AbortController()
    scheduled = controller
    const snapshot = configuration.value
    const revision = session.getSessionMeta(input.sessionId)?.roomScriptRevision
    const deadline = setTimeout(() => controller.abort(new DOMException('The chapter display wait timed out.', 'AbortError')), 120_000)
    const assertCurrent = () => {
      controller.signal.throwIfAborted()
      if (scheduled !== controller || input.sessionId !== toValue(currentSessionId) || snapshot !== configuration.value
        || revision !== session.getSessionMeta(input.sessionId)?.roomScriptRevision) {
        throw new DOMException('The completed group turn changed.', 'AbortError')
      }
    }
    try {
      return await withSessionActivity(input.sessionId, async () => {
        assertCurrent()
        while (display.isPending()) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await withChapterAbort(new Promise<void>(resolve => timer = setTimeout(resolve, 250)), controller.signal)
          }
          finally {
            clearTimeout(timer)
          }
          assertCurrent()
        }
        if (!display.hasVisibleResponse())
          return
        await withChapterAbort(session.persistSessionMessages(input.sessionId, { immediate: true }), controller.signal)
        assertCurrent()
        if (display.shouldEvaluate?.() === false)
          return
        clearTimeout(deadline)
        return await run('evaluation', input)
      })
    }
    finally {
      clearTimeout(deadline)
      if (scheduled === controller)
        scheduled = undefined
    }
  }

  return { cancel, pending, run, scheduleEvaluation }
}
