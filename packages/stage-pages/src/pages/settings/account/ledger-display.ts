import type { CommerceLedgerEntry } from '@proj-airi/stage-ui/stores/commerce'

export interface DisplayLedgerEntry extends CommerceLedgerEntry {
  displayAmount: number
  displayType: string
  refundedPoints: number
  reservationPoints: number
}

const legacyLedgerNoteKeys: Record<string, string> = {
  'Daily check-in': 'daily-check-in',
  'Daily check-in membership upgrade': 'daily-check-in-membership-upgrade',
}

function normalizeLedgerNote(note: string | null) {
  return note ? (legacyLedgerNoteKeys[note] ?? note) : null
}

/** Collapse internal model-usage reservations into one user-facing outcome. */
export function buildDisplayLedger(entries: CommerceLedgerEntry[]): DisplayLedgerEntry[] {
  const groupedUsage = new Map<string, CommerceLedgerEntry[]>()
  const order: Array<{ entry?: CommerceLedgerEntry, sourceId?: string }> = []

  for (const entry of entries) {
    if (entry.source === 'model_usage' && entry.sourceId) {
      if (!groupedUsage.has(entry.sourceId)) {
        groupedUsage.set(entry.sourceId, [])
        order.push({ sourceId: entry.sourceId })
      }
      groupedUsage.get(entry.sourceId)!.push(entry)
    }
    else {
      order.push({ entry })
    }
  }

  return order.flatMap(({ entry, sourceId }) => {
    if (entry) {
      return [{
        ...entry,
        note: normalizeLedgerNote(entry.note),
        displayAmount: entry.amount,
        displayType: entry.type,
        refundedPoints: entry.type === 'refund' ? Math.abs(entry.amount) : 0,
        reservationPoints: 0,
      }]
    }

    const usageEntries = [...(groupedUsage.get(sourceId!) ?? [])].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )
    const refunds = usageEntries.filter(item => item.type === 'refund')
    const settlements = usageEntries.filter(item => item.type === 'settle')
    const reservationPoints = usageEntries
      .filter(item => item.type === 'reserve')
      .reduce((sum, item) => sum + Math.abs(item.amount), 0)
    const displayFailureRefund = refunds.find(item => item.note === 'reply-display-failure-refund')
    const chosen = displayFailureRefund ?? settlements[0] ?? usageEntries.find(item => item.type === 'reserve')
    if (!chosen)
      return []

    if (displayFailureRefund) {
      return [{
        ...displayFailureRefund,
        note: normalizeLedgerNote(displayFailureRefund.note),
        displayAmount: 0,
        displayType: 'refund',
        refundedPoints: refunds.reduce((sum, item) => sum + Math.abs(item.amount), 0),
        reservationPoints,
      }]
    }
    if (settlements.length > 0) {
      return [{
        ...chosen,
        note: normalizeLedgerNote(chosen.note),
        displayAmount: -settlements.reduce((sum, item) => sum + Math.abs(item.amount), 0),
        displayType: 'settle',
        refundedPoints: 0,
        reservationPoints,
      }]
    }
    // A reservation that was released without any settled charge has no net
    // balance effect, so it is omitted from the user-facing consumption list.
    if (refunds.length > 0)
      return []
    return []
  })
}
