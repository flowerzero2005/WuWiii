export const QUICK_CHAT_PRESENT_CHANNEL_NAME = 'airi-quick-chat-present'
export const QUICK_CHAT_PRESENT_LOCAL_EVENT = 'airi:quick-chat-present'
export const QUICK_CHAT_PRESENT_STORAGE_KEY = 'airi-quick-chat-present-event'
export const QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY = 'airi-quick-chat-present-events'
export const QUICK_CHAT_STAGE_ANCHOR_CHANNEL_NAME = 'airi-quick-chat-stage-anchor'
export const QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY = 'airi-quick-chat-stage-anchor-event'
export const QUICK_CHAT_LIVE2D_PERFORMANCE_CHANNEL_NAME = 'airi-quick-chat-live2d-performance'
export const QUICK_CHAT_PRESENT_EVENT_BOOTSTRAP_TTL_MS = 8000
export const HEARING_STREAM_OWNER_STORAGE_KEY = 'airi-hearing-stream-owner'
export const HEARING_STREAM_OWNER_CHANGE_EVENT = 'airi:hearing-stream-owner-change'
export const HEARING_STREAM_OWNER_CHANNEL_NAME = 'airi-hearing-stream-owner'
export const HEARING_STREAM_OWNER_LEASE_TTL_MS = 8000

let quickChatPresentChannel: BroadcastChannel | undefined

export function postQuickChatPresentEvent(event: QuickChatPresentEvent) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(QUICK_CHAT_PRESENT_LOCAL_EVENT, { detail: event }))
  if (typeof BroadcastChannel === 'undefined')
    return
  quickChatPresentChannel ??= new BroadcastChannel(QUICK_CHAT_PRESENT_CHANNEL_NAME)
  quickChatPresentChannel.postMessage(event)
}

export type HearingStreamOwner = 'voice-call' | undefined
export interface HearingStreamOwnerChangeEvent {
  type: 'hearing-stream-owner-change'
  owner: HearingStreamOwner
}
interface HearingStreamOwnerLease {
  owner: Exclude<HearingStreamOwner, undefined>
  ownerId: string
  expiresAt: number
}
export type QuickChatPresentationMode = 'collapsed-quick-chat' | 'voice-call'

