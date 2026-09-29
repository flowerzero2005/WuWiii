import type { BrowserWindow, Rectangle } from 'electron'

import type { ComposerDetach } from '../../../shared/detached-composer'
import type { ComposerClientRegion, ComposerPoint } from '../../../shared/detached-composer-geometry'
import type { ComposerPersistence } from './detached-composer-persistence'
import type { DesktopDiagnostics } from '../../libs/electron/desktop-diagnostics'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow as ElectronWindow, screen } from 'electron'

import { createComposerState, validateComposerScope } from '../../../shared/detached-composer'
import { composerChanged, composerDetach, composerDiscard, composerDraftDiscarded, composerDragCancel, composerDragDetach, composerDragMove, composerDragReturn, composerDragStart, composerEdit, composerEditorCloseAck, composerExecute, composerFlushAndClose, composerFlushSource, composerInvalidate, composerRead, composerRecovery, composerRelease, composerRequestReturn, composerSettle, composerSourceAction, composerSourceActionChanged, composerSourceActionNames, composerSourceActionRequest, composerSourceActionStatus, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceReturnAck, composerSourceReturnTargetState, composerSourceReveal, composerSourceSubmit, composerSourceTextAppend, composerSourceTextChanged, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { composerContainsPoint, composerScreenRegion } from '../../../shared/detached-composer-geometry'
import { createDetachedComposerWindow, DETACHED_COMPOSER_TOP_LEVEL } from '../../windows/composer'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../windows/shared/window'
import { createComposerPersistence } from './detached-composer-persistence'

const RETURN_TARGET_REGION_MAX_AGE_MS = 2_500
const SOURCE_RETURN_ACK_TIMEOUT_MS = 2_000
const SOURCE_ACTION_TIMEOUT_MS = 10_000
const SOURCE_ACTION_MAX_PENDING = 32

/** Register before creating renderer windows; every sender is verified in main. */
export function createDetachedComposerService(
  persistence: ComposerPersistence = createComposerPersistence(app.getPath('userData')),
  diagnostics?: Pick<DesktopDiagnostics, 'record'>,
) {
  const state = createComposerState()
  const contexts = new Map<number, ReturnType<typeof createWindowEventaContext>['context']>()
  let editor: BrowserWindow | undefined
  let opening: Promise<BrowserWindow> | undefined
  let allowClose = false
  let quitting = false
  let quitRequested = false
  let persistenceFailure: unknown
  let queue = Promise.resolve()
  let editorDrag: { leaseId: string, version: number, gestureId: string, origin?: ComposerPoint, bounds: Rectangle, cursor: ComposerPoint, returnTargetActive?: boolean } | undefined
  let finishedEditorDrag: { leaseId: string, version: number, gestureId: string, origin: ComposerPoint, at: number } | undefined
  let pendingEditorClose: { editorWebContentsId: number, leaseId: string, version: number, action: 'release' | 'discard', sourceGeneration?: string, sourceWebContentsId?: number, editorAcknowledged?: boolean, sourceAcknowledged?: boolean } | undefined
  let sourceReturnAckTimer: ReturnType<typeof setTimeout> | undefined
  let returnFocus: { leaseId: string, sourceWebContentsId: number, version: number } | undefined
  let releaseInFlightSourceWebContentsId: number | undefined
  let releaseInFlightCount = 0
  const sourceActions = new Map<string, { leaseId: string, version: number, sourceWebContentsId: number, sourceGeneration: string, action: string, at: number }>()
  const bindings = new Map<number, Omit<ComposerDetach, 'draft' | 'recover'>>()
  const regions = new Map<number, { generation: string, region: ComposerClientRegion, at: number }>()
  const sourceCloseAllowed = new Set<number>()
  const sourceCloseAttempts = new Map<number, { sourceGeneration: string, closeAttemptId: string }>()
  const ready = persistence.load().then(data => state.restore(data)).catch(error => persistenceFailure = error)
  function composerFailureCategory(error: unknown) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('no longer owns') || message.includes('ownership changed') || message.includes('already owns') || message.includes('detached editor owns'))
      return 'ownership-race'
    if (message.includes('saved draft version changed'))
      return 'revision-conflict'
    if (message.includes('submit outcome is unknown'))
      return 'unknown-submit-outcome'
    if (message.includes('Invalid'))
      return 'invalid-request'
    if (message.includes('capacity'))
      return 'draft-capacity'
    if (persistenceFailure)
      return 'persistence-unavailable'
    return 'operation-failed'
  }
  function recordComposerFailure(operation: 'detach' | 'drag-detach' | 'source-checkpoint' | 'return-request', error: unknown) {
    // Diagnostics deliberately keep only a stable failure category. Draft text,
    // image data, leases, session IDs and window IDs must never enter this log.
    diagnostics?.record('composer-source-operation-failed', { operation, category: composerFailureCategory(error) })
  }
  function editorWebContentsId() {
    return editor && !editor.isDestroyed() ? editor.webContents.id : undefined
  }
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
  function focusReturnedSource() {
    const target = returnFocus
    returnFocus = undefined
    if (!target)
      return
    const value = snapshot()
    if (!value || value.status !== 'returned' || value.scope.leaseId !== target.leaseId || value.version !== target.version) {
      diagnostics?.record('composer-return-source-focus-skipped', { reason: 'state-changed', sourceWebContentsId: target.sourceWebContentsId })
      return
    }
    const source = sourceWindow(value)
    if (!source) {
      diagnostics?.record('composer-return-source-focus-skipped', { reason: 'source-missing', sourceWebContentsId: target.sourceWebContentsId })
      return
    }
    try {
      if (source.isMinimized())
        source.restore()
      source.show()
      source.focus()
      diagnostics?.record('composer-return-source-focused', { sourceWebContentsId: target.sourceWebContentsId })
    }
    catch {
      diagnostics?.record('composer-return-source-focus-skipped', { reason: 'native-operation-failed', sourceWebContentsId: target.sourceWebContentsId })
    }
  }
  function verifiedCursor(point: ComposerPoint) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('Invalid composer drag position.')
    // DOM screen coordinates and Electron screen coordinates can use
    // different DPI units on Windows. Use the main-process cursor for the
    // target check instead of comparing coordinates from those two spaces.
    return screen.getCursorScreenPoint()
  }
  function requireDragGesture(gestureId: unknown) {
    if (typeof gestureId !== 'string' || !gestureId || gestureId.length > 128)
      throw new Error('Invalid composer drag gesture.')
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
      const editorId = window.webContents.id
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
        pendingEditorClose = undefined
        clearTimeout(sourceReturnAckTimer)
        sourceReturnAckTimer = undefined
        window.destroy()
      })
      window.once('closed', () => {
        if (editor === window) {
          editor = undefined
          sourceActions.clear()
          pendingEditorClose = undefined
          clearTimeout(sourceReturnAckTimer)
          sourceReturnAckTimer = undefined
        }
        diagnostics?.record('composer-editor-closed', { webContentsId: editorId })
        focusReturnedSource()
        finishQuit()
      })
      window.on('focus', () => {
        if (editor === window && snapshot()?.status === 'detached') {
          window.setAlwaysOnTop(true, 'screen-saver', DETACHED_COMPOSER_TOP_LEVEL)
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
    if (editorWebContentsId() === window.webContents.id)
      throw new Error('An editor cannot become a chat source.')
    const route = new URL(window.webContents.getURL()).hash.slice(1).split('?')[0] || '/'
    if (!['/', '/chat', '/quick-chat'].includes(route))
      throw new Error('Only a conversation window can access its composer.')
  }
  function sourceWindow(value: NonNullable<ReturnType<typeof snapshot>>) {
    const source = ElectronWindow.getAllWindows().find(window => window.webContents.id === value.scope.sourceWebContentsId)
    if (!source || source.isDestroyed())
      return
    return source
  }
  function returnTarget(value: NonNullable<ReturnType<typeof snapshot>>) {
    const source = sourceWindow(value)
    if (!source || !source.isVisible() || source.isMinimized())
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
  function closeAcknowledgedEditor() {
    const pending = pendingEditorClose
    if (!pending || !pending.editorAcknowledged || (pending.action === 'release' && !pending.sourceAcknowledged))
      return
    const currentEditor = editor
    if (!currentEditor || currentEditor.isDestroyed() || currentEditor.webContents.id !== pending.editorWebContentsId)
      return
    pendingEditorClose = undefined
    clearTimeout(sourceReturnAckTimer)
    sourceReturnAckTimer = undefined
    allowClose = true
    // The editor has acknowledged the durable handoff. The source either
    // acknowledged it or will restore the persisted draft when remounted.
    // Yield so the editor acknowledgement reply precedes its close.
    setImmediate(() => {
      if (editor === currentEditor && !currentEditor.isDestroyed())
        currentEditor.close()
    })
  }
  function register(window: BrowserWindow) {
    const id = window.webContents.id
    if (contexts.has(id))
      return
    const { context, dispose } = createWindowEventaContext(window)
    contexts.set(id, context)
    const invalidate = () => {
      if (editor !== window) {
        clearSourceActions(action => action.sourceWebContentsId === id)
        void commit(() => state.invalidate(id)).then(publish).catch(() => undefined)
      }
    }
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame)
        invalidate()
    })
    window.webContents.on('render-process-gone', () => {
      if (editor === window)
        return
      bindings.delete(id)
      regions.delete(id)
      sourceCloseAttempts.delete(id)
      clearSourceActions(action => action.sourceWebContentsId === id)
      void commit(() => state.invalidate(id)).then(publish).catch(() => undefined).finally(finishQuit)
    })
    window.webContents.once('destroyed', () => {
      invalidate()
      bindings.delete(id)
      regions.delete(id)
      sourceCloseAttempts.delete(id)
      clearSourceActions(action => action.sourceWebContentsId === id)
      contexts.delete(id)
      dispose()
      finishQuit()
    })
    window.on('close', (event) => {
      const binding = bindings.get(id)
      if (!binding || sourceCloseAllowed.has(id) || quitting || editor === window)
        return
      if (releaseInFlightCount && releaseInFlightSourceWebContentsId === id) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      const closeAttempt = { sourceGeneration: binding.sourceGeneration, closeAttemptId: crypto.randomUUID() }
      sourceCloseAttempts.set(id, closeAttempt)
      context.emit(composerFlushSource, closeAttempt)
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
      try {
        return await detach(input)
      }
      catch (error) {
        recordComposerFailure('detach', error)
        throw error
      }
    })
    defineInvokeHandler(context, composerDragDetach, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      try {
        return await detach(input, input.point)
      }
      catch (error) {
        recordComposerFailure('drag-detach', error)
        throw error
      }
    })
    defineInvokeHandler(context, composerDragStart, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      requireDragGesture(input.gestureId)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      if (finishedEditorDrag && Date.now() - finishedEditorDrag.at > RETURN_TARGET_REGION_MAX_AGE_MS)
        finishedEditorDrag = undefined
      if (finishedEditorDrag?.leaseId === input.leaseId && finishedEditorDrag.version === input.version && finishedEditorDrag.gestureId === input.gestureId)
        return
      // Move can arrive before this invoke response. Keep the session that
      // move created when both messages belong to the same gesture.
      if (!editorDrag || editorDrag.leaseId !== input.leaseId || editorDrag.version !== input.version || editorDrag.gestureId !== input.gestureId)
        editorDrag = { leaseId: input.leaseId, version: input.version, gestureId: input.gestureId, bounds: editor!.getBounds(), cursor: screen.getCursorScreenPoint() }
      finishedEditorDrag = undefined
    })
    defineInvokeHandler(context, composerDragMove, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      requireDragGesture(input.gestureId)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      if (![input.origin.x, input.origin.y, input.point.x, input.point.y].every(Number.isFinite))
        throw new Error('Invalid composer drag position.')
      if (finishedEditorDrag && Date.now() - finishedEditorDrag.at > RETURN_TARGET_REGION_MAX_AGE_MS)
        finishedEditorDrag = undefined
      if (finishedEditorDrag?.leaseId === input.leaseId && finishedEditorDrag.version === input.version && finishedEditorDrag.gestureId === input.gestureId
        && finishedEditorDrag.origin.x === input.origin.x && finishedEditorDrag.origin.y === input.origin.y) {
        publishSourceReturnTargetState(value, false)
        return false
      }
      if (editorDrag && editorDrag.leaseId === input.leaseId && editorDrag.version === input.version && editorDrag.gestureId !== input.gestureId) {
        publishSourceReturnTargetState(value, false)
        return false
      }
      if (!editorDrag || editorDrag.leaseId !== input.leaseId || editorDrag.version !== input.version || editorDrag.gestureId !== input.gestureId
        || (editorDrag.origin && (editorDrag.origin.x !== input.origin.x || editorDrag.origin.y !== input.origin.y))) {
        editorDrag = { leaseId: input.leaseId, version: input.version, gestureId: input.gestureId, origin: input.origin, bounds: editor!.getBounds(), cursor: verifiedCursor(input.point) }
      }
      editorDrag.origin ??= input.origin
      const cursor = verifiedCursor(input.point)
      const display = screen.getDisplayNearestPoint(cursor).workArea
      const x = Math.round(Math.max(display.x, Math.min(editorDrag.bounds.x + cursor.x - editorDrag.cursor.x, display.x + display.width - editorDrag.bounds.width)))
      const y = Math.round(Math.max(display.y, Math.min(editorDrag.bounds.y + cursor.y - editorDrag.cursor.y, display.y + display.height - editorDrag.bounds.height)))
      editor!.setPosition(x, y)
      const source = returnTarget(value)
      const active = !!source && composerContainsPoint(source.getContentBounds(), screen.getCursorScreenPoint())
      editorDrag.returnTargetActive = active
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
      sourceCloseAttempts.delete(id)
      regions.delete(id)
      const current = snapshot()
      if (current && (current.scope.sourceWebContentsId === id || !sourceWindow(current))
        && current.scope.sourceGeneration !== input.sourceGeneration) {
        await commit(() => state.rebindSource(id, input))
        publish()
      }
      const value = state.recovery(input.userScope, input.sessionId, input.surface)
      const returned = current?.status === 'returned'
        && current.scope.userScope === input.userScope && current.scope.sessionId === input.sessionId && current.scope.surface === input.surface
      const draft = returned && current ? current.draft : value?.draft
      return { version: state.draftVersion(input), draft, uncertain: returned ? !!current?.uncertain : !!value?.uncertain, returned }
    })
    defineInvokeHandler(context, composerSourceCheckpoint, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      try {
        return await commit(() => {
          const binding = bindings.get(id)
          if (!binding || binding.sourceGeneration !== input.sourceGeneration || binding.userScope !== input.userScope
            || binding.sessionId !== input.sessionId || binding.surface !== input.surface || binding.group !== input.group) {
            throw new Error('The inline draft no longer owns this source scope.')
          }
          return state.sourceDraft(id, input)
        })
      }
      catch (error) {
        recordComposerFailure('source-checkpoint', error)
        throw error
      }
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
      contexts.get(editorWebContentsId() ?? -1)?.emit(composerSourceActionChanged, input)
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
      contexts.get(editorWebContentsId() ?? -1)?.emit(composerSourceTextChanged, { ...input, version: value.version })
    })
    defineInvokeHandler(context, composerSourceReveal, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      if (!value || value.status !== 'detached' || value.scope.leaseId !== input.leaseId || value.scope.sourceGeneration !== input.sourceGeneration)
        throw new Error('The detached composer visibility request is no longer current.')
      if (input.restore) {
        editor?.setAlwaysOnTop(true, 'screen-saver', DETACHED_COMPOSER_TOP_LEVEL)
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
      requireDragGesture(input.gestureId)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      if (input.origin)
        finishedEditorDrag = { leaseId: input.leaseId, version: input.version, gestureId: input.gestureId, origin: input.origin, at: Date.now() }
      const drag = editorDrag
      editorDrag = undefined
      const source = returnTarget(value)
      try {
        return !!source && (drag?.returnTargetActive ?? composerContainsPoint(source.getContentBounds(), verifiedCursor(input.point)))
      }
      finally {
        publishSourceReturnTargetState(value, false)
      }
    })
    defineInvokeHandler(context, composerDragCancel, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      requireDragGesture(input.gestureId)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version
        || value.scope.sourceGeneration !== input.sourceGeneration || value.status !== 'detached' || value.busy) {
        throw new Error('The composer ownership changed during the drag.')
      }
      if (editorDrag?.gestureId === input.gestureId)
        editorDrag = undefined
      if (finishedEditorDrag?.gestureId === input.gestureId)
        finishedEditorDrag = undefined
      publishSourceReturnTargetState(value, false)
    })
    defineInvokeHandler(context, composerSourceCloseAck, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      if (bindings.get(id)?.sourceGeneration !== input.sourceGeneration)
        throw new Error('The close acknowledgement belongs to an older source.')
      const closeAttempt = sourceCloseAttempts.get(id)
      if (!closeAttempt || closeAttempt.sourceGeneration !== input.sourceGeneration || closeAttempt.closeAttemptId !== input.closeAttemptId)
        return
      await queue
      if (sourceCloseAttempts.get(id) !== closeAttempt)
        return
      sourceCloseAttempts.delete(id)
      sourceCloseAllowed.add(id)
      window.close()
    })
    defineInvokeHandler(context, composerEditorCloseAck, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const pending = pendingEditorClose
      if (!pending || pending.editorWebContentsId !== id || pending.leaseId !== input.leaseId || pending.version !== input.version || pending.action !== input.action) {
        throw new Error('The editor close acknowledgement is no longer current.')
      }
      if (!editor || editor.isDestroyed() || editor.webContents.id !== pending.editorWebContentsId)
        throw new Error('The editor close acknowledgement has no active editor.')
      pending.editorAcknowledged = true
      diagnostics?.record('composer-editor-close-acknowledged', { action: input.action, webContentsId: id })
      closeAcknowledgedEditor()
    })
    defineInvokeHandler(context, composerSourceReturnAck, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireSource(id)
      const value = snapshot()
      const pending = pendingEditorClose
      if (!value || !pending || pending.action !== 'release' || value.status !== 'returned'
        || input.leaseId !== value.scope.leaseId || input.version !== value.version || input.sourceGeneration !== value.scope.sourceGeneration
        || pending.sourceWebContentsId !== id || pending.sourceGeneration !== input.sourceGeneration) {
        throw new Error('The source return acknowledgement is no longer current.')
      }
      pending.sourceAcknowledged = true
      diagnostics?.record('composer-return-source-acknowledged', { sourceWebContentsId: id })
      closeAcknowledgedEditor()
    })
    defineInvokeHandler(context, composerRead, async (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      await initialized()
      await queue
      const value = snapshot()
      return value && (value.scope.sourceWebContentsId === id || editorWebContentsId() === id) ? value : undefined
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
      const binding = bindings.get(id)
      if (!binding || binding.userScope !== input.userScope || binding.sessionId !== input.sessionId || binding.surface !== input.surface)
        throw new Error('The chat window does not own this recovery scope.')
      const recovery = await commit(() => state.viewRecovery(input.userScope, input.sessionId, input.surface, id, binding.sourceGeneration))
      try {
        await openEditor()
        publish()
      }
      catch (error) {
        await commit(() => state.release({ leaseId: recovery.scope.leaseId, version: recovery.version }))
        publish()
        throw error
      }
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
    defineInvokeHandler(context, composerRequestReturn, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      try {
        requireSource(id)
        let currentEditor = editor && !editor.isDestroyed() ? editor : undefined
        if (!currentEditor && opening) {
          try {
            currentEditor = await opening
          }
          catch {
            // A failed editor creation is handled by the persisted release
            // fallback below, which restores the source input safely.
          }
        }
        const value = snapshot()
        if (!value || input.leaseId !== value.scope.leaseId || input.version !== value.version)
          throw new Error('The composer ownership changed.')
        if (!currentEditor || currentEditor.isDestroyed()) {
          // The detached renderer is already gone. Release the persisted lease
          // directly so the source becomes editable instead of waiting forever
          // for a flush event that has no recipient.
          await commit(() => state.release(input))
          publish()
          return
        }
        contexts.get(currentEditor.webContents.id)?.emit(composerFlushAndClose, value)
      }
      catch (error) {
        recordComposerFailure('return-request', error)
        throw error
      }
    })
    defineInvokeHandler(context, composerRelease, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const current = snapshot()
      const source = current && sourceWindow(current)
      if (!source)
        throw new Error('The original chat window is no longer available.')
      sourceCloseAttempts.delete(current.scope.sourceWebContentsId)
      diagnostics?.record('composer-return-release-started', {
        editorWebContentsId: id,
        sourceWebContentsId: current.scope.sourceWebContentsId,
      })
      releaseInFlightSourceWebContentsId = current.scope.sourceWebContentsId
      releaseInFlightCount += 1
      try {
        const value = await commit(() => state.release(input))
        editorDrag = undefined
        finishedEditorDrag = undefined
        sourceActions.clear()
        const currentEditor = editor
        if (currentEditor && !currentEditor.isDestroyed()) {
          // Returning must not briefly leave two transparent, always-on-top
          // windows competing for activation. Keep the old editor alive only
          // for the Eventa handoff, then focus the source from its `closed`
          // event after the native editor surface is gone.
          currentEditor.setAlwaysOnTop(false)
          returnFocus = {
            leaseId: value.scope.leaseId,
            sourceWebContentsId: value.scope.sourceWebContentsId,
            version: value.version,
          }
          const sourceCanReceive = bindings.get(value.scope.sourceWebContentsId)?.sourceGeneration === value.scope.sourceGeneration
          // Keep the editor alive until its renderer receives this durable
          // release result and acknowledges that it is ready to close. If the
          // source component has already unmounted, its persisted recovery is
          // applied when that component next binds to this conversation.
          pendingEditorClose = {
            editorWebContentsId: currentEditor.webContents.id,
            leaseId: value.scope.leaseId,
            version: value.version,
            action: 'release',
            sourceWebContentsId: value.scope.sourceWebContentsId,
            sourceGeneration: value.scope.sourceGeneration,
            sourceAcknowledged: !sourceCanReceive,
          }
          const pending = pendingEditorClose
          clearTimeout(sourceReturnAckTimer)
          sourceReturnAckTimer = undefined
          if (sourceCanReceive) {
            sourceReturnAckTimer = setTimeout(() => {
              if (pendingEditorClose !== pending)
                return
              // The release is already persisted. A source that was unmounted
              // before it could acknowledge will rehydrate from that draft.
              pending.sourceAcknowledged = true
              closeAcknowledgedEditor()
            }, SOURCE_RETURN_ACK_TIMEOUT_MS)
          }
        }
        publishSourceReturnTargetState(value, false)
        publish()
        return value
      }
      finally {
        releaseInFlightCount -= 1
        if (!releaseInFlightCount)
          releaseInFlightSourceWebContentsId = undefined
      }
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
      const currentEditor = editor
      if (currentEditor && !currentEditor.isDestroyed())
        pendingEditorClose = { editorWebContentsId: currentEditor.webContents.id, leaseId: value.scope.leaseId, version: value.version, action: 'discard' }
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
