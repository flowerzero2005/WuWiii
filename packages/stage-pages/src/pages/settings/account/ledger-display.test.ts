import type { CommerceLedgerEntry } from '@proj-airi/stage-ui/stores/commerce'

import { describe, expect, it } from 'vitest'

import { buildDisplayLedger } from './ledger-display'

function entry(overrides: Partial<CommerceLedgerEntry>): CommerceLedgerEntry {
  return {
    amount: 95,
    balanceAfter: 1000,
    bucket: 'paid',
    createdAt: '2026-08-15T03:00:00.000Z',
    id: crypto.randomUUID(),
    idempotencyKey: null,
    note: 'official-chat',
    source: 'model_usage',
    sourceId: 'usage-1',
    type: 'reserve',
    userId: 'user-1',
    ...overrides,
  }
}

describe('account ledger display', () => {
  it('shows one final charge instead of a positive reservation and settlement', () => {
    const result = buildDisplayLedger([
      entry({ amount: -60, bucket: 'grant', type: 'settle' }),
      entry({ amount: -35, bucket: 'paid', type: 'settle' }),
      entry({ amount: 95, type: 'reserve' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ displayAmount: -95, displayType: 'settle', refundedPoints: 0 })
    expect(result[0]).not.toHaveProperty('displayBucket')
  })

  it('uses the final real movement balance after for a multi-bucket settlement', () => {
    const result = buildDisplayLedger([
      entry({ amount: -35, balanceAfter: 930, createdAt: '2026-08-15T03:00:02.000Z', id: 'settle-final', type: 'settle' }),
      entry({ amount: -60, balanceAfter: 965, createdAt: '2026-08-15T03:00:01.000Z', id: 'settle-first', type: 'settle' }),
      entry({ amount: 95, balanceAfter: 1000, createdAt: '2026-08-15T03:00:00.000Z', id: 'reserve', type: 'reserve' }),
    ])

    expect(result[0]).toMatchObject({ balanceAfter: 930, displayAmount: -95, id: 'settle-final' })
  })

  it('hides a pending reservation until it becomes a real charge', () => {
    expect(buildDisplayLedger([entry({ amount: 95, type: 'reserve' })]))
      .toEqual([])
  })

  it('hides a released reservation with zero net consumption', () => {
    const result = buildDisplayLedger([
      entry({ amount: 95, type: 'refund' }),
      entry({ amount: 95, type: 'reserve' }),
    ])

    expect(result).toEqual([])
  })

  it('keeps the safe request purpose and phone surface on a settled charge', () => {
    const result = buildDisplayLedger([
      entry({ amount: -76, sourceSurface: 'voice-call', type: 'settle', usagePurpose: 'tool-routing' }),
      entry({ amount: 76, sourceSurface: 'voice-call', type: 'reserve', usagePurpose: 'tool-routing' }),
    ])

    expect(result[0]).toMatchObject({
      displayAmount: -76,
      displayType: 'settle',
      sourceSurface: 'voice-call',
      usagePurpose: 'tool-routing',
    })
  })

  it('keeps the recommended-replies purpose on its separate settled charge', () => {
    const result = buildDisplayLedger([
      entry({ amount: -8, sourceSurface: 'group-chat', type: 'settle', usagePurpose: 'recommended-replies' }),
      entry({ amount: 20, sourceSurface: 'group-chat', type: 'reserve', usagePurpose: 'recommended-replies' }),
    ])

    expect(result[0]).toMatchObject({
      displayAmount: -8,
      sourceSurface: 'group-chat',
      usagePurpose: 'recommended-replies',
    })
  })

  it('keeps a post-settlement reply display failure refund visible', () => {
    const result = buildDisplayLedger([
      entry({ amount: 75, note: 'reply-display-failure-refund', type: 'refund' }),
      entry({ amount: -75, type: 'settle' }),
      entry({ amount: 75, type: 'reserve' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      displayAmount: 0,
      displayType: 'refund',
      note: 'reply-display-failure-refund',
      refundedPoints: 75,
    })
  })

  it('normalizes legacy daily check-in notes for localization', () => {
    const result = buildDisplayLedger([
      entry({ note: 'Daily check-in', source: 'trial', sourceId: 'check-in-1', type: 'grant' }),
    ])

    expect(result[0]).toMatchObject({ note: 'daily-check-in', refundedPoints: 0, reservationPoints: 0 })
  })
})
