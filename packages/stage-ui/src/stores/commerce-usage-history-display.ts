import type { PublicUsageHistoryEntry } from './commerce'

export type UsageHistoryDisplayStatus = PublicUsageHistoryEntry['billingStatus']

export interface UsageHistoryDisplayItem {
  billingStatus: UsageHistoryDisplayStatus
  chargedPoints: number
  children: PublicUsageHistoryEntry[]
  completedAt: string | null
  createdAt: string
  characterName?: string
  groupTurnId?: string
  id: string
  isPartial: boolean
  kind: 'group' | 'single'
  netPoints: number
  processingReservedPoints: number
  refundedPoints: number
  roomName?: string
  reservedPoints: number
  surface?: PublicUsageHistoryEntry['surface']
  turnId?: string
}

/**
 * Keep the account history resilient to older/partial API rows. The public
 * contract uses numbers, but a stale server can omit an amount; letting that
 * value reach arithmetic renders `NaN` in the account page.
 */
function finitePoints(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed))
      return parsed
  }
  return 0
}

function normalizeEntry(entry: PublicUsageHistoryEntry): PublicUsageHistoryEntry {
  return {
    ...entry,
    chargedPoints: finitePoints(entry.chargedPoints),
    netPoints: finitePoints(entry.netPoints),
    refundedPoints: finitePoints(entry.refundedPoints),
    reservedPoints: finitePoints(entry.reservedPoints),
  }
}

function groupBillingStatus(entries: PublicUsageHistoryEntry[]): UsageHistoryDisplayStatus {
  if (entries.some(entry => entry.billingStatus === 'review_pending'))
    return 'review_pending'
  if (entries.some(entry => entry.billingStatus === 'processing'))
    return 'processing'

  const netPoints = entries.reduce((total, entry) => total + entry.netPoints, 0)
  if (netPoints > 0)
    return 'charged'

  const refundedPoints = entries.reduce((total, entry) => total + entry.refundedPoints, 0)
  if (refundedPoints > 0 && netPoints === 0)
    return 'refunded'

  return 'not_charged'
}

function firstNonEmptyLabel(children: PublicUsageHistoryEntry[], key: 'characterName' | 'roomName') {
  return children.find(entry => entry[key]?.trim())?.[key]?.trim()
}

function isChatTurnGroupable(entry: PublicUsageHistoryEntry) {
  return Boolean(entry.turnId)
    && !entry.groupTurnId
    && (entry.surface === 'chat' || entry.surface === 'quick-chat')
}

function summarize(kind: UsageHistoryDisplayItem['kind'], id: string, children: PublicUsageHistoryEntry[], groupTurnId?: string, turnId?: string): UsageHistoryDisplayItem {
  const createdAt = children.reduce(
    (earliest, entry) => entry.createdAt < earliest ? entry.createdAt : earliest,
    children[0]!.createdAt,
  )
  const completedTimes = children.map(entry => entry.completedAt).filter((value): value is string => value !== null)
  const completedAt = completedTimes.length === children.length
    ? completedTimes.reduce((latest, value) => value > latest ? value : latest)
    : null

  return {
    billingStatus: groupBillingStatus(children),
    chargedPoints: children.reduce((total, entry) => total + entry.chargedPoints, 0),
    characterName: firstNonEmptyLabel(children, 'characterName'),
    children,
    completedAt,
    createdAt,
    groupTurnId,
    id,
    isPartial: false,
    kind,
    netPoints: children.reduce((total, entry) => total + entry.netPoints, 0),
    processingReservedPoints: children.reduce(
      (total, entry) => total + (entry.billingStatus === 'processing' ? entry.reservedPoints : 0),
      0,
    ),
    refundedPoints: children.reduce((total, entry) => total + entry.refundedPoints, 0),
    roomName: firstNonEmptyLabel(children, 'roomName'),
    reservedPoints: children.reduce((total, entry) => total + entry.reservedPoints, 0),
    surface: groupTurnId ? 'group-chat' : children[0]?.surface,
    turnId,
  }
}

/** Build one stable account-history row per request or loaded group-chat turn. */
export function buildUsageHistoryDisplay(entries: PublicUsageHistoryEntry[], options: { hasMore?: boolean } = {}): UsageHistoryDisplayItem[] {
  const seenEntryIds = new Set<string>()
  const uniqueEntries: PublicUsageHistoryEntry[] = []

  for (const rawEntry of entries) {
    const entry = normalizeEntry(rawEntry)
    // A narrator is optional enrichment. When the model explicitly returns
    // `before: null, after: null`, the server records a refunded/no-charge
    // audit event so reconciliation remains idempotent. It is not a user
    // consumption item, though, and showing it in the normal history creates
    // the misleading impression that a failed request was charged. Keep the
    // event available to the server audit API while omitting it from the
    // account-facing list.
    if (entry.purpose === 'group-narration'
      && entry.failureCategory === 'not-needed'
      && entry.netPoints === 0
      && entry.chargedPoints === 0) {
      continue
    }
    if (!seenEntryIds.has(entry.id)) {
      seenEntryIds.add(entry.id)
      uniqueEntries.push(entry)
    }
  }

  uniqueEntries.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  )

  const groupedChildren = new Map<string, PublicUsageHistoryEntry[]>()
  const order: Array<{ entry?: PublicUsageHistoryEntry, groupingKey?: string }> = []

  for (const entry of uniqueEntries) {
    const groupingKey = entry.groupTurnId
      ? `group:${entry.groupTurnId}`
      : isChatTurnGroupable(entry)
        // The stable turn ID is the correlation contract. Surface is only a
        // display label; including it here split late speech/recommendation
        // children when an older server projected a different surface.
        ? `turn:${entry.turnId}`
        : undefined
    if (!groupingKey) {
      order.push({ entry })
      continue
    }

    const children = groupedChildren.get(groupingKey)
    if (children) {
      children.push(entry)
      continue
    }

    groupedChildren.set(groupingKey, [entry])
    order.push({ groupingKey })
  }

  const displayItems = order.map(({ entry, groupingKey }) => {
    if (entry)
      return summarize('single', entry.id, [entry])

    const children = groupedChildren.get(groupingKey!)!
    const actualGroupTurnId = children[0]?.groupTurnId
    const actualTurnId = children[0]?.turnId
    return summarize(
      'group',
      actualGroupTurnId ? `group:${actualGroupTurnId}` : `turn:${actualTurnId}`,
      children,
      actualGroupTurnId,
      actualTurnId,
    )
  }).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  )

  if (options.hasMore) {
    for (const item of displayItems) {
      if (item.kind === 'group')
        item.isPartial = true
    }
  }

  return displayItems
}
