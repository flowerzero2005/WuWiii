import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, Session } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronRealtimeTtsAuthorize } from '../../../shared/eventa'

interface PendingAuthorization {
  apiKey: string
  workspaceId?: string
  expires: ReturnType<typeof setTimeout>
}

const pendingAuthorizations = new Map<string, PendingAuthorization>()
const hookedSessions = new WeakSet<Session>()

function normalizeEndpoint(value: string) {
  const endpoint = new URL(value.trim())
  if (endpoint.protocol !== 'wss:' || !endpoint.hostname.toLowerCase().endsWith('.aliyuncs.com'))
    throw new Error('Alibaba realtime TTS endpoint must be a secure aliyuncs.com WebSocket URL.')

  endpoint.hash = ''
  return endpoint.toString()
}

function setupAuthorizationHook(session: Session) {
  if (hookedSessions.has(session))
    return
  hookedSessions.add(session)

  session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:3000/*', 'wss://*.aliyuncs.com/*'] }, (details, callback) => {
    const requestUrl = new URL(details.url)
    if (requestUrl.origin === 'http://127.0.0.1:3000') {
      const requestOrigin = details.requestHeaders.Origin ?? details.requestHeaders.origin
      if (requestOrigin && requestOrigin !== 'null') {
        callback({ requestHeaders: details.requestHeaders })
        return
      }

      // NOTICE: Packaged renderers use file:// and Chromium otherwise sends Origin: null.
      // Better Auth correctly rejects cookie-bearing POST requests with a null origin.
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          Origin: 'http://127.0.0.1:5173',
        },
      })
      return
    }

    const endpoint = normalizeEndpoint(details.url)
    const authorization = pendingAuthorizations.get(endpoint)
    if (!authorization) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    pendingAuthorizations.delete(endpoint)
    clearTimeout(authorization.expires)
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'Authorization': `Bearer ${authorization.apiKey}`,
        'User-Agent': 'Wuwiii-Desktop/0.9',
        ...(authorization.workspaceId ? { 'X-DashScope-WorkSpace': authorization.workspaceId } : {}),
      },
    })
  })
}

export function createRealtimeTtsService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  setupAuthorizationHook(params.window.webContents.session)

  defineInvokeHandler(params.context, electronRealtimeTtsAuthorize, (payload) => {
    const apiKey = payload.apiKey.trim()
    if (!apiKey)
      throw new Error('Alibaba Model Studio API key is required for realtime TTS.')

    const endpoint = normalizeEndpoint(payload.endpoint)
    const existing = pendingAuthorizations.get(endpoint)
    if (existing)
      clearTimeout(existing.expires)
    const expires = setTimeout(() => pendingAuthorizations.delete(endpoint), 10_000)
    pendingAuthorizations.set(endpoint, {
      apiKey,
      workspaceId: payload.workspaceId?.trim() || undefined,
      expires,
    })
    return { endpoint }
  })
}
