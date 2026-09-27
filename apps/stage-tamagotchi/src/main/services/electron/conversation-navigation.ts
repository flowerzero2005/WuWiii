import type { BrowserWindow } from 'electron'

import type { ConversationSelection } from '../../../shared/conversation-navigation'
import type { WindowEventaContext } from '../../windows/shared/window'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow as ElectronWindow } from 'electron'

import { conversationOpen, conversationOpenRequested, conversationOpenResult, conversationSelectionRead, conversationSelectionReport } from '../../../shared/conversation-navigation'
import { createWindowEventaContext, isIpcEventFromWindow, toggleWindowShow } from '../../windows/shared/window'

const NAVIGATION_TIMEOUT_MS = 15_000
const conversationRoutes = new Set(['/', '/chat', '/quick-chat'])

function windowRoute(window: BrowserWindow) {
  const url = window.webContents.getURL()
  return url ? new URL(url).hash.slice(1).split('?')[0] : ''
}

function validSelection(value: ConversationSelection) {
  return value && [value.userId, value.sessionId].every(item => typeof item === 'string' && item.length > 0 && item.length <= 256)
}

/** Forward explicit navigation to a real chat renderer; never edit its draft in settings. */
export function createConversationNavigationService(openChatWindow: () => Promise<BrowserWindow>) {
  const contexts = new Map<number, WindowEventaContext>()
  const selections = new Map<number, { selection: ConversationSelection, focusedAt: number }>()
  const readiness = new Map<number, Set<() => void>>()
  const pending = new Map<string, { windowId: number, finish: (accepted: boolean) => void }>()

  function current(userId: string) {
    return ElectronWindow.getAllWindows()
      .filter(window => !window.isDestroyed() && conversationRoutes.has(windowRoute(window))
        && selections.get(window.id)?.selection.userId === userId)
      .sort((a, b) => Number(b.isFocused()) - Number(a.isFocused())
        || (selections.get(b.id)?.focusedAt ?? 0) - (selections.get(a.id)?.focusedAt ?? 0))[0]
  }

  async function waitUntilReady(window: BrowserWindow) {
    if (selections.has(window.id))
      return true
    return new Promise<boolean>((resolve) => {
      const listeners = readiness.get(window.id) ?? new Set()
      const finish = () => {
        clearTimeout(timer)
        listeners.delete(finish)
        if (!listeners.size)
          readiness.delete(window.id)
        resolve(!window.isDestroyed() && selections.has(window.id))
      }
      const timer = setTimeout(finish, NAVIGATION_TIMEOUT_MS)
      listeners.add(finish)
      readiness.set(window.id, listeners)
    })
  }

  function register(window: BrowserWindow) {
    const { context } = createWindowEventaContext(window)
    contexts.set(window.id, context)
    window.on('focus', () => {
      const selected = selections.get(window.id)
      if (selected)
        selected.focusedAt = Date.now()
    })
    window.once('closed', () => {
      contexts.delete(window.id)
      selections.delete(window.id)
      for (const finish of readiness.get(window.id) ?? [])
        finish()
      for (const request of pending.values()) {
        if (request.windowId === window.id)
          request.finish(false)
      }
    })
    defineInvokeHandler(context, conversationSelectionReport, (selection, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      if (!conversationRoutes.has(windowRoute(window)) || !validSelection(selection))
        throw new Error('Invalid conversation selection.')
      selections.set(window.id, {
        selection: { userId: selection.userId, sessionId: selection.sessionId },
        focusedAt: window.isFocused() ? Date.now() : selections.get(window.id)?.focusedAt ?? 0,
      })
      for (const finish of readiness.get(window.id) ?? [])
        finish()
    })
    defineInvokeHandler(context, conversationSelectionRead, (input, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      if (!input || typeof input.userId !== 'string')
        return
      const target = current(input?.userId)
      return target ? selections.get(target.id)?.selection : undefined
    })
    defineInvokeHandler(context, conversationOpenResult, (result, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      const request = pending.get(result?.requestId)
      if (request?.windowId === window.id)
        request.finish(result.accepted === true)
    })
    defineInvokeHandler(context, conversationOpen, async (selection, options) => {
      if (!isIpcEventFromWindow(window, options))
        return
      if (!windowRoute(window).startsWith('/settings') || !validSelection(selection))
        throw new Error('Conversation navigation must start from settings.')
      const target = current(selection.userId) ?? await openChatWindow()
      if (!await waitUntilReady(target) || target.isDestroyed()
        || !conversationRoutes.has(windowRoute(target)) || selections.get(target.id)?.selection.userId !== selection.userId)
        return false
      if ([...pending.values()].some(request => request.windowId === target.id))
        return false
      const targetContext = contexts.get(target.id)
      if (!targetContext)
        return false
      toggleWindowShow(target)
      return new Promise<boolean>((resolve) => {
        const requestId = crypto.randomUUID()
        const finish = (accepted: boolean) => {
          clearTimeout(timer)
          pending.delete(requestId)
          resolve(accepted)
        }
        const timer = setTimeout(() => finish(false), NAVIGATION_TIMEOUT_MS)
        pending.set(requestId, { windowId: target.id, finish })
        targetContext.emit(conversationOpenRequested, { ...selection, requestId, expiresAt: Date.now() + NAVIGATION_TIMEOUT_MS })
      })
    })
  }
  for (const window of ElectronWindow.getAllWindows())
    register(window)
  app.on('browser-window-created', (_, window) => register(window))
}
