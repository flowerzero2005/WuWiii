export type CommerceRequestPurpose
  = | 'main-reply'
    | 'tool-routing'
    | 'tool-processing'
    | 'response-enhancement'
    | 'inner-voice-note'
    | 'memory'
    | 'recommended-replies'
    | 'group-narration'
    | 'group-narration-speech'
    | 'speech'
    | 'web-search'
    | 'unknown'

export type CommerceRequestSurface
  = | 'voice-call'
    | 'group-chat'
    | 'quick-chat'
    | 'chat'
    | 'proactive'
    | 'unknown'

export type UsageRequestStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled'

export type UsageBillingStatus
  = | 'processing'
    | 'not_charged'
    | 'charged'
    | 'refunded'
    | 'review_pending'

export type UsageFailureCategory
  = | 'not-needed'
    | 'no-content'
    | 'incomplete-response'
    | 'provider-unavailable'
    | 'request-too-large'
    | 'billing-finalization'
    | 'display-failure'
    | 'cancelled'
    | 'unknown'

export interface PublicUsageHistoryCursor {
  createdAt: string
  id: string
}

/** Safe, user-facing billing projection for one independently billed request. */
export interface PublicUsageHistoryEntry {
  billingStatus: UsageBillingStatus
  chargedPoints: number
  completedAt: string | null
  createdAt: string
  failureCategory?: UsageFailureCategory
  groupTurnId?: string
  /** Snapshot labels captured when the request was created; never inferred later. */
  characterName?: string
  id: string
  netPoints: number
  purpose: CommerceRequestPurpose
  refundedPoints: number
  requestStatus: UsageRequestStatus
  reservedPoints: number
  surface: CommerceRequestSurface
  roomName?: string
  turnId?: string
}

export interface PublicUsageHistoryPage {
  entries: PublicUsageHistoryEntry[]
  nextCursor: PublicUsageHistoryCursor | null
  serverNow: string
}
