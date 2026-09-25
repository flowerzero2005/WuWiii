import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { Buffer } from 'node:buffer'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronHttpFetch } from '../../../shared/eventa'

export function createHttpService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  defineInvokeHandler(params.context, electronHttpFetch, async (payload, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id)
      return

    // Use the BrowserWindow session so Better Auth cookies survive the IPC proxy.
    const response = await params.window.webContents.session.fetch(payload.url, {
      body: payload.bodyText,
      credentials: 'include',
      headers: payload.headers,
      method: payload.method,
    })

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const body = await response.arrayBuffer()

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyBase64: Buffer.from(body).toString('base64'),
    }
  })
}
