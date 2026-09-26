import type { ComposerDetach, ComposerDraft, ComposerSnapshot } from '../../shared/detached-composer'
import type { ComposerClientRegion, ComposerPoint } from '../../shared/detached-composer-geometry'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, nextTick, onScopeDispose, ref, toRaw, watch } from 'vue'

import { mergeComposerSnapshot } from '../../shared/detached-composer'
import { composerChanged, composerDetach, composerDraftDiscarded, composerDragDetach, composerExecute, composerFlushSource, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceSubmit, composerViewRecovery } from '../../shared/detached-composer-events'
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
  region?: () => ComposerClientRegion | undefined
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
  const regionInvoke = useElectronEventaInvoke(composerSourceRegion)
  const closeAckInvoke = useElectronEventaInvoke(composerSourceCloseAck)
  const inlineSubmitInvoke = useElectronEventaInvoke(composerSourceSubmit)
  const snapshot = ref<ComposerSnapshot>()
  const detaching = ref(false)
  const recoverable = ref(false)
  const recoveryUncertain = ref(false)
  const failed = ref(false)
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
  let regionTimer: ReturnType<typeof setInterval> | undefined
  let inlinePromise: Promise<void> | undefined
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
    const task = checkpointQueue.catch(() => undefined).then(async () => {
      await hydration
      while (draftDirty) {
        if (disposed || !binding || binding.sourceGeneration !== generation || readonly.value || input.busy())
          break
        const current = binding
        const epoch = draftEpoch
        const result = await checkpointInvoke({ ...current, draft: structuredClone(toRaw(input.draft())) })
        current.version = result.version
        checkpointFailed.value = false
        if (epoch === draftEpoch)
          draftDirty = false
      }
    }).catch((error) => {
      // A checkpoint that lost the race to a successful detach is rejected by
      // the main process because the detached editor owns the draft now.
      if (!detached.value)
        checkpointFailed.value = true
      throw error
    })
    checkpointQueue = task.catch(() => undefined)
    return task
  }
  function scheduleCheckpoint() {
    clearTimeout(checkpointTimer)
    checkpointTimer = setTimeout(() => void checkpoint().catch(() => undefined), 150)
  }
  function reportRegion() {
    const region = input.region?.()
    if (region && binding?.sourceGeneration === generation)
      void regionInvoke({ sourceGeneration: generation, region }).catch(() => undefined)
  }
  watch(() => input.draft(), () => {
    if (applyingDraft)
      return
    draftEpoch += 1
    lastDraft = structuredClone(toRaw(input.draft()))
    draftDirty = true
    if (!readonly.value && !input.busy())
      scheduleCheckpoint()
  }, { deep: true, flush: 'sync' })
  watch(() => input.busy(), (busy) => {
    if (!busy && draftDirty && !readonly.value)
      scheduleCheckpoint()
  })
  watch(detached, (value) => {
    clearInterval(regionTimer)
    if (value) {
      reportRegion()
      void nextTick(reportRegion)
      regionTimer = setInterval(reportRegion, 250)
    }
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
  })
  const offExecute = context.value.on(composerExecute, ({ body }) => {
    if (disposed || !body || !matches(body) || body.status !== 'detached' || !body.commandId
      || snapshot.value?.scope.leaseId !== body.scope.leaseId || handled.has(body.commandId)) {
      return
    }
    handled.add(body.commandId)
    void (async () => {
      const sourceGeneration = body.scope.sourceGeneration
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
        failed.value = true
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
        }
        catch {
          failed.value = true
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
      reportRegion()
    }
    catch {
      failed.value = true
    }
    finally {
      detaching.value = false
    }
  }
  async function requestReturn() {
    if (!snapshot.value || input.busy() || snapshot.value.busy)
      return
    try {
      await returnInvoke({ leaseId: snapshot.value.scope.leaseId, version: snapshot.value.version })
    }
    catch {
      failed.value = true
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
          recoveryUncertain.value = false
          recoverable.value = !!settled.draft.text || !!settled.draft.images.length
        }
      }
      catch {
        failed.value = true
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
                  failed.value = false
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
    scopeReady = (async () => {
      await previousReady
      await previousQueue
      if (previousBinding && previousDirty && !previousReadonly) {
        try {
          await checkpointInvoke({ ...previousBinding, draft: previousDraft })
        }
        catch {
          checkpointFailed.value = true
        }
      }
      const saved = await sourceReadInvoke(request)
      activeBinding.version = saved.version
      const exists = await recoveryInvoke({ sessionId, userScope, surface: input.surface })
      if (!disposed && recoveryGeneration === generation && sessionId === input.sessionId() && userScope === input.userScope()) {
        binding = activeBinding
        recoverable.value = exists.exists
        recoveryUncertain.value = exists.uncertain || saved.uncertain
        if (saved.draft && !saved.uncertain && draftEpoch === hydrationEpoch
          && !initialDraft.text && !initialDraft.images.length && !input.draft().text && !input.draft().images.length) {
          applyDraft(saved.draft)
        }
        draftDirty = !saved.uncertain && (draftEpoch !== hydrationEpoch || !saved.draft)
        hydrating.value = false
        reportRegion()
        if (draftDirty)
          scheduleCheckpoint()
      }
    })().catch(() => {
      if (recoveryGeneration === generation) {
        checkpointFailed.value = true
        hydrating.value = false
      }
    })
  }, { immediate: true, flush: 'sync' })
  const offFlushSource = context.value.on(composerFlushSource, ({ body }) => {
    if (!body || body.sourceGeneration !== generation || disposed)
      return
    void (async () => {
      await scopeReady
      await inlinePromise
      await checkpoint()
      if (body.sourceGeneration === generation && !checkpointFailed.value)
        await closeAckInvoke({ sourceGeneration: generation })
    })().catch(() => checkpointFailed.value = true)
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
    clearInterval(regionTimer)
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
  return { detach, detached, readonly, detaching, recoverable, recoveryUncertain, failed, checkpointFailed, checkpoint, sendInline, requestReturn, viewRecovery, getSourceActionScope, startDrag: drag.start, dragging: drag.dragging, clickDetach }
}
