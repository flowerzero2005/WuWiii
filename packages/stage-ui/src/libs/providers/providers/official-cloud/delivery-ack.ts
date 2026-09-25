import { SERVER_URL } from '../../../auth'

export const OFFICIAL_CLOUD_DELIVERY_ACK_HEADER = 'x-airi-delivery-ack'
export const OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER = 'x-airi-delivery-token'
export const OFFICIAL_CLOUD_DELIVERY_ACK_VERSION = 'v1'

const DELIVERY_ACK_RETRY_DELAYS_MS = [0, 1_000, 3_000, 8_000, 16_000] as const
const CHAT_DELIVERY_ACK_RETRY_DELAYS_MS = [0, 1_000, 3_000, 8_000, 16_000, 30_000, 60_000, 120_000, 120_000, 120_000] as const
const MAX_CHAT_DELIVERY_ALIASES = 500
const deliveryTokensByValue = new WeakMap<object, string>()
const chatDeliveryTokensByRequestId = new Map<string, Set<string>>()
const realtimeAsrDeliveryTokens = new Map<string, string>()
const deliveryAckRequests = new Map<string, Promise<boolean>>()

function getFetchDelegate(): typeof fetch {
  const runtime = globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
  }
  return runtime.__AIRI_ELECTRON_FETCH_PROXY__ ?? globalThis.fetch.bind(globalThis)
}

function refreshCommerceAccountState() {
  void import('../../../../stores/commerce')
    .then(({ useCommerceStore }) => useCommerceStore().fetchAccountState())
    .catch(() => undefined)
}

function readDeliveryToken(response: Response) {
  const token = response.headers.get(OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER)?.trim()
  return token || undefined
}

export function registerOfficialCloudDelivery(value: object, response: Response) {
  const token = readDeliveryToken(response)
  if (token)
    deliveryTokensByValue.set(value, token)
}

export function transferOfficialCloudDelivery(source: object, target: object) {
  const token = deliveryTokensByValue.get(source)
  if (token)
    deliveryTokensByValue.set(target, token)
}

export function registerOfficialCloudRealtimeAsrDelivery(requestId: string, deliveryToken: unknown) {
  if (typeof deliveryToken !== 'string' || !deliveryToken.trim())
    return
  realtimeAsrDeliveryTokens.set(requestId, deliveryToken.trim())
}

export function registerOfficialCloudChatDelivery(requestId: string, response: Response) {
  const normalizedRequestId = requestId.trim()
  const token = readDeliveryToken(response)
  if (!normalizedRequestId || !token)
    return
  const tokens = chatDeliveryTokensByRequestId.get(normalizedRequestId) ?? new Set<string>()
  tokens.add(token)
  chatDeliveryTokensByRequestId.set(normalizedRequestId, tokens)
  if (chatDeliveryTokensByRequestId.size > MAX_CHAT_DELIVERY_ALIASES) {
    const oldestAlias = chatDeliveryTokensByRequestId.keys().next().value
    if (oldestAlias)
      chatDeliveryTokensByRequestId.delete(oldestAlias)
  }
}

function waitForRetry(delayMs: number) {
  return new Promise<void>(resolve => setTimeout(resolve, delayMs))
}

async function sendDeliveryAck(deliveryToken: string, kind: 'audio' | 'chat') {
  const retryDelays = kind === 'chat' ? CHAT_DELIVERY_ACK_RETRY_DELAYS_MS : DELIVERY_ACK_RETRY_DELAYS_MS
  for (const delayMs of retryDelays) {
    if (delayMs > 0)
      await waitForRetry(delayMs)

    try {
      const response = await getFetchDelegate()(new URL(`/api/model-gateway/v1/${kind}/deliveries/ack`, SERVER_URL), {
        credentials: 'include',
        headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: deliveryToken },
        method: 'POST',
      })
      if (response.ok) {
        refreshCommerceAccountState()
        return true
      }

      // Chat display can become visible before the server's validated EOF
      // settlement barrier. A 425 is therefore retryable audit lag; invalid or
      // expired tokens remain terminal and never change chat billing.
      if (response.status < 500 && response.status !== 408 && response.status !== 425 && response.status !== 429)
        return false
    }
    catch {
      // Delivery acknowledgement is best-effort and never blocks playback/input.
      // Billing already reached a server-owned terminal state before this audit.
    }
  }
  return false
}

function acknowledgeDeliveryToken(deliveryToken: string, kind: 'audio' | 'chat' = 'audio') {
  const requestKey = `${kind}:${deliveryToken}`
  const existing = deliveryAckRequests.get(requestKey)
  if (existing)
    return existing

  const request = sendDeliveryAck(deliveryToken, kind)
  deliveryAckRequests.set(requestKey, request)
  void request.finally(() => {
    if (deliveryAckRequests.get(requestKey) === request)
      deliveryAckRequests.delete(requestKey)
  })
  return request
}

export function acknowledgeOfficialCloudDelivery(value: object) {
  const token = deliveryTokensByValue.get(value)
  return token ? acknowledgeDeliveryToken(token) : Promise.resolve(false)
}

export function acknowledgeOfficialCloudRealtimeAsrDelivery(requestId: string) {
  const token = realtimeAsrDeliveryTokens.get(requestId)
  if (!token)
    return Promise.resolve(false)

  return acknowledgeDeliveryToken(token).then((acknowledged) => {
    if (acknowledged && realtimeAsrDeliveryTokens.get(requestId) === token)
      realtimeAsrDeliveryTokens.delete(requestId)
    return acknowledged
  })
}

/** ACK only after the assistant message is durably stored and renderable. */
export function acknowledgeOfficialCloudChatDelivery(requestId: string) {
  const normalizedRequestId = requestId.trim()
  const tokens = chatDeliveryTokensByRequestId.get(normalizedRequestId)
  if (!tokens?.size)
    return Promise.resolve(false)
  const pendingTokens = [...tokens]

  return Promise.all(pendingTokens.map(token => acknowledgeDeliveryToken(token, 'chat')))
    .then((results) => {
      const acknowledgedTokens = pendingTokens.filter((_, index) => results[index])
      // Only forget a token after a positive server response. A network miss
      // remains retryable while the server-side delivery window is open.
      for (const [alias, aliasedTokens] of chatDeliveryTokensByRequestId) {
        for (const token of acknowledgedTokens)
          aliasedTokens.delete(token)
        if (aliasedTokens.size === 0)
          chatDeliveryTokensByRequestId.delete(alias)
      }
      return results.every(Boolean)
    })
}
