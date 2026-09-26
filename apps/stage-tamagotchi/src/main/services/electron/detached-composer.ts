import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow as ElectronWindow } from 'electron'

import { createComposerState } from '../../../shared/detached-composer'
import { composerChanged, composerDetach, composerEdit, composerExecute, composerFlushAndClose, composerInvalidate, composerRead, composerRecovery, composerRelease, composerRequestReturn, composerSettle, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { createDetachedComposerWindow } from '../../windows/composer'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../windows/shared/window'

/** Register before creating renderer windows; every sender is verified in main. */
export function createDetachedComposerService() {
  const state = createComposerState()
  const contexts = new Map<number, ReturnType<typeof createWindowEventaContext>['context']>()
  let editor: BrowserWindow | undefined
  let opening: Promise<BrowserWindow> | undefined
  let allowClose = false
  let quitting = false
  const snapshot = () => state.read()
  const publish = () => {
    const value = snapshot()
    if (!value)
      return
    contexts.get(value.scope.sourceWebContentsId)?.emit(composerChanged, value)
    if (editor && !editor.isDestroyed())
      contexts.get(editor.webContents.id)?.emit(composerChanged, value)
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
          state.invalidate(value.scope.sourceWebContentsId)
          state.release({ leaseId: value.scope.leaseId, version: value.version })
          publish()
        }
        allowClose = true
        window.destroy()
      })
      window.once('closed', () => {
        if (editor === window)
          editor = undefined
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
        state.invalidate(id)
        publish()
      }
    }
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame)
        invalidate()
    })
    window.webContents.once('destroyed', () => {
      invalidate()
      contexts.delete(id)
      dispose()
    })
    defineInvokeHandler(context, composerDetach, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      const value = state.detach(id, input)
      try {
        await openEditor()
        publish()
        return snapshot()!
      }
      catch (error) {
        state.invalidate(id)
        state.release({ leaseId: value.scope.leaseId, version: value.version })
        publish()
        throw error
      }
    })
    defineInvokeHandler(context, composerRead, (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      const value = snapshot()
      return value && (value.scope.sourceWebContentsId === id || editor?.webContents.id === id) ? value : undefined
    })
    defineInvokeHandler(context, composerRecovery, (input, options) => {
      if (isIpcEventFromWindow(window, options)) {
        requireConversation(window)
        const value = state.recovery(input.userScope, input.sessionId, input.surface)
        return { exists: !!value, uncertain: !!value?.uncertain }
      }
    })
    defineInvokeHandler(context, composerViewRecovery, async (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireConversation(window)
      state.viewRecovery(input.userScope, input.sessionId, input.surface)
      await openEditor()
      publish()
    })
    defineInvokeHandler(context, composerEdit, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = state.edit(input)
      publish()
      return value
    })
    defineInvokeHandler(context, composerSubmit, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const result = state.submit(input)
      publish()
      if (result.execute)
        contexts.get(result.snapshot.scope.sourceWebContentsId)?.emit(composerExecute, result.snapshot)
      return result.snapshot
    })
    defineInvokeHandler(context, composerSettle, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      const value = state.settle(id, input)
      publish()
      return value
    })
    defineInvokeHandler(context, composerInvalidate, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      state.invalidate(id, input.sourceGeneration)
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
    defineInvokeHandler(context, composerRelease, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      requireEditor(id)
      const value = state.release(input)
      publish()
      allowClose = true
      editor?.close()
      return value
    })
  }
  const onCreated = (_event: unknown, window: BrowserWindow) => register(window)
  app.on('browser-window-created', onCreated)
  app.on('before-quit', () => quitting = true)
  ElectronWindow.getAllWindows().forEach(register)
  return { read: snapshot, dispose: () => app.removeListener('browser-window-created', onCreated) }
}
