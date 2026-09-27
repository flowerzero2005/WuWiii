import type { ComposerDraft, ComposerSnapshot } from '../../shared/detached-composer'
import type { ComposerSourceAction, ComposerSourceActionName, ComposerSourceActionStatus } from '../../shared/detached-composer-events'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { VISION_IMAGE_LIMITS_I18N_PARAMS, VISION_MAX_IMAGE_BYTES, VISION_MAX_IMAGES, VISION_MAX_TOTAL_IMAGE_BYTES } from '@proj-airi/stage-ui/libs/vision-limits'
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'

import { mergeComposerSnapshot, validateComposerDraft } from '../../shared/detached-composer'
import { composerChanged, composerDiscard, composerDragCancel, composerDragMove, composerDragReturn, composerDragStart, composerEdit, composerEditorCloseAck, composerFlushAndClose, composerRead, composerRelease, composerSourceActionChanged, composerSourceActionRequest, composerSourceTextChanged, composerSubmit } from '../../shared/detached-composer-events'
import { useComposerPointerDrag } from './use-composer-pointer-drag'

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function composerSourceActionKey(action: Pick<ComposerSourceAction, 'leaseId' | 'version' | 'requestId'>) {
  return `${action.leaseId}:${action.version}:${action.requestId}`
}

const SOURCE_ACTION_TIMEOUT_MS = 10_000

