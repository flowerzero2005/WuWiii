import type { BrowserWindow } from 'electron'

import type { ComposerDetach } from '../../../shared/detached-composer'
import type { ComposerClientRegion, ComposerPoint } from '../../../shared/detached-composer-geometry'
import type { ComposerPersistence } from './detached-composer-persistence'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow as ElectronWindow, screen } from 'electron'

import { createComposerState, validateComposerScope } from '../../../shared/detached-composer'
import { composerChanged, composerDetach, composerDiscard, composerDraftDiscarded, composerDragDetach, composerDragReturn, composerEdit, composerExecute, composerFlushAndClose, composerFlushSource, composerInvalidate, composerRead, composerRecovery, composerRelease, composerRequestReturn, composerSettle, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceSubmit, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { composerContainsPoint, composerScreenRegion } from '../../../shared/detached-composer-geometry'
import { createDetachedComposerWindow } from '../../windows/composer'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../windows/shared/window'
import { createComposerPersistence } from './detached-composer-persistence'

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
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.hypot(point.x - cursor.x, point.y - cursor.y) > 16)
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
        if (value) {
          void commit(() => {
            state.invalidate(value.scope.sourceWebContentsId)
            return state.release({ leaseId: value.scope.leaseId, version: value.version })
          }).then(publish).catch(() => undefined)
        }
        allowClose = true
        window.destroy()
      })
      window.once('closed', () => {
        if (editor === window)
          editor = undefined
        finishQuit()
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
  function register(window: BrowserWindow) {
    const id = window.webContents.id
    if (contexts.has(id))
      return
    const { context, dispose } = createWindowEventaContext(window)
    contexts.set(id, context)
    const invalidate = () => {
      if (editor?.webContents.id !== id) {
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
      void commit(() => state.invalidate(id)).then(publish).catch(() => undefined).finally(finishQuit)
    })
    window.webContents.once('destroyed', () => {
      invalidate()
      bindings.delete(id)
      regions.delete(id)
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
    defineInvokeHandler(context, composerSourceRegion, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      if (bindings.get(id)?.sourceGeneration !== input.sourceGeneration)
        throw new Error('The composer region belongs to an older conversation.')
      composerScreenRegion(input.region, window.getContentBounds(), window.webContents.getZoomFactor())
      regions.set(id, { generation: input.sourceGeneration, region: structuredClone(input.region), at: Date.now() })
    })
    defineInvokeHandler(context, composerDragReturn, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = snapshot()
      if (!value || value.scope.leaseId !== input.leaseId || value.version !== input.version || value.status !== 'detached' || value.busy)
        throw new Error('The composer ownership changed during the drag.')
      const source = ElectronWindow.getAllWindows().find(window => window.webContents.id === value.scope.sourceWebContentsId)
      const region = regions.get(value.scope.sourceWebContentsId)
      if (!source || source.isDestroyed() || !source.isVisible() || source.isMinimized() || !region
        || region.generation !== value.scope.sourceGeneration || Date.now() - region.at > 2500) {
        return false
      }
      const target = composerScreenRegion(region.region, source.getContentBounds(), source.webContents.getZoomFactor())
      return composerContainsPoint(target, verifiedCursor(input.point))
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
      publish()
      allowClose = true
      editor?.close()
      return value
    })
    defineInvokeHandler(context, composerDiscard, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = await commit(() => state.discard(input))
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
