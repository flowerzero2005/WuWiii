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

  it('shows a failed QQ send as one fully refunded charge', () => {
    const result = buildDisplayLedger([
      entry({ amount: 5, bucket: 'trial', note: 'qq-send-failed', sourceSurface: 'qq', type: 'refund' }),
      entry({ amount: 7, bucket: 'paid', note: 'qq-send-failed', sourceSurface: 'qq', type: 'refund' }),
      entry({ amount: -5, bucket: 'trial', sourceSurface: 'qq', type: 'settle' }),
      entry({ amount: -7, bucket: 'paid', sourceSurface: 'qq', type: 'settle' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ displayAmount: 0, displayType: 'refund', note: 'qq-send-failed', refundedPoints: 12, sourceSurface: 'qq' })
  })

  it('shows a failed QQ search as a refund while keeping its follow-up reply charge separate', () => {
    const result = buildDisplayLedger([
      entry({ amount: 10, note: 'qq-search-failed', sourceId: 'search-initial', sourceSurface: 'qq', type: 'refund' }),
      entry({ amount: -10, sourceId: 'search-initial', sourceSurface: 'qq', type: 'settle' }),
      entry({ amount: -10, sourceId: 'search-follow-up', sourceSurface: 'qq', type: 'settle' }),
    ])
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayAmount: 0, note: 'qq-search-failed', refundedPoints: 10 }),
      expect.objectContaining({ displayAmount: -10, sourceId: 'search-follow-up' }),
    ]))
  })

  it('shows a model-chosen QQ skip as one fully refunded charge', () => {
    const result = buildDisplayLedger([
      entry({ amount: 5, bucket: 'trial', note: 'qq-no-reply', sourceSurface: 'qq', type: 'refund' }),
      entry({ amount: 7, bucket: 'paid', note: 'qq-no-reply', sourceSurface: 'qq', type: 'refund' }),
      entry({ amount: -5, bucket: 'trial', sourceSurface: 'qq', type: 'settle' }),
      entry({ amount: -7, bucket: 'paid', sourceSurface: 'qq', type: 'settle' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ displayAmount: 0, displayType: 'refund', note: 'qq-no-reply', refundedPoints: 12, sourceSurface: 'qq' })
  })

  it('shows an unusable QQ sticker recognition as refunded rather than charged', () => {
    const result = buildDisplayLedger([
      entry({ amount: 5, note: 'qq-analysis-unusable', sourceSurface: 'qq', type: 'refund', usagePurpose: 'sticker-vision' }),
      entry({ amount: -5, sourceSurface: 'qq', type: 'settle', usagePurpose: 'sticker-vision' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ displayAmount: 0, displayType: 'refund', note: 'qq-analysis-unusable', refundedPoints: 5, usagePurpose: 'sticker-vision' })
  })

  it('shows unusable QQ image understanding as a separate zero-cost recognition', () => {
    const result = buildDisplayLedger([
      entry({ amount: 5, note: 'qq-image-unusable', sourceSurface: 'qq', sourceId: 'image-vision', type: 'refund', usagePurpose: 'vision' }),
      entry({ amount: -5, sourceSurface: 'qq', sourceId: 'image-vision', type: 'settle', usagePurpose: 'vision' }),
      entry({ amount: -8, sourceSurface: 'qq', sourceId: 'main-reply', type: 'settle', usagePurpose: 'main-reply' }),
    ])
    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayAmount: 0, note: 'qq-image-unusable', refundedPoints: 5 }),
      expect.objectContaining({ displayAmount: -8, usagePurpose: 'main-reply' }),
    ]))
  })

  it('normalizes legacy daily check-in notes for localization', () => {
    const result = buildDisplayLedger([
      entry({ note: 'Daily check-in', source: 'trial', sourceId: 'check-in-1', type: 'grant' }),
    ])

    expect(result[0]).toMatchObject({ note: 'daily-check-in', refundedPoints: 0, reservationPoints: 0 })
  })
})
