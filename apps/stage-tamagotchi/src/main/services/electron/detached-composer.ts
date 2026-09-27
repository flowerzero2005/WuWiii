import type { BrowserWindow, Rectangle } from 'electron'

import type { ComposerDetach } from '../../../shared/detached-composer'
import type { ComposerClientRegion, ComposerPoint } from '../../../shared/detached-composer-geometry'
import type { ComposerPersistence } from './detached-composer-persistence'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow as ElectronWindow, screen } from 'electron'

import { createComposerState, validateComposerScope } from '../../../shared/detached-composer'
import { composerChanged, composerDetach, composerDiscard, composerDraftDiscarded, composerDragCancel, composerDragDetach, composerDragMove, composerDragReturn, composerEdit, composerExecute, composerFlushAndClose, composerFlushSource, composerInvalidate, composerRead, composerRecovery, composerRelease, composerRequestReturn, composerSettle, composerSourceAction, composerSourceActionChanged, composerSourceActionNames, composerSourceActionRequest, composerSourceActionStatus, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceReturnTargetState, composerSourceReveal, composerSourceSubmit, composerSourceTextAppend, composerSourceTextChanged, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { composerContainsPoint, composerScreenRegion } from '../../../shared/detached-composer-geometry'
import { createDetachedComposerWindow } from '../../windows/composer'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../windows/shared/window'
import { createComposerPersistence } from './detached-composer-persistence'

const CURSOR_POINT_TOLERANCE_PX = 64
const RETURN_TARGET_REGION_MAX_AGE_MS = 2_500
const SOURCE_ACTION_TIMEOUT_MS = 10_000
const SOURCE_ACTION_MAX_PENDING = 32

/** Register before creating renderer windows; every sender is verified in main. */
export function createDetachedComposerService(persistence: ComposerPersistence = createComposerPersistence(app.getPath('userData'))) {
  const state = createComposerState()
  const contexts = new Map<number, ReturnType<typeof createWindowEventaContext>['context']>()
  let editor: BrowserWindow | undefined
  let opening: Promise<BrowserWindow> | undefined
  let allowClose = false
  let quitting = false
  let quitRequested = false
  let persistenceFailure: unknown
  let queue = Promise.resolve()
  let editorDrag: { leaseId: string, version: number, origin: ComposerPoint, bounds: Rectangle } | undefined
  let finishedEditorDrag: { leaseId: string, version: number, origin: ComposerPoint, at: number } | undefined
  const sourceActions = new Map<string, { leaseId: string, version: number, sourceWebContentsId: number, sourceGeneration: string, action: string, at: number }>()
  const bindings = new Map<number, Omit<ComposerDetach, 'draft' | 'recover'>>()
  const regions = new Map<number, { generation: string, region: ComposerClientRegion, at: number }>()
  const sourceCloseAllowed = new Set<number>()
  const ready = persistence.load().then(data => state.restore(data)).catch(error => persistenceFailure = error)
  async function initialized() {
    await ready
    if (persistenceFailure)
      throw persistenceFailure
  }
  function commit<T>(mutation: () => T): Promise<T> {
    const task = queue.catch(() => undefined).then(async () => {
      await initialized()
      return state.commit(mutation, data => persistence.save(data))
    })
    queue = task.then(() => undefined, () => undefined)
    return task
  }
  function finishQuit() {
    if (quitRequested && !editor && !bindings.size) {
      quitting = true
      app.quit()
    }
  }
  function verifiedCursor(point: ComposerPoint) {
    const cursor = screen.getCursorScreenPoint()
    // Renderer and main receive the release through separate queues. The
    // actual cursor is still checked against the target below, so this only
    // absorbs hand-off latency rather than accepting an off-target drop.
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.hypot(point.x - cursor.x, point.y - cursor.y) > CURSOR_POINT_TOLERANCE_PX)
      throw new Error('The composer drag no longer owns the cursor position.')
    return cursor
  }
  const snapshot = () => state.read()
  const publish = () => {
    const value = snapshot()
    if (!value)
      return
    contexts.get(value.scope.sourceWebContentsId)?.emit(composerChanged, value)
    if (editor && !editor.isDestroyed())
      contexts.get(editor.webContents.id)?.emit(composerChanged, value)
    if (quitRequested && !value.busy && value.status !== 'returned' && editor && !editor.isDestroyed())
      editor.close()
  }
  async function openEditor() {
    if (editor && !editor.isDestroyed()) {
      editor.show()
      editor.focus()
      return editor
    }
    if (opening)
      return opening
    opening = createDetachedComposerWindow(window => editor = window).then((window) => {
      editor = window
      allowClose = false
      window.on('close', (event) => {
        if (allowClose || quitting)
          return
        event.preventDefault()
        const value = snapshot()
        if (value)
          contexts.get(window.webContents.id)?.emit(composerFlushAndClose, value)
      })
      window.webContents.on('render-process-gone', () => {
        const value = snapshot()
        sourceActions.clear()
        if (value) {
          publishSourceReturnTargetState(value, false)
          void commit(() => {
            state.invalidate(value.scope.sourceWebContentsId)
            return state.release({ leaseId: value.scope.leaseId, version: value.version })
          }).then(publish).catch(() => undefined)
        }
        allowClose = true
        window.destroy()
      })
      window.once('closed', () => {
        if (editor === window) {
          editor = undefined
          sourceActions.clear()
        }
        finishQuit()
      })
      window.on('focus', () => {
        if (editor === window && snapshot()?.status === 'detached') {
          window.setAlwaysOnTop(true, 'screen-saver', 2)
          window.moveTop()
        }
      })
      return window
    }).finally(() => opening = undefined)
    return opening
  }
  function requireEditor(id: number) {
    if (!editor || editor.isDestroyed() || editor.webContents.id !== id)
      throw new Error('Only the current editing window can modify this draft.')
  }
  function requireSource(id: number) {
    if (snapshot()?.scope.sourceWebContentsId !== id)
      throw new Error('This window does not own the composer source.')
  }
  function requireConversation(window: BrowserWindow) {
    if (editor?.webContents.id === window.webContents.id)
      throw new Error('An editor cannot become a chat source.')
    const route = new URL(window.webContents.getURL()).hash.slice(1).split('?')[0] || '/'
    if (!['/', '/chat', '/quick-chat'].includes(route))
      throw new Error('Only a conversation window can access its composer.')
  }
  function returnTarget(value: NonNullable<ReturnType<typeof snapshot>>) {
    const source = ElectronWindow.getAllWindows().find(window => window.webContents.id === value.scope.sourceWebContentsId)
    if (!source || source.isDestroyed() || !source.isVisible() || source.isMinimized())
      return
    // Once detached, the source replaces its inline input with a narrow
    // return strip. The whole source content area remains a valid drop target
    // so a return does not depend on renderer layout timing.
    return source
  }
  function publishSourceReturnTargetState(value: NonNullable<ReturnType<typeof snapshot>>, active: boolean) {
    contexts.get(value.scope.sourceWebContentsId)?.emit(composerSourceReturnTargetState, {
      sourceGeneration: value.scope.sourceGeneration,
      active,
    })
  }
  function clearSourceActions(predicate: (action: { leaseId: string, version: number, sourceWebContentsId: number, sourceGeneration: string, action: string, at: number }) => boolean) {
    for (const [requestId, action] of sourceActions) {
      if (predicate(action))
        sourceActions.delete(requestId)
    }
  }
  function pruneSourceActions() {
    const expiresAt = Date.now() - SOURCE_ACTION_TIMEOUT_MS
    clearSourceActions(action => action.at < expiresAt)
  }
  function register(window: BrowserWindow) {
    const id = window.webContents.id
    if (contexts.has(id))
      return
    const { context, dispose } = createWindowEventaContext(window)
    contexts.set(id, context)
    const invalidate = () => {
      if (editor?.webContents.id !== id) {
        clearSourceActions(action => action.sourceWebContentsId === id)
        void commit(() => state.invalidate(id)).then(publish).catch(() => undefined)
      }
    }
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame)
        invalidate()
    })
    window.webContents.on('render-process-gone', () => {
      if (editor?.webContents.id === id)
        return
      bindings.delete(id)
      regions.delete(id)
      clearSourceActions(action => action.sourceWebContentsId === id)
      void commit(() => state.invalidate(id)).then(publish).catch(() => undefined).finally(finishQuit)
    })
    window.webContents.once('destroyed', () => {
      invalidate()
      bindings.delete(id)
      regions.delete(id)
      clearSourceActions(action => action.sourceWebContentsId === id)
      contexts.delete(id)
      dispose()
      finishQuit()
    })
    window.on('close', (event) => {
      const binding = bindings.get(id)
      if (!binding || sourceCloseAllowed.has(id) || quitting || editor?.webContents.id === id)
        return
      event.preventDefault()
      context.emit(composerFlushSource, { sourceGeneration: binding.sourceGeneration })
    })
    async function detach(input: ComposerDetach, point?: ComposerPoint) {
      requireConversation(window)
      if (point && composerContainsPoint(window.getContentBounds(), verifiedCursor(point)))
        throw new Error('Drag the composer outside the source window before detaching.')
      const value = await commit(() => state.detach(id, input))
      editorDrag = undefined
      // The source can hide its inline editor as soon as ownership is durable.
      // Loading the separate renderer may take longer than the drag gesture.
      publish()
      try {
        const editor = await openEditor()
        if (point) {
          const display = screen.getDisplayNearestPoint(point).workArea
          const bounds = editor.getBounds()
          editor.setPosition(Math.round(Math.max(display.x, Math.min(point.x - 30, display.x + display.width - bounds.width))), Math.round(Math.max(display.y, Math.min(point.y - 30, display.y + display.height - bounds.height))))
        }
        publish()
        return snapshot()!
      }
      catch (error) {
        await commit(() => {
          state.invalidate(id)
          state.release({ leaseId: value.scope.leaseId, version: value.version })
        })
        publish()
        throw error
      }
    }
    defineInvokeHandler(context, composerDetach, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      return detach(input)
    })
    defineInvokeHandler(context, composerDragDetach, async (input, options) => {
      if (isIpcEventFromWindow(window, options))
        return detach(input, input.point)
    })
    defineInvokeHandler(context, composerDragMove, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      if (![input.origin.x, input.origin.y, input.point.x, input.point.y].every(Number.isFinite))
        throw new Error('Invalid composer drag position.')
      if (finishedEditorDrag && Date.now() - finishedEditorDrag.at > RETURN_TARGET_REGION_MAX_AGE_MS)
        finishedEditorDrag = undefined
      if (finishedEditorDrag?.leaseId === input.leaseId && finishedEditorDrag.version === input.version
        && finishedEditorDrag.origin.x === input.origin.x && finishedEditorDrag.origin.y === input.origin.y) {
        publishSourceReturnTargetState(value, false)
        return false
      }
      if (!editorDrag || editorDrag.leaseId !== input.leaseId || editorDrag.version !== input.version
        || editorDrag.origin.x !== input.origin.x || editorDrag.origin.y !== input.origin.y) {
        editorDrag = { leaseId: input.leaseId, version: input.version, origin: input.origin, bounds: editor!.getBounds() }
      }
      const display = screen.getDisplayNearestPoint(input.point).workArea
      const x = Math.round(Math.max(display.x, Math.min(editorDrag.bounds.x + input.point.x - editorDrag.origin.x, display.x + display.width - editorDrag.bounds.width)))
      const y = Math.round(Math.max(display.y, Math.min(editorDrag.bounds.y + input.point.y - editorDrag.origin.y, display.y + display.height - editorDrag.bounds.height)))
      editor!.setPosition(x, y)
      const source = returnTarget(value)
      const active = !!source && composerContainsPoint(source.getContentBounds(), screen.getCursorScreenPoint())
      publishSourceReturnTargetState(value, active)
      return active
    })
    defineInvokeHandler(context, composerSourceRead, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      await initialized()
      await queue
      validateComposerScope(input)
      if (!input || typeof input.sourceGeneration !== 'string' || !input.sourceGeneration || input.sourceGeneration.length > 256)
        throw new Error('Invalid composer source generation.')
      bindings.set(id, { userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, group: input.group, sourceGeneration: input.sourceGeneration })
      sourceCloseAllowed.delete(id)
      regions.delete(id)
      const value = state.recovery(input.userScope, input.sessionId, input.surface)
      return { version: state.draftVersion(input), draft: value?.draft, uncertain: !!value?.uncertain }
    })
    defineInvokeHandler(context, composerSourceCheckpoint, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      return commit(() => {
        const binding = bindings.get(id)
        if (!binding || binding.sourceGeneration !== input.sourceGeneration || binding.userScope !== input.userScope
          || binding.sessionId !== input.sessionId || binding.surface !== input.surface || binding.group !== input.group) {
          throw new Error('The inline draft no longer owns this source scope.')
        }
        return state.sourceDraft(id, input)
      })
    })
    defineInvokeHandler(context, composerSourceRegion, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      if (bindings.get(id)?.sourceGeneration !== input.sourceGeneration)
        throw new Error('The composer region belongs to an older conversation.')
      composerScreenRegion(input.region, window.getContentBounds(), window.webContents.getZoomFactor())
      regions.set(id, { generation: input.sourceGeneration, region: structuredClone(input.region), at: Date.now() })
    })
    defineInvokeHandler(context, composerSourceSubmit, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      return commit(() => {
        const binding = bindings.get(id)
        if (!binding || binding.sourceGeneration !== input.sourceGeneration || binding.userScope !== input.userScope
          || binding.sessionId !== input.sessionId || binding.surface !== input.surface || binding.group !== input.group) {
          throw new Error('The inline send no longer owns this source scope.')
        }
        return state.sourceSubmit(id, input)
      })
    })
    defineInvokeHandler(context, composerSourceActionRequest, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached')
        throw new Error('The composer ownership changed before this action could run.')
      if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128 || !composerSourceActionNames.includes(input.action))
        throw new Error('Invalid composer source action.')
      const binding = bindings.get(value.scope.sourceWebContentsId)
      const sourceContext = contexts.get(value.scope.sourceWebContentsId)
      if (!binding || binding.sourceGeneration !== value.scope.sourceGeneration || !sourceContext)
        throw new Error('The original conversation is no longer available.')
      pruneSourceActions()
      if (sourceActions.size >= SOURCE_ACTION_MAX_PENDING)
        throw new Error('Too many composer source actions are pending.')
      if (sourceActions.has(input.requestId))
        throw new Error('This composer source action is already pending.')
      sourceActions.set(input.requestId, { leaseId: value.scope.leaseId, version: value.version, sourceWebContentsId: value.scope.sourceWebContentsId, sourceGeneration: value.scope.sourceGeneration, action: input.action, at: Date.now() })
      sourceContext.emit(composerSourceAction, input)
    })
    defineInvokeHandler(context, composerSourceActionStatus, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      const pending = sourceActions.get(input.requestId)
      if (!value || value.status !== 'detached' || value.scope.leaseId !== input.leaseId || value.scope.sourceGeneration !== input.sourceGeneration
        || !pending || pending.sourceWebContentsId !== id || pending.leaseId !== input.leaseId || pending.version !== input.version
        || pending.sourceGeneration !== input.sourceGeneration || pending.action !== input.action) {
        throw new Error('The composer source action is no longer current.')
      }
      sourceActions.delete(input.requestId)
      contexts.get(editor?.webContents.id ?? -1)?.emit(composerSourceActionChanged, input)
    })
    defineInvokeHandler(context, composerSourceTextAppend, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      if (!value || value.status !== 'detached' || value.scope.leaseId !== input.leaseId || value.scope.sourceGeneration !== input.sourceGeneration
        || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8_000) {
        throw new Error('The detached composer no longer accepts source text.')
      }
      contexts.get(editor?.webContents.id ?? -1)?.emit(composerSourceTextChanged, { ...input, version: value.version })
    })
    defineInvokeHandler(context, composerSourceReveal, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      if (!value || value.status !== 'detached' || value.scope.leaseId !== input.leaseId || value.scope.sourceGeneration !== input.sourceGeneration)
        throw new Error('The detached composer visibility request is no longer current.')
      if (input.restore) {
        editor?.setAlwaysOnTop(true, 'screen-saver', 2)
        editor?.show()
        editor?.moveTop()
      }
      else {
        editor?.setAlwaysOnTop(false)
        window.focus()
      }
    })
    defineInvokeHandler(context, composerDragReturn, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      if (input.origin)
        finishedEditorDrag = { leaseId: input.leaseId, version: input.version, origin: input.origin, at: Date.now() }
      editorDrag = undefined
      const source = returnTarget(value)
      try {
        return !!source && composerContainsPoint(source.getContentBounds(), verifiedCursor(input.point))
      }
      finally {
        publishSourceReturnTargetState(value, false)
      }
    })
    defineInvokeHandler(context, composerDragCancel, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version
        || value.scope.sourceGeneration !== input.sourceGeneration || value.status !== 'detached' || value.busy) {
        throw new Error('The composer ownership changed during the drag.')
      }
      editorDrag = undefined
      finishedEditorDrag = undefined
      publishSourceReturnTargetState(value, false)
    })
    defineInvokeHandler(context, composerSourceCloseAck, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      if (bindings.get(id)?.sourceGeneration !== input.sourceGeneration)
        throw new Error('The close acknowledgement belongs to an older source.')
      await queue
      if (bindings.get(id)?.sourceGeneration !== input.sourceGeneration)
        throw new Error('The close acknowledgement belongs to an older source.')
      sourceCloseAllowed.add(id)
      window.close()
    })
    defineInvokeHandler(context, composerRead, async (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      await initialized()
      await queue
      const value = snapshot()
      return value && (value.scope.sourceWebContentsId === id || editor?.webContents.id === id) ? value : undefined
    })
    defineInvokeHandler(context, composerRecovery, async (input, options) => {
      if (isIpcEventFromWindow(window, options)) {
        requireConversation(window)
        await initialized()
        await queue
        const value = state.recovery(input.userScope, input.sessionId, input.surface)
        return { exists: !!value, uncertain: !!value?.uncertain, version: state.draftVersion(input), draft: value?.draft }
      }
    })
    defineInvokeHandler(context, composerViewRecovery, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      await commit(() => state.viewRecovery(input.userScope, input.sessionId, input.surface))
      await openEditor()
      publish()
    })
    defineInvokeHandler(context, composerEdit, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = await commit(() => state.edit(input))
      publish()
      return value
    })
    defineInvokeHandler(context, composerSubmit, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      // Persist the uncertainty marker before a paid pipeline can execute.
      const result = await commit(() => state.submit(input))
      publish()
      if (result.execute)
        contexts.get(result.snapshot.scope.sourceWebContentsId)?.emit(composerExecute, result.snapshot)
      return result.snapshot
    })
    defineInvokeHandler(context, composerSettle, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      const value = await commit(() => state.settle(id, input))
      publish()
      return value
    })
    defineInvokeHandler(context, composerInvalidate, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      await commit(() => state.invalidate(id, input.sourceGeneration))
      publish()
    })
    defineInvokeHandler(context, composerRequestReturn, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      if (!value || input.leaseId !== value.scope.leaseId || input.version !== value.version)
        throw new Error('The composer ownership changed.')
      contexts.get(editor?.webContents.id ?? -1)?.emit(composerFlushAndClose, value)
    })
    defineInvokeHandler(context, composerRelease, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = await commit(() => state.release(input))
      editorDrag = undefined
      finishedEditorDrag = undefined
      sourceActions.clear()
      publishSourceReturnTargetState(value, false)
      publish()
      const source = returnTarget(value)
      source?.focus()
      allowClose = true
      editor?.close()
      return value
    })
    defineInvokeHandler(context, composerDiscard, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = await commit(() => state.discard(input))
      editorDrag = undefined
      finishedEditorDrag = undefined
      sourceActions.clear()
      publish()
      for (const [sourceId, binding] of bindings) {
        if (binding.userScope === value.scope.userScope && binding.sessionId === value.scope.sessionId && binding.surface === value.scope.surface)
          contexts.get(sourceId)?.emit(composerDraftDiscarded, { userScope: value.scope.userScope, sessionId: value.scope.sessionId, surface: value.scope.surface, version: value.version })
      }
      allowClose = true
      editor?.close()
      return value
    })
  }
  const onCreated = (_event: unknown, window: BrowserWindow) => register(window)
  app.on('browser-window-created', onCreated)
  app.on('before-quit', (event) => {
    if (quitting || (!editor && !bindings.size)) {
      quitting = true
      return
    }
    event.preventDefault()
    quitRequested = true
    for (const window of ElectronWindow.getAllWindows()) {
      if (bindings.has(window.webContents.id) || editor === window)
        window.close()
    }
    finishQuit()
  })
  ElectronWindow.getAllWindows().forEach(register)
  return { read: snapshot, dispose: () => app.removeListener('browser-window-created', onCreated) }
}
