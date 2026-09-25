import type { GroupNarrationRequest, GroupNarrationResponse } from '@proj-airi/server-shared/types'

import { SERVER_URL } from '../../libs/auth'
import {
  OFFICIAL_CLOUD_DELIVERY_ACK_HEADER,
  OFFICIAL_CLOUD_DELIVERY_ACK_VERSION,
  registerOfficialCloudChatDelivery,
} from '../../libs/providers/providers/official-cloud/delivery-ack'

/** Gives every non-empty room reply a narration opportunity when enabled. */
export function shouldRequestGroupNarration(input: {
  hasScriptScene: boolean
  priorPublicEntries: Array<{ kind: 'narration' | 'speaker', text: string }>
  speakerText: string
}) {
  return Boolean(input.speakerText.trim())
}

function getFetchDelegate(): typeof fetch {
  const runtime = globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
  }
  return runtime.__AIRI_ELECTRON_FETCH_PROXY__ ?? globalThis.fetch.bind(globalThis)
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => undefined) as { details?: unknown, issues?: unknown, message?: unknown } | undefined
  const validationDetails = payload?.issues ?? payload?.details
  return typeof payload?.message === 'string' && payload.message.trim()
    ? `${payload.message.trim()}${validationDetails ? `: ${JSON.stringify(validationDetails).slice(0, 600)}` : ''}`
    : `Group narration request failed (${response.status})`
}

/** Calls the server-owned group narrator without exposing model or pricing controls. */
export async function requestGroupNarration(
  input: GroupNarrationRequest,
  options: { abortSignal?: AbortSignal, requestId: string },
) {
  const url = new URL('/api/model-gateway/v1/group-narrations', SERVER_URL)
  const requestInit = {
    body: JSON.stringify(input),
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-airi-request-id': options.requestId,
      [OFFICIAL_CLOUD_DELIVERY_ACK_HEADER]: OFFICIAL_CLOUD_DELIVERY_ACK_VERSION,
    },
    method: 'POST',
    signal: options.abortSignal,
  } satisfies RequestInit
  let response = await getFetchDelegate()(url, requestInit)
  // Older desktop/server pairs predate the frozen room label field and reject
  // it through Valibot's strict-object schema. Retry only that narrow schema
  // mismatch so narration still works during a rolling update; current
  // servers retain roomName for ledger labels.
  if (response.status === 400 && input.roomName) {
    const detail = await response.clone().json().catch(() => undefined) as { issues?: unknown, details?: unknown }
    const serialized = JSON.stringify(detail?.issues ?? detail?.details ?? '')
    if (serialized.includes('roomName') && serialized.toLowerCase().includes('never')) {
      const { roomName: _roomName, ...legacyInput } = input
      response = await getFetchDelegate()(url, {
        ...requestInit,
        body: JSON.stringify(legacyInput),
      })
    }
  }
  if (!response.ok)
    throw new Error(await readError(response))

  const result = await response.json() as GroupNarrationResponse
  if (result.protocolVersion !== 1 || !result.requestId || !result.usageEventId || typeof result.skipped !== 'boolean')
    throw new Error('Group narration returned an invalid response')
  if (!result.skipped)
    registerOfficialCloudChatDelivery(result.requestId, response)
  return result
}