let hearingStreamOwnerChannel: BroadcastChannel | undefined
let hearingStreamOwnerLeaseTimer: ReturnType<typeof setInterval> | undefined
const hearingStreamOwnerId = globalThis.crypto?.randomUUID?.()
  ?? `hearing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function getHearingStreamOwnerChannel() {
  if (!hearingStreamOwnerChannel && typeof BroadcastChannel !== 'undefined')
    hearingStreamOwnerChannel = new BroadcastChannel(HEARING_STREAM_OWNER_CHANNEL_NAME)

  return hearingStreamOwnerChannel
}

export function shouldAcceptQuickChatPresentationMode(
  currentMode: QuickChatPresentationMode | undefined,
  incomingMode: QuickChatPresentationMode,
  eventType: QuickChatPresentEvent['type'],
) {
  if (eventType === 'quick-chat-turn-start')
    return !currentMode || currentMode === incomingMode || incomingMode === 'voice-call'

  return currentMode === incomingMode
}

function parseHearingStreamOwnerLease(rawValue: string | null, now = Date.now()): HearingStreamOwnerLease | undefined {
  if (!rawValue)
    return

  try {
    const value = JSON.parse(rawValue) as Partial<HearingStreamOwnerLease>
    if (value.owner !== 'voice-call' || typeof value.ownerId !== 'string' || !value.ownerId || typeof value.expiresAt !== 'number' || value.expiresAt <= now)
      return
    return value as HearingStreamOwnerLease
  }
  catch {
    // The old persisted string had no lifetime and must never survive a restart.

  }
}

function readHearingStreamOwnerLease(now = Date.now()) {
  if (typeof window === 'undefined')
    return

  const rawValue = window.localStorage.getItem(HEARING_STREAM_OWNER_STORAGE_KEY)
  const lease = parseHearingStreamOwnerLease(rawValue, now)
  if (!lease && rawValue)
    window.localStorage.removeItem(HEARING_STREAM_OWNER_STORAGE_KEY)
  return lease
}

export function readHearingStreamOwner(): HearingStreamOwner {
  return readHearingStreamOwnerLease()?.owner
}

export function isCurrentWindowHearingStreamOwner() {
  return readHearingStreamOwnerLease()?.ownerId === hearingStreamOwnerId
}

export function setHearingStreamOwner(owner: HearingStreamOwner) {
  if (typeof window === 'undefined')
    return false

  if (owner) {
    const existingLease = readHearingStreamOwnerLease()
    if (existingLease && existingLease.ownerId !== hearingStreamOwnerId)
      return false

    const renewLease = () => {
      window.localStorage.setItem(HEARING_STREAM_OWNER_STORAGE_KEY, JSON.stringify({
        owner,
        ownerId: hearingStreamOwnerId,
        expiresAt: Date.now() + HEARING_STREAM_OWNER_LEASE_TTL_MS,
      } satisfies HearingStreamOwnerLease))
    }
    renewLease()
    if (!hearingStreamOwnerLeaseTimer)
      hearingStreamOwnerLeaseTimer = setInterval(renewLease, HEARING_STREAM_OWNER_LEASE_TTL_MS / 2)
  }
  else {
    if (hearingStreamOwnerLeaseTimer) {
      clearInterval(hearingStreamOwnerLeaseTimer)
      hearingStreamOwnerLeaseTimer = undefined
    }
    if (isCurrentWindowHearingStreamOwner())
      window.localStorage.removeItem(HEARING_STREAM_OWNER_STORAGE_KEY)
  }

  const event = { type: 'hearing-stream-owner-change', owner } satisfies HearingStreamOwnerChangeEvent
  getHearingStreamOwnerChannel()?.postMessage(event)
  window.dispatchEvent(new CustomEvent<HearingStreamOwnerChangeEvent>(HEARING_STREAM_OWNER_CHANGE_EVENT, { detail: event }))
  return true
}

export function subscribeHearingStreamOwnerChange(listener: (owner: HearingStreamOwner) => void) {
  if (typeof window === 'undefined')
    return () => {}

  let lastOwner = readHearingStreamOwner()
  const notify = (owner: HearingStreamOwner) => {
    if (owner === lastOwner)
      return

    lastOwner = owner
    listener(owner)
  }
  const handleBroadcast = (event: MessageEvent<HearingStreamOwnerChangeEvent>) => {
    if (event.data?.type === 'hearing-stream-owner-change')
      notify(event.data.owner)
  }
  const handleLocal = (event: Event) => {
    const detail = (event as CustomEvent<HearingStreamOwnerChangeEvent>).detail
    notify(detail?.type === 'hearing-stream-owner-change' ? detail.owner : readHearingStreamOwner())
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === HEARING_STREAM_OWNER_STORAGE_KEY)
      notify(parseHearingStreamOwnerLease(event.newValue)?.owner)
  }
  const channel = getHearingStreamOwnerChannel()

  channel?.addEventListener('message', handleBroadcast)
  window.addEventListener(HEARING_STREAM_OWNER_CHANGE_EVENT, handleLocal)
  window.addEventListener('storage', handleStorage)

  return () => {
    channel?.removeEventListener('message', handleBroadcast)
    window.removeEventListener(HEARING_STREAM_OWNER_CHANGE_EVENT, handleLocal)
    window.removeEventListener('storage', handleStorage)
  }
}

export interface QuickChatSourceBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface QuickChatAssistantMessageTarget {
  assistantMessageId: string
  assistantTurnId: string
  segmentIndex: number
  siblingAssistantMessageIds: string[]
}

export interface QuickChatStageAnchorEvent {
  type: 'quick-chat-stage-anchor'
  bounds: QuickChatSourceBounds
  live2d: {
    position: {
      x: number
      y: number
    }
    scale: number
  }
}

export interface QuickChatStageAnchorStorageEnvelope {
  createdAt: number
  event: QuickChatStageAnchorEvent
}

export type QuickChatPresentEvent
  = | { type: 'quick-chat-dismiss-all', mode?: QuickChatPresentationMode }
    | { type: 'quick-chat-turn-start', turnId: string, mode?: QuickChatPresentationMode, sourceBounds?: QuickChatSourceBounds }
    | { type: 'quick-chat-user-message', turnId: string, segmentId: string, text: string, mode?: QuickChatPresentationMode, sourceBounds?: QuickChatSourceBounds, userBubbleVisible?: boolean }
    | ({ type: 'quick-chat-turn-segment', turnId: string, segmentId: string, text: string, typingSpeedMs?: number, mode?: QuickChatPresentationMode } & QuickChatAssistantMessageTarget)
    | { type: 'quick-chat-turn-waiting', turnId: string, waiting: boolean, mode?: QuickChatPresentationMode }
    | { type: 'quick-chat-turn-complete', turnId: string, mode?: QuickChatPresentationMode }
    | { type: 'quick-chat-turn-error', turnId: string, text: string, mode?: QuickChatPresentationMode }
    | { type: 'quick-chat-turn-dismiss', turnId: string, mode?: QuickChatPresentationMode }

export interface QuickChatPresentStorageEnvelope {
  id: string
  createdAt: number
  event: QuickChatPresentEvent
}

export function selectQuickChatPresentBootstrapEvents(
  envelopes: Partial<QuickChatPresentStorageEnvelope>[],
  now = Date.now(),
) {
  return envelopes
    .filter(envelope => envelope?.event && envelope.createdAt && now - envelope.createdAt <= QUICK_CHAT_PRESENT_EVENT_BOOTSTRAP_TTL_MS)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(envelope => envelope.event!)
}

export function selectQuickChatStageAnchorBootstrapEvent(envelope?: Partial<QuickChatStageAnchorStorageEnvelope> | null) {
  return envelope?.event?.type === 'quick-chat-stage-anchor' ? envelope.event : undefined
}

export function splitQuickChatBubbleSegments(segments: string[], maxCharacters = 96) {
  const limit = Math.max(1, Math.floor(maxCharacters))
  return segments.flatMap((segment) => {
    const characters = Array.from(segment.trim())
    const chunks: string[] = []
    for (let index = 0; index < characters.length; index += limit)
      chunks.push(characters.slice(index, index + limit).join(''))
    return chunks
  }).filter(Boolean)
}

export type QuickChatLive2DPerformanceEvent
  = | { type: 'quick-chat-live2d-text-speech-start', turnId: string }
    | { type: 'quick-chat-live2d-text-speech-mouth', turnId: string, mouthOpenSize: number, mouthForm?: number }
    | { type: 'quick-chat-live2d-text-speech-end', turnId: string }