/** An editor has no provider or chat runtime; it only commits acknowledged drafts. */
export function useDetachedComposerEditor(t: (key: string, params?: Record<string, number>) => string, imageReader = readImage) {
  const key = 'stage.chat.composer'
  const context = useElectronEventaContext()
  const read = useElectronEventaInvoke(composerRead)
  const edit = useElectronEventaInvoke(composerEdit)
  const submit = useElectronEventaInvoke(composerSubmit)
  const release = useElectronEventaInvoke(composerRelease)
  const editorCloseAck = useElectronEventaInvoke(composerEditorCloseAck)
  const dragCancel = useElectronEventaInvoke(composerDragCancel)
  const dragStart = useElectronEventaInvoke(composerDragStart)
  const dragMove = useElectronEventaInvoke(composerDragMove)
  const dragReturn = useElectronEventaInvoke(composerDragReturn)
  const requestSourceAction = useElectronEventaInvoke(composerSourceActionRequest)
  const discardInvoke = useElectronEventaInvoke(composerDiscard)
  const state = ref<ComposerSnapshot>()
  const draft = ref<ComposerDraft>({ text: '', images: [] })
  const dirty = ref(false)
  const syncing = ref(false)
  const closing = ref(false)
  const error = ref('')
  const dragOverReturnTarget = ref(false)
  const actionState = ref<Record<string, ComposerSourceActionStatus | undefined>>({})
  const actionPending = ref<Record<string, boolean>>({})
  const actionError = ref<Record<string, string | undefined>>({})
  let disposed = false
  let applying = false
  let revision = 0
  let imageEpoch = 0
  let lastDragMoveAt = 0
  let dragMoveRevision = 0
  let dragGestureId: string | undefined
  let pendingCloseAck: { leaseId: string, version: number, action: 'release' | 'discard' } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  const actionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const busy = computed(() => !!state.value?.busy || !!state.value?.uncertain || syncing.value || closing.value)
  function receive(value: ComposerSnapshot) {
    if (disposed)
      return
    const merged = mergeComposerSnapshot(state.value, value)
    if (merged === state.value)
      return
    state.value = merged
    if (!dirty.value) {
      applying = true
      draft.value = structuredClone(merged.draft)
      applying = false
    }
  }
  const offChanged = context.value.on(composerChanged, ({ body }) => body && receive(body))
  const offClose = context.value.on(composerFlushAndClose, () => void close())
  const offSourceActionChanged = context.value.on(composerSourceActionChanged, ({ body }) => {
    if (!body)
      return
    const key = composerSourceActionKey(body)
    if (!actionPending.value[key])
      return
    actionState.value[key] = body
    actionPending.value[key] = false
    actionError.value[key] = body.error
    const timer = actionTimers.get(key)
    if (timer)
      clearTimeout(timer)
    actionTimers.delete(key)
  })
  const offSourceTextChanged = context.value.on(composerSourceTextChanged, ({ body }) => {
    if (!body || !state.value || state.value.status !== 'detached' || state.value.scope.leaseId !== body.leaseId || state.value.scope.sourceGeneration !== body.sourceGeneration)
      return
    const text = body.text.trim()
    if (!text)
      return
    draft.value = validateComposerDraft({
      text: draft.value.text.trim() ? `${draft.value.text.trim()} ${text}` : text,
      images: draft.value.images,
    }, false)
  })
  watch(() => [state.value?.scope.leaseId, state.value?.status, state.value?.uncertain], () => imageEpoch += 1, { flush: 'sync' })
  watch(draft, () => {
    if (applying)
      return
    dirty.value = true
    revision += 1
    clearTimeout(timer)
    timer = setTimeout(() => void flush().catch(() => undefined), 150)
  }, { deep: true, flush: 'sync' })
  function flush() {
    clearTimeout(timer)
    if (flushPromise)
      return flushPromise
    flushPromise = (async () => {
      syncing.value = true
      try {
        while (dirty.value && state.value) {
          if (disposed)
            break
          const currentRevision = revision
          const value = await edit({ leaseId: state.value.scope.leaseId, version: state.value.version, draft: structuredClone(toRaw(draft.value)) })
          receive(value)
          if (currentRevision === revision)
            dirty.value = false
        }
        error.value = ''
      }
      catch (cause) {
        error.value = t(`${key}.sync-failed`)
        throw cause
      }
      finally {
        syncing.value = false
      }
    })().finally(() => flushPromise = undefined)
    return flushPromise
  }
  async function send() {
    if (!state.value || state.value.status !== 'detached' || busy.value)
      return
    try {
      await flush()
      if (disposed || state.value.status !== 'detached')
        return
      receive(await submit({ leaseId: state.value.scope.leaseId, version: state.value.version, commandId: crypto.randomUUID() }))
    }
    catch {
      error.value = t(`${key}.send-failed`)
    }
  }
  async function close() {
    if (closing.value || !state.value || disposed)
      return
    if (state.value.busy) {
      error.value = t(`${key}.wait-send`)
      return
    }
    closing.value = true
    try {
      if (pendingCloseAck) {
        await editorCloseAck(pendingCloseAck)
        pendingCloseAck = undefined
        return
      }
      await flush()
      const returned = await release({ leaseId: state.value.scope.leaseId, version: state.value.version })
      pendingCloseAck = { leaseId: returned.scope.leaseId, version: returned.version, action: 'release' }
      await editorCloseAck(pendingCloseAck)
      pendingCloseAck = undefined
    }
    catch {
      error.value = t(`${key}.sync-failed`)
      closing.value = false
    }
  }
  async function addImages(files: File[]) {
    if (!state.value || state.value.scope.group || state.value.status !== 'detached' || busy.value)
      return
    const leaseId = state.value.scope.leaseId
    const epoch = imageEpoch
    try {
      const currentBytes = draft.value.images.reduce((sum, image) => {
        const padding = image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0
        return sum + image.data.length * 3 / 4 - padding
      }, 0)
      if (draft.value.images.length + files.length > VISION_MAX_IMAGES
        || currentBytes + files.reduce((sum, file) => sum + file.size, 0) > VISION_MAX_TOTAL_IMAGE_BYTES) {
        throw new Error('Attachment limit exceeded.')
      }
      for (const file of files) {
        if (file.size > VISION_MAX_IMAGE_BYTES)
          throw new Error('Image too large.')
        const data = await imageReader(file)
        if (disposed || imageEpoch !== epoch || state.value?.scope.leaseId !== leaseId || state.value.busy || state.value.uncertain || closing.value)
          return
        draft.value = validateComposerDraft({ text: draft.value.text, images: [...draft.value.images, { id: crypto.randomUUID(), mimeType: file.type, data }] }, false)
      }
    }
    catch {
      error.value = t(`${key}.image-failed`, VISION_IMAGE_LIMITS_I18N_PARAMS)
    }
  }
  async function initialize() {
    try {
      const value = await read()
      if (value)
        receive(value)
    }
    catch {
      error.value = t(`${key}.sync-failed`)
    }
  }
  async function discard() {
    if (!state.value || state.value.busy || closing.value || disposed)
      return
    closing.value = true
    try {
      if (pendingCloseAck) {
        await editorCloseAck(pendingCloseAck)
        pendingCloseAck = undefined
        return
      }
      const discarded = await discardInvoke({ leaseId: state.value.scope.leaseId, version: state.value.version })
      pendingCloseAck = { leaseId: discarded.scope.leaseId, version: discarded.version, action: 'discard' }
      await editorCloseAck(pendingCloseAck)
      pendingCloseAck = undefined
    }
    catch {
      closing.value = false
      error.value = t(`${key}.sync-failed`)
    }
  }
  async function requestAction(action: ComposerSourceActionName) {
    if (!state.value || state.value.status !== 'detached' || closing.value || disposed)
      return
    const request = {
      leaseId: state.value.scope.leaseId,
      version: state.value.version,
      requestId: crypto.randomUUID(),
      action,
    }
    const actionKey = composerSourceActionKey(request)
    actionPending.value[actionKey] = true
    actionError.value[actionKey] = undefined
    actionTimers.set(actionKey, setTimeout(() => {
      if (actionPending.value[actionKey]) {
        actionPending.value[actionKey] = false
        actionError.value[actionKey] = t(`${key}.sync-failed`)
      }
      actionTimers.delete(actionKey)
    }, SOURCE_ACTION_TIMEOUT_MS))
    try {
      await requestSourceAction(request)
      return request.requestId
    }
    catch {
      actionPending.value[actionKey] = false
      actionError.value[actionKey] = t(`${key}.sync-failed`)
      const timer = actionTimers.get(actionKey)
      if (timer)
        clearTimeout(timer)
      actionTimers.delete(actionKey)
    }
  }
  function cancelDragReturnTarget() {
    dragMoveRevision += 1
    dragOverReturnTarget.value = false
    const value = state.value
    const gestureId = dragGestureId
    dragGestureId = undefined
    if (!value || !gestureId || value.status !== 'detached' || value.busy || value.uncertain)
      return
    void dragCancel({ leaseId: value.scope.leaseId, sourceGeneration: value.scope.sourceGeneration, version: value.version, gestureId }).catch(() => undefined)
  }
  const drag = useComposerPointerDrag(async (point, origin) => {
    dragMoveRevision += 1
    dragOverReturnTarget.value = false
    const gestureId = dragGestureId
    dragGestureId = undefined
    if (!state.value || !gestureId || state.value.status !== 'detached' || busy.value)
      return
    try {
      const leaseId = state.value.scope.leaseId
      const version = state.value.version
      if (!await dragReturn({ leaseId, version, gestureId, origin, point })) {
        // Missing the drop target only cancels this drag. The draft remains
        // editable, and the explicit return button does not use this path.
        return
      }
      if (disposed || state.value.scope.leaseId !== leaseId || state.value.status !== 'detached' || state.value.busy || state.value.uncertain)
        return
      await flush()
      if (!disposed && state.value.scope.leaseId === leaseId && state.value.status === 'detached' && !state.value.busy && !state.value.uncertain)
        await close()
    }
    catch {
      error.value = t(`${key}.return-target-unavailable`)
    }
  }, {
    cancel: cancelDragReturnTarget,
    move: (point, origin) => {
      const gestureId = dragGestureId
      if (!state.value || !gestureId || state.value.status !== 'detached' || busy.value || (lastDragMoveAt && performance.now() - lastDragMoveAt < 16))
        return
      lastDragMoveAt = performance.now()
      const revision = ++dragMoveRevision
      void dragMove({ leaseId: state.value.scope.leaseId, version: state.value.version, gestureId, origin, point }).then((overReturnTarget) => {
        if (!disposed && revision === dragMoveRevision)
          dragOverReturnTarget.value = !!overReturnTarget
      }).catch(() => undefined)
    },
  })
  function startDrag(event: PointerEvent) {
    const value = state.value
    if (event.button !== 0 || !event.isPrimary)
      return
    if (value?.status === 'detached' && !busy.value) {
      dragGestureId = crypto.randomUUID()
      void dragStart({ leaseId: value.scope.leaseId, version: value.version, gestureId: dragGestureId }).catch(() => undefined)
    }
    drag.start(event)
  }
  onScopeDispose(() => {
    cancelDragReturnTarget()
    disposed = true
    imageEpoch += 1
    clearTimeout(timer)
    actionTimers.forEach(clearTimeout)
    actionTimers.clear()
    offChanged()
    offClose()
    offSourceActionChanged()
    offSourceTextChanged()
  })
  return { state, draft, dirty, syncing, closing, error, busy, dragOverReturnTarget, actionState, actionPending, actionError, initialize, flush, send, close, addImages, discard, requestAction, startDrag, dragging: drag.dragging }
}
