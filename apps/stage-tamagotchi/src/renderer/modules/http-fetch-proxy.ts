import type {
  ElectronRealtimeTtsAuthorizeRequest,
  ElectronRealtimeTtsAuthorizeResponse,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import {
  electronHttpFetch,
  electronRealtimeTtsAuthorize,
} from '../../shared/eventa'

declare global {
  // NOTICE: Desktop renderer requests to some OpenAI-compatible gateways are blocked
  // by browser preflight/CORS, even though the same endpoint works from native clients.
  // We proxy HTTP through Electron main process for desktop only, then rebuild a normal
  // `Response` object in renderer so shared stage-ui provider code can stay unchanged.
  interface GlobalThis {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
    __AIRI_ELECTRON_REALTIME_TTS__?: {
      authorize: (payload: ElectronRealtimeTtsAuthorizeRequest) => Promise<ElectronRealtimeTtsAuthorizeResponse>
    }
  }
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers)
    return {}

  if (headers instanceof Headers)
    return Object.fromEntries(headers.entries())

  if (Array.isArray(headers))
    return Object.fromEntries(headers)

  return Object.fromEntries(Object.entries(headers))
}

function normalizeBody(body: BodyInit | null | undefined): string | undefined {
  if (body == null)
    return undefined

  if (typeof body === 'string')
    return body

  if (body instanceof URLSearchParams)
    return body.toString()

  if (body instanceof Uint8Array)
    return new TextDecoder().decode(body)

  return String(body)
}

function base64ToUint8Array(base64: string) {
  // NOTICE: HTTP proxy responses may be audio bytes; restoring from Base64
  // keeps WAV/MP3 payloads intact instead of corrupting them through text.
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function toProxyPayload(input: URL | RequestInfo, init?: RequestInit) {
  const request = input instanceof Request
    ? input
    : undefined

  const bodyFromRequest = request ? await request.clone().text() : undefined

  return {
    url: request?.url || (input instanceof URL ? input.toString() : String(input)),
    method: init?.method || request?.method,
    headers: normalizeHeaders(init?.headers || request?.headers),
    bodyText: normalizeBody(init?.body) || bodyFromRequest,
  }
}

export function setupHttpFetchProxy() {
  if (!window.electron?.ipcRenderer)
    return

  const { context } = createContext(window.electron.ipcRenderer)
  const invokeHttpFetch = defineInvoke(context, electronHttpFetch)
  const invokeRealtimeTtsAuthorize = defineInvoke(context, electronRealtimeTtsAuthorize)
  const runtime = globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
    __AIRI_ELECTRON_REALTIME_TTS__?: {
      authorize: (payload: ElectronRealtimeTtsAuthorizeRequest) => Promise<ElectronRealtimeTtsAuthorizeResponse>
    }
  }

  runtime.__AIRI_ELECTRON_FETCH_PROXY__ = async (input: URL | RequestInfo, init?: RequestInit) => {
    const result = await invokeHttpFetch(await toProxyPayload(input, init))
    const body = typeof result.bodyBase64 === 'string'
      ? base64ToUint8Array(result.bodyBase64)
      : result.bodyText

    return new Response(body, {
      headers: result.headers,
      status: result.status,
      statusText: result.statusText,
    })
  }

  runtime.__AIRI_ELECTRON_REALTIME_TTS__ = {
    authorize: invokeRealtimeTtsAuthorize,
  }
}
