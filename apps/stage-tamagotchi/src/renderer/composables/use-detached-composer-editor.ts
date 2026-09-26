import type { ComposerDraft, ComposerSnapshot } from '../../shared/detached-composer'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed, onScopeDispose, ref, toRaw, watch } from 'vue'

import { mergeComposerSnapshot, validateComposerDraft } from '../../shared/detached-composer'
import { composerChanged, composerDiscard, composerDragMove, composerDragReturn, composerEdit, composerFlushAndClose, composerRead, composerRelease, composerSubmit } from '../../shared/detached-composer-events'
import { useComposerPointerDrag } from './use-composer-pointer-drag'

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** An editor has no provider or chat runtime; it only commits acknowledged drafts. */
export function useDetachedComposerEditor(t: (key: string) => string, imageReader = readImage) {
  const key = 'stage.chat.composer'
  const context = useElectronEventaContext()
  const read = useElectronEventaInvoke(composerRead)
  const edit = useElectronEventaInvoke(composerEdit)
  const submit = useElectronEventaInvoke(composerSubmit)
  const release = useElectronEventaInvoke(composerRelease)
  const dragMove = useElectronEventaInvoke(composerDragMove)
  const dragReturn = useElectronEventaInvoke(composerDragReturn)
  const discardInvoke = useElectronEventaInvoke(composerDiscard)
  const state = ref<ComposerSnapshot>()
  const draft = ref<ComposerDraft>({ text: '', images: [] })
  const dirty = ref(false)
  const syncing = ref(false)
  const closing = ref(false)
  const error = ref('')
  const dragOverReturnTarget = ref(false)
  let disposed = false
  let applying = false
  let revision = 0
  let imageEpoch = 0
  let lastDragMoveAt = 0
  let dragMoveRevision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
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
      await flush()
      await release({ leaseId: state.value.scope.leaseId, version: state.value.version })
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
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error('Image too large.')
        const data = await imageReader(file)
        if (disposed || imageEpoch !== epoch || state.value?.scope.leaseId !== leaseId || state.value.busy || state.value.uncertain || closing.value)
          return
        draft.value = validateComposerDraft({ text: draft.value.text, images: [...draft.value.images, { id: crypto.randomUUID(), mimeType: file.type, data }] }, false)
      }
    }
    catch {
      error.value = t(`${key}.image-failed`)
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
      await discardInvoke({ leaseId: state.value.scope.leaseId, version: state.value.version })
    }
    catch {
      closing.value = false
      error.value = t(`${key}.sync-failed`)
    }
  }
  const drag = useComposerPointerDrag(async (point, origin) => {
    dragMoveRevision += 1
    dragOverReturnTarget.value = false
    if (!state.value || state.value.status !== 'detached' || busy.value)
      return
    try {
      const leaseId = state.value.scope.leaseId
      const version = state.value.version
      if (!await dragReturn({ leaseId, version, origin, point })) {
        error.value = t(`${key}.return-target-unavailable`)
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
    move: (point, origin) => {
      if (!state.value || state.value.status !== 'detached' || busy.value || (lastDragMoveAt && performance.now() - lastDragMoveAt < 16))
        return
      lastDragMoveAt = performance.now()
      const revision = ++dragMoveRevision
      void dragMove({ leaseId: state.value.scope.leaseId, version: state.value.version, origin, point }).then((overReturnTarget) => {
        if (!disposed && revision === dragMoveRevision)
          dragOverReturnTarget.value = !!overReturnTarget
      }).catch(() => undefined)
    },
  })
  onScopeDispose(() => {
    disposed = true
    imageEpoch += 1
    clearTimeout(timer)
    offChanged()
    offClose()
  })
  return { state, draft, dirty, syncing, closing, error, busy, dragOverReturnTarget, initialize, flush, send, close, addImages, discard, startDrag: drag.start, dragging: drag.dragging }
}
