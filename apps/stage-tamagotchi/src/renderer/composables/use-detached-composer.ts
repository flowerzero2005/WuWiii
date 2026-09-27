import type { ComposerDetach, ComposerDraft, ComposerSnapshot } from '../../shared/detached-composer'
import type { ComposerPoint } from '../../shared/detached-composer-geometry'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'

import { mergeComposerSnapshot } from '../../shared/detached-composer'
import { composerChanged, composerDetach, composerDraftDiscarded, composerDragDetach, composerExecute, composerFlushSource, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceReturnAck, composerSourceSubmit, composerViewRecovery } from '../../shared/detached-composer-events'
import { useComposerPointerDrag } from './use-composer-pointer-drag'

export function useDetachedComposerSource(input: {
  sessionId: () => string
  userScope: () => string
  surface: 'page' | 'widget'
  group: () => boolean
  busy: () => boolean
  draft: () => ComposerDraft
  applyDraft: (draft: ComposerDraft) => void
  send: () => Promise<{ consumed: boolean, draft: ComposerDraft }>
}) {
  const context = useElectronEventaContext()
  const detachInvoke = useElectronEventaInvoke(composerDetach)
  const dragDetachInvoke = useElectronEventaInvoke(composerDragDetach)
  const settleInvoke = useElectronEventaInvoke(composerSettle)
  const invalidateInvoke = useElectronEventaInvoke(composerInvalidate)
  const returnInvoke = useElectronEventaInvoke(composerRequestReturn)
  const recoveryInvoke = useElectronEventaInvoke(composerRecovery)
  const viewRecoveryInvoke = useElectronEventaInvoke(composerViewRecovery)
  const sourceReadInvoke = useElectronEventaInvoke(composerSourceRead)
  const checkpointInvoke = useElectronEventaInvoke(composerSourceCheckpoint)
  const closeAckInvoke = useElectronEventaInvoke(composerSourceCloseAck)
  const returnAckInvoke = useElectronEventaInvoke(composerSourceReturnAck)
  const inlineSubmitInvoke = useElectronEventaInvoke(composerSourceSubmit)
  const snapshot = ref<ComposerSnapshot>()
  const detaching = ref(false)
  const recoverable = ref(false)
  const recoveryUncertain = ref(false)
  const failed = ref(false)
  const anotherDetached = ref(false)
  const sourceUnavailable = ref(false)
  const deliveryFailed = ref(false)
  const checkpointFailed = ref(false)
  const hydrating = ref(true)
  const inlineSending = ref(false)
  let generation = crypto.randomUUID()
  let disposed = false
  let executing = false
  let mirroredDraft: ComposerDraft | undefined
  let applyingDraft = false
  let draftEpoch = 0
  let draftDirty = false
  let lastDraft = structuredClone(toRaw(input.draft()))
  let binding: (Omit<ComposerDetach, 'draft' | 'recover'> & { version: number }) | undefined
  let scopeReady: Promise<void> = Promise.resolve()
  let checkpointQueue = Promise.resolve()
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined
  let hydrationRetryTimer: ReturnType<typeof setTimeout> | undefined
  let hydrationFailures = 0
  let inlinePromise: Promise<void> | undefined
  const unsavedDrafts = new Map<string, ComposerDraft>()
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : ''
  const isVersionConflict = (error: unknown) => errorMessage(error).includes('saved draft version changed')
  const isOwnershipRace = (error: unknown) => {
    const message = errorMessage(error)
    return message.includes('no longer owns this source scope')
      || message.includes('detached editor owns this draft')
      || message.includes('Another source already owns the detached composer')
      || message.includes('ownership changed')
      || message.includes('acknowledgement is no longer current')
  }
  const isAnotherDetachedOwner = (error: unknown) => errorMessage(error).includes('Another source already owns the detached composer')
  const isUnknownOutcome = (error: unknown) => errorMessage(error).includes('submit outcome is unknown')
  const isCurrentScope = (sourceGeneration: string, sessionId: string, userScope: string) => !disposed
    && sourceGeneration === generation && sessionId === input.sessionId() && userScope === input.userScope()
  const draftScopeKey = (scope: Pick<ComposerDetach, 'userScope' | 'sessionId' | 'surface'>) => `${scope.userScope}\u0000${scope.surface}\u0000${scope.sessionId}`
  function rememberUnsavedDraft(scope: Pick<ComposerDetach, 'userScope' | 'sessionId' | 'surface'>, draft: ComposerDraft) {
    unsavedDrafts.set(draftScopeKey(scope), structuredClone(toRaw(draft)))
  }
  function clearRememberedDraft(scope: Pick<ComposerDetach, 'userScope' | 'sessionId' | 'surface'>) {
    unsavedDrafts.delete(draftScopeKey(scope))
  }
  function applyDraft(draft: ComposerDraft) {
    mirroredDraft = structuredClone(toRaw(draft))
    applyingDraft = true
    input.applyDraft(draft)
    lastDraft = structuredClone(toRaw(draft))
    applyingDraft = false
  }
  const handled = new Set<string>()
  const matches = (value: ComposerSnapshot) => value.scope.sourceGeneration === generation
    && value.scope.sessionId === input.sessionId() && value.scope.userScope === input.userScope()
    && value.scope.surface === input.surface
  const detached = computed(() => !!snapshot.value && matches(snapshot.value) && snapshot.value.status === 'detached')
  const readonly = computed(() => hydrating.value || inlineSending.value || recoveryUncertain.value || detached.value || detaching.value || !!(snapshot.value && matches(snapshot.value) && snapshot.value.uncertain))
  function checkpoint() {
    clearTimeout(checkpointTimer)
    const hydration = scopeReady
    const checkpointGeneration = generation
    const checkpointSessionId = input.sessionId()
    const checkpointUserScope = input.userScope()
    const task = checkpointQueue.catch(() => undefined).then(async () => {
      await hydration
      let rebased = false
      while (draftDirty) {
        if (!isCurrentScope(checkpointGeneration, checkpointSessionId, checkpointUserScope)
          || !binding || binding.sourceGeneration !== checkpointGeneration || readonly.value || input.busy()) {
          break
        }
        const current = binding
        const epoch = draftEpoch
        let result: { version: number }
        try {
          result = await checkpointInvoke({ ...current, draft: structuredClone(toRaw(input.draft())) })
        }
        catch (error) {
          // A revision can move while a return handoff is being acknowledged.
          // Re-read only the revision, preserve the local draft, then make one
          // checked retry. This never bypasses main-process ownership checks.
          if (!rebased && isVersionConflict(error) && isCurrentScope(checkpointGeneration, checkpointSessionId, checkpointUserScope)) {
            const saved = await sourceReadInvoke({
              sessionId: checkpointSessionId,
              userScope: checkpointUserScope,
              surface: input.surface,
              sourceGeneration: checkpointGeneration,
              group: input.group(),
            })
            if (isCurrentScope(checkpointGeneration, checkpointSessionId, checkpointUserScope) && !saved.uncertain) {
              current.version = saved.version
              rebased = true
              continue
            }
            if (saved.uncertain) {
              recoveryUncertain.value = true
              recoverable.value = true
            }
          }
          throw error
        }
        current.version = result.version
        checkpointFailed.value = false
        if (epoch === draftEpoch) {
          draftDirty = false
          clearRememberedDraft(current)
        }
      }
    }).catch((error) => {
      // A stale renderer can lose ownership while a detach, return, or scope
      // switch is in flight. Its draft remains in memory; do not turn that
      // expected ordering race into a false storage warning in the new scope.
      if (isCurrentScope(checkpointGeneration, checkpointSessionId, checkpointUserScope) && !detached.value) {
        if (isUnknownOutcome(error)) {
          recoveryUncertain.value = true
          recoverable.value = true
        }
        else if (!isOwnershipRace(error)) {
          checkpointFailed.value = true
        }
      }
      throw error
    })
    checkpointQueue = task.catch(() => undefined)
    return task
  }
  function scheduleCheckpoint() {
    clearTimeout(checkpointTimer)
    checkpointTimer = setTimeout(() => void checkpoint().catch(() => undefined), 150)
  }
  watch(() => input.draft(), () => {
    if (applyingDraft)
      return
    draftEpoch += 1
    lastDraft = structuredClone(toRaw(input.draft()))
    draftDirty = true
    if (binding && unsavedDrafts.has(draftScopeKey(binding)))
      rememberUnsavedDraft(binding, input.draft())
    if (!readonly.value && !input.busy())
      scheduleCheckpoint()
  }, { deep: true, flush: 'sync' })
  watch(() => input.busy(), (busy) => {
    if (!busy && draftDirty && !readonly.value)
      scheduleCheckpoint()
  })
  const offChanged = context.value.on(composerChanged, ({ body }) => {
    if (disposed || !body || !matches(body))
      return
    const previous = snapshot.value
    const merged = mergeComposerSnapshot(previous, body)
    if (merged === previous)
      return
    snapshot.value = merged
    if (merged.status === 'returned' && binding?.sourceGeneration === generation) {
      binding.version = merged.version
      recoveryUncertain.value = !!merged.uncertain
    }
    if (merged.uncertain) {
      recoverable.value = true
      recoveryUncertain.value = true
    }
    // The running source owns its temporary optimistic clear/restore. Mirror
    // only edits and a settled response, never overwrite it during submission.
    if (!merged.busy && !merged.uncertain && (!previous?.busy || !executing))
      applyDraft(merged.draft)
    if (merged.status === 'returned' && binding?.sourceGeneration === generation) {
      void returnAckInvoke({
        leaseId: merged.scope.leaseId,
        version: merged.version,
        sourceGeneration: generation,
      // The persisted return is already visible in this source. An obsolete
      // acknowledgement is harmless because main has a close timeout fallback.
      }).catch(() => undefined)
    }
  })
  const offExecute = context.value.on(composerExecute, ({ body }) => {
    if (disposed || !body || !matches(body) || body.status !== 'detached' || !body.commandId
      || snapshot.value?.scope.leaseId !== body.scope.leaseId || handled.has(body.commandId)) {
      return
    }
    handled.add(body.commandId)
    void (async () => {
      const sourceGeneration = body.scope.sourceGeneration
      const sourceSessionId = body.scope.sessionId
      const sourceUserScope = body.scope.userScope
      const version = { leaseId: body.scope.leaseId, version: body.version, commandId: body.commandId! }
      let result: { consumed: boolean, draft: ComposerDraft } | undefined
      try {
        if (input.busy() || executing) {
          result = { consumed: false, draft: body.draft }
        }
        else {
          executing = true
          applyDraft(body.draft)
          result = await input.send()
        }
      }
      catch {
        if (isCurrentScope(sourceGeneration, sourceSessionId, sourceUserScope))
          deliveryFailed.value = true
        // A thrown send has no proven outcome. Keep its original command and
        // draft quarantined; never turn transport failure into a retryable send.
        await invalidateInvoke({ sourceGeneration }).catch(() => undefined)
      }
      finally {
        executing = false
      }
      if (result) {
        try {
          await settleInvoke({ ...version, ...result })
          if (isCurrentScope(sourceGeneration, sourceSessionId, sourceUserScope))
            deliveryFailed.value = false
        }
        catch {
          if (isCurrentScope(sourceGeneration, sourceSessionId, sourceUserScope))
            deliveryFailed.value = true
          await invalidateInvoke({ sourceGeneration }).catch(() => undefined)
          // Retry only the acknowledgement, with the exact proven outcome.
          await settleInvoke({ ...version, ...result }).catch(() => undefined)
        }
      }
    })()
  })
  async function detach(recover = false, point?: ComposerPoint) {
    await scopeReady
    if (input.busy() || readonly.value || disposed)
      return
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    const sourceGeneration = generation
    detaching.value = true
    failed.value = false
    anotherDetached.value = false
    try {
      // The release point is verified against the real cursor position in the
      // main process. Waiting for an older checkpoint here makes that check
      // observe where the pointer moved after the user let go.
      if (!point)
        await checkpointQueue
      const request = { sessionId, userScope, surface: input.surface, sourceGeneration, group: input.group(), draft: structuredClone(toRaw(input.draft())), recover }
      const value = point ? await dragDetachInvoke({ ...request, point }) : await detachInvoke(request)
      if (disposed || sourceGeneration !== generation || sessionId !== input.sessionId() || userScope !== input.userScope()) {
        await invalidateInvoke({ sourceGeneration })
        return
      }
      const merged = mergeComposerSnapshot(snapshot.value, value)
      snapshot.value = merged
      if (!merged.uncertain)
        applyDraft(merged.draft)
      recoverable.value = false
      draftDirty = false
      checkpointFailed.value = false
      deliveryFailed.value = false
    }
    catch (error) {
      if (isCurrentScope(sourceGeneration, sessionId, userScope)) {
        if (isAnotherDetachedOwner(error))
          anotherDetached.value = true
        else if (!isOwnershipRace(error))
          failed.value = true
      }
    }
    finally {
      detaching.value = false
    }
  }
  async function requestReturn() {
    if (!snapshot.value || input.busy() || snapshot.value.busy)
      return
    const current = snapshot.value
    try {
      await returnInvoke({ leaseId: current.scope.leaseId, version: current.version })
    }
    catch (error) {
      if (snapshot.value?.scope.leaseId === current.scope.leaseId && snapshot.value.version === current.version && !isOwnershipRace(error))
        failed.value = true
    }
  }
  /** Save the source draft and finish a detached handoff before changing sessions. */
  async function prepareSessionSwitch(): Promise<boolean> {
    await scopeReady
    const sourceGeneration = generation
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    if (disposed || hydrating.value || detaching.value || recoveryUncertain.value)
      return false

    if (detached.value) {
      const current = snapshot.value!
      if (input.busy() || current.busy)
        return false
      // Subscribe before sending the request: the editor may flush and return
      // before the invoke resolves. A timeout preserves the existing input.
      let stop: (() => void) | undefined
      let finish: (value: boolean) => void = () => undefined
      const returned = new Promise<boolean>((resolve) => {
        finish = resolve
        stop = watch(snapshot, value => {
          if (!isCurrentScope(sourceGeneration, sessionId, userScope))
            resolve(false)
          else if (value?.scope.leaseId === current.scope.leaseId && value.status === 'returned')
            resolve(!value.uncertain)
        }, { flush: 'sync' })
      })
      const timeout = setTimeout(() => finish(false), 12_000)
      try {
        void returnInvoke({ leaseId: current.scope.leaseId, version: current.version }).catch(() => finish(false))
        if (!await returned)
          return false
      }
      catch {
        return false
      }
      finally {
        clearTimeout(timeout)
        stop?.()
      }
    }
    if (!isCurrentScope(sourceGeneration, sessionId, userScope))
      return false
    // An inline command already owns its durable original draft. Browsing
    // another conversation after optimistic consumption must not replay it.
    if (inlineSending.value || executing)
      return !input.draft().text && input.draft().images.length === 0
    try {
      await checkpoint()
      return isCurrentScope(sourceGeneration, sessionId, userScope)
        && !draftDirty && !checkpointFailed.value && !readonly.value
    }
    catch {
      return false
    }
  }
  function sendInline() {
    if (inlinePromise)
      return inlinePromise
    inlinePromise = (async () => {
      await scopeReady
      if (disposed || readonly.value || input.busy() || !binding || (!input.draft().text.trim() && !input.draft().images.length))
        return
      await checkpoint()
      if (disposed || readonly.value || !binding)
        return
      const current = binding
      const sourceSessionId = current.sessionId
      const sourceUserScope = current.userScope
      const original = structuredClone(toRaw(input.draft()))
      inlineSending.value = true
      let command: ComposerSnapshot | undefined
      let result: { consumed: boolean, draft: ComposerDraft } | undefined
      try {
        command = await inlineSubmitInvoke({ ...current, commandId: crypto.randomUUID(), draft: original })
        result = current.sourceGeneration === generation && !disposed
          ? await input.send()
          : { consumed: false, draft: original }
        const receipt = { leaseId: command.scope.leaseId, version: command.version, commandId: command.commandId!, ...result }
        let settled: ComposerSnapshot
        try {
          settled = await settleInvoke(receipt)
        }
        catch {
          settled = await settleInvoke(receipt)
        }
        if (current.sourceGeneration === generation) {
          current.version = settled.version
          draftDirty = JSON.stringify(input.draft()) !== JSON.stringify(settled.draft)
          deliveryFailed.value = false
          recoveryUncertain.value = false
          recoverable.value = !!settled.draft.text || !!settled.draft.images.length
        }
      }
      catch {
        if (isCurrentScope(current.sourceGeneration, sourceSessionId, sourceUserScope))
          deliveryFailed.value = true
        if (!command || result) {
          try {
            // Read without rebinding the source. Main can prove a failed
            // begin rolled back or a lost settle acknowledgement committed.
            const saved = await recoveryInvoke(current)
            if (!saved.uncertain && (!command || (Number.isSafeInteger(saved.version) && saved.version > command.version))) {
              if (current.sourceGeneration === generation) {
                if (command) {
                  current.version = saved.version
                  draftDirty = JSON.stringify(input.draft()) !== JSON.stringify(saved.draft ?? { text: '', images: [] })
                  deliveryFailed.value = false
                }
                recoveryUncertain.value = false
                recoverable.value = saved.exists
              }
              return
            }
          }
          catch {
            // No confirmed read means the command outcome is still unknown.
          }
        }
        // Even a lost begin ACK may have committed its uncertainty marker.
        // Read only after the outcome is unknown; never retry the send itself.
        if (current.sourceGeneration === generation) {
          recoveryUncertain.value = true
          recoverable.value = true
        }
        await invalidateInvoke({ sourceGeneration: current.sourceGeneration }).catch(() => undefined)
      }
      finally {
        inlineSending.value = false
      }
    })().finally(() => inlinePromise = undefined)
    return inlinePromise
  }
  watch(() => [input.sessionId(), input.userScope(), input.group()], () => {
    clearTimeout(checkpointTimer)
    clearTimeout(hydrationRetryTimer)
    hydrationFailures = 0
    const previousGeneration = generation
    const previousBinding = binding
    const previousDraft = lastDraft
    const previousReadonly = detached.value || !!snapshot.value?.uncertain || recoveryUncertain.value
    const previousDirty = draftDirty
    let initialDraft = structuredClone(toRaw(input.draft()))
    const wasDetached = !!snapshot.value
    generation = crypto.randomUUID()
    const recoveryGeneration = generation
    if (snapshot.value || detaching.value)
      void invalidateInvoke({ sourceGeneration: previousGeneration }).catch(() => undefined)
    if (snapshot.value && mirroredDraft) {
      const current = input.draft()
      if (current.text === mirroredDraft.text && current.images.length === mirroredDraft.images.length
        && current.images.every((image, index) => image.data === mirroredDraft!.images[index].data && image.mimeType === mirroredDraft!.images[index].mimeType)) {
        input.applyDraft({ text: '', images: [] })
      }
    }
    if (previousBinding && !wasDetached && JSON.stringify(initialDraft) === JSON.stringify(previousDraft)) {
      applyDraft({ text: '', images: [] })
      initialDraft = { text: '', images: [] }
    }
    mirroredDraft = undefined
    snapshot.value = undefined
    binding = undefined
    hydrating.value = true
    draftDirty = false
    // Error state belongs to a renderer generation. Without this reset, a
    // rejected checkpoint from the previous conversation was displayed over
    // the next conversation as a fictitious disk or detach failure.
    failed.value = false
    anotherDetached.value = false
    sourceUnavailable.value = false
    deliveryFailed.value = false
    checkpointFailed.value = false
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    recoverable.value = false
    recoveryUncertain.value = false
    const hydrationEpoch = draftEpoch
    const request = { sessionId, userScope, surface: input.surface, sourceGeneration: recoveryGeneration, group: input.group() }
    const activeBinding = { ...request, version: 0 }
    binding = activeBinding
    const previousReady = scopeReady
    const previousQueue = checkpointQueue
    const finishHydration = (saved: { version: number, draft?: ComposerDraft, uncertain: boolean, returned?: boolean }, exists: { exists: boolean, uncertain: boolean }) => {
      if (!disposed && recoveryGeneration === generation && sessionId === input.sessionId() && userScope === input.userScope()) {
        const fallback = unsavedDrafts.get(draftScopeKey(request))
        const inputIsEmpty = !input.draft().text && !input.draft().images.length
        binding = activeBinding
        recoverable.value = exists.exists
        recoveryUncertain.value = exists.uncertain || saved.uncertain
        failed.value = false
        checkpointFailed.value = false
        sourceUnavailable.value = false
        hydrationFailures = 0
        let restoredFallback = false
        if (fallback && !saved.uncertain && draftEpoch === hydrationEpoch && inputIsEmpty) {
          applyDraft(fallback)
          restoredFallback = true
        }
        else if (saved.draft && !saved.uncertain && draftEpoch === hydrationEpoch
          && (saved.returned || (!initialDraft.text && !initialDraft.images.length && !input.draft().text && !input.draft().images.length))) {
          applyDraft(saved.draft)
        }
        draftDirty = !saved.uncertain && (restoredFallback || !saved.draft || JSON.stringify(input.draft()) !== JSON.stringify(saved.draft))
        hydrating.value = false
        if (draftDirty)
          scheduleCheckpoint()
      }
    }
    const hydrate = async () => {
      const saved = await sourceReadInvoke(request)
      activeBinding.version = saved.version
      const exists = await recoveryInvoke({ sessionId, userScope, surface: input.surface })
      finishHydration(saved, exists)
    }
    const retryHydration = () => {
      clearTimeout(hydrationRetryTimer)
      hydrationRetryTimer = setTimeout(() => {
        if (!isCurrentScope(recoveryGeneration, sessionId, userScope))
          return
        void hydrate().catch(() => {
          if (!isCurrentScope(recoveryGeneration, sessionId, userScope))
            return
          hydrationFailures += 1
          if (hydrationFailures >= 3)
            sourceUnavailable.value = true
          retryHydration()
        })
      }, 750)
    }
    scopeReady = (async () => {
      await previousReady
      await previousQueue
      if (previousBinding && previousDirty && !previousReadonly) {
        try {
          await checkpointInvoke({ ...previousBinding, draft: previousDraft })
        }
        catch {
          // Keep the exact old draft locally until that scope accepts a later
          // checkpoint. The visible input may already have been cleared for
          // this new conversation, so merely hiding the old error would lose
          // data after a genuine persistence failure.
          rememberUnsavedDraft(previousBinding, previousDraft)
        }
      }
      try {
        await hydrate()
      }
      catch {
        if (!isCurrentScope(recoveryGeneration, sessionId, userScope))
          return
        // Initial source binding is an IPC handshake, not proof that disk
        // persistence failed. Keep the editor read only and retry the bind
        // instead of showing a false storage error at application startup.
        const fallback = unsavedDrafts.get(draftScopeKey(request))
        if (fallback && !input.draft().text && !input.draft().images.length) {
          applyDraft(fallback)
          draftDirty = true
        }
        hydrationFailures += 1
        retryHydration()
      }
    })()
  }, { immediate: true, flush: 'sync' })
  const offFlushSource = context.value.on(composerFlushSource, ({ body }) => {
    if (!body || body.sourceGeneration !== generation || disposed)
      return
    const sourceGeneration = body.sourceGeneration
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    void (async () => {
      await scopeReady
      await inlinePromise
      await checkpoint()
      if (sourceGeneration === generation && !checkpointFailed.value)
        await closeAckInvoke({ sourceGeneration, closeAttemptId: body.closeAttemptId })
    })().catch((error) => {
      if (isCurrentScope(sourceGeneration, sessionId, userScope) && !isOwnershipRace(error))
        checkpointFailed.value = true
    })
  })
  const offDiscarded = context.value.on(composerDraftDiscarded, ({ body }) => {
    if (!body || disposed || body.userScope !== input.userScope() || body.sessionId !== input.sessionId() || body.surface !== input.surface)
      return
    recoverable.value = false
    recoveryUncertain.value = false
    if (binding)
      binding.version = body.version
    if (snapshot.value?.uncertain)
      snapshot.value = undefined
    applyDraft({ text: '', images: [] })
    draftDirty = false
  })
  onScopeDispose(() => {
    disposed = true
    offChanged()
    offExecute()
    offFlushSource()
    offDiscarded()
    clearTimeout(checkpointTimer)
    clearTimeout(hydrationRetryTimer)
    void invalidateInvoke({ sourceGeneration: generation }).catch(() => undefined)
  })
  function viewRecovery() {
    return viewRecoveryInvoke({ sessionId: input.sessionId(), userScope: input.userScope(), surface: input.surface }).catch(() => failed.value = true)
  }
  const drag = useComposerPointerDrag(point => detach(false, point))
  function clickDetach() {
    if (!drag.consumeClick())
      return detached.value ? requestReturn() : detach()
  }
  function getSourceActionScope() {
    const value = snapshot.value
    if (!value || !matches(value) || value.status !== 'detached')
      return undefined
    return { leaseId: value.scope.leaseId, version: value.version, sourceGeneration: value.scope.sourceGeneration }
  }
  return { detach, detached, readonly, detaching, recoverable, recoveryUncertain, failed, anotherDetached, sourceUnavailable, deliveryFailed, checkpointFailed, checkpoint, sendInline, requestReturn, prepareSessionSwitch, viewRecovery, getSourceActionScope, startDrag: drag.start, dragging: drag.dragging, clickDetach }
}
