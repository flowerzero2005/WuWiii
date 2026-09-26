import type { ComposerDraft, ComposerSnapshot } from '../../shared/detached-composer'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'

import { mergeComposerSnapshot } from '../../shared/detached-composer'
import { composerChanged, composerDetach, composerExecute, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerViewRecovery } from '../../shared/detached-composer-events'

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
  const settleInvoke = useElectronEventaInvoke(composerSettle)
  const invalidateInvoke = useElectronEventaInvoke(composerInvalidate)
  const returnInvoke = useElectronEventaInvoke(composerRequestReturn)
  const recoveryInvoke = useElectronEventaInvoke(composerRecovery)
  const viewRecoveryInvoke = useElectronEventaInvoke(composerViewRecovery)
  const snapshot = ref<ComposerSnapshot>()
  const detaching = ref(false)
  const recoverable = ref(false)
  const recoveryUncertain = ref(false)
  const failed = ref(false)
  let generation = crypto.randomUUID()
  let disposed = false
  let executing = false
  let mirroredDraft: ComposerDraft | undefined
  function applyDraft(draft: ComposerDraft) {
    mirroredDraft = structuredClone(toRaw(draft))
    input.applyDraft(draft)
  }
  const handled = new Set<string>()
  const matches = (value: ComposerSnapshot) => value.scope.sourceGeneration === generation
    && value.scope.sessionId === input.sessionId() && value.scope.userScope === input.userScope()
    && value.scope.surface === input.surface
  const detached = computed(() => !!snapshot.value && matches(snapshot.value) && snapshot.value.status === 'detached')
  const readonly = computed(() => detached.value || detaching.value || !!(snapshot.value && matches(snapshot.value) && snapshot.value.uncertain))
  const offChanged = context.value.on(composerChanged, ({ body }) => {
    if (disposed || !body || !matches(body))
      return
    const previous = snapshot.value
    const merged = mergeComposerSnapshot(previous, body)
    if (merged === previous)
      return
    snapshot.value = merged
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
  async function detach(recover = false) {
    if (input.busy() || readonly.value || disposed)
      return
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    const sourceGeneration = generation
    detaching.value = true
    failed.value = false
    try {
      const value = await detachInvoke({ sessionId, userScope, surface: input.surface, sourceGeneration, group: input.group(), draft: input.draft(), recover })
      if (disposed || sourceGeneration !== generation || sessionId !== input.sessionId() || userScope !== input.userScope()) {
        await invalidateInvoke({ sourceGeneration })
        return
      }
      const merged = mergeComposerSnapshot(snapshot.value, value)
      snapshot.value = merged
      if (!merged.uncertain)
        applyDraft(merged.draft)
      recoverable.value = false
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
  watch(() => [input.sessionId(), input.userScope()], async () => {
    const previousGeneration = generation
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
    mirroredDraft = undefined
    snapshot.value = undefined
    const sessionId = input.sessionId()
    const userScope = input.userScope()
    recoverable.value = false
    try {
      const exists = await recoveryInvoke({ sessionId, userScope, surface: input.surface })
      if (!disposed && recoveryGeneration === generation && sessionId === input.sessionId() && userScope === input.userScope()) {
        recoverable.value = exists.exists
        recoveryUncertain.value = exists.uncertain
      }
    }
    catch {}
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    offChanged()
    offExecute()
    void invalidateInvoke({ sourceGeneration: generation }).catch(() => undefined)
  })
  function viewRecovery() {
    return viewRecoveryInvoke({ sessionId: input.sessionId(), userScope: input.userScope(), surface: input.surface }).catch(() => failed.value = true)
  }
  return { detach, detached, readonly, detaching, recoverable, recoveryUncertain, failed, requestReturn, viewRecovery }
}
