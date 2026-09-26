import type { PublicUsageHistoryEntry } from './commerce'

import { describe, expect, it } from 'vitest'

import { buildUsageHistoryDisplay } from './commerce-usage-history-display'

function usage(overrides: Partial<PublicUsageHistoryEntry> = {}): PublicUsageHistoryEntry {
  return {
    billingStatus: 'charged',
    chargedPoints: 8,
    completedAt: '2026-09-04T12:00:02.000Z',
    createdAt: '2026-09-04T12:00:00.000Z',
    id: crypto.randomUUID(),
    netPoints: 8,
    purpose: 'main-reply',
    refundedPoints: 0,
    requestStatus: 'succeeded',
    reservedPoints: 10,
    surface: 'group-chat',
    ...overrides,
  }
}

describe('account usage history display', () => {
  it('groups and deduplicates children after stable createdAt and id ordering', () => {
    const latestSingle = usage({ createdAt: '2026-09-04T12:00:03.000Z', groupTurnId: undefined, id: 'single-latest', surface: 'chat' })
    const groupChildA = usage({ createdAt: '2026-09-04T12:00:02.000Z', groupTurnId: 'turn-1', id: 'group-a', purpose: 'main-reply' })
    const groupChildB = usage({ createdAt: '2026-09-04T12:00:02.000Z', groupTurnId: 'turn-1', id: 'group-b', purpose: 'speech' })
    const olderSingle = usage({ createdAt: '2026-09-04T12:00:01.000Z', groupTurnId: undefined, id: 'single-older', surface: 'voice-call' })

    const result = buildUsageHistoryDisplay([olderSingle, groupChildA, latestSingle, groupChildA, groupChildB])

    expect(result.map(item => item.id)).toEqual(['single-latest', 'group:turn-1', 'single-older'])
    expect(result[1]?.children.map(entry => entry.id)).toEqual(['group-b', 'group-a'])
  })

  it('sums every loaded child amount in a group', () => {
    const result = buildUsageHistoryDisplay([
      usage({ chargedPoints: 8, groupTurnId: 'turn-1', id: 'reply', netPoints: 8, reservedPoints: 10 }),
      usage({ chargedPoints: 3, groupTurnId: 'turn-1', id: 'speech', netPoints: 1, refundedPoints: 2, reservedPoints: 5 }),
    ])

    expect(result[0]).toMatchObject({
      chargedPoints: 11,
      netPoints: 9,
      processingReservedPoints: 0,
      refundedPoints: 2,
      reservedPoints: 15,
    })
  })

  it('normalizes missing or invalid point amounts instead of rendering NaN', () => {
    const result = buildUsageHistoryDisplay([usage({
      chargedPoints: Number.NaN,
      id: 'invalid-points',
      netPoints: undefined as unknown as number,
      refundedPoints: Number.POSITIVE_INFINITY,
      reservedPoints: undefined as unknown as number,
    })])

    expect(result[0]).toMatchObject({
      chargedPoints: 0,
      netPoints: 0,
      refundedPoints: 0,
      reservedPoints: 0,
    })
  })

  it('marks a non-boundary group partial until later pages finish its non-contiguous children', () => {
    const newestGroupChild = usage({ chargedPoints: 5, createdAt: '2026-09-04T10:00:00.000Z', groupTurnId: 'turn-a', id: 'child-a', netPoints: 5 })
    const laterSingle = usage({ createdAt: '2026-09-04T09:00:00.000Z', groupTurnId: undefined, id: 'single-between' })
    const firstPage = buildUsageHistoryDisplay([newestGroupChild, laterSingle], { hasMore: true })

    expect(firstPage.find(item => item.groupTurnId === 'turn-a')?.isPartial).toBe(true)

    const oldestGroupChild = usage({ chargedPoints: 3, createdAt: '2026-09-04T08:00:00.000Z', groupTurnId: 'turn-a', id: 'child-b', netPoints: 3 })
    const merged = buildUsageHistoryDisplay([newestGroupChild, laterSingle, newestGroupChild, oldestGroupChild], { hasMore: false })
    const group = merged.find(item => item.groupTurnId === 'turn-a')

    expect(group).toMatchObject({ isPartial: false, netPoints: 8 })
    expect(group?.children.map(entry => entry.id)).toEqual(['child-a', 'child-b'])
  })

  it('tracks processing holds separately from already charged group items', () => {
    const result = buildUsageHistoryDisplay([
      usage({ chargedPoints: 7, groupTurnId: 'turn-1', id: 'charged', netPoints: 7, reservedPoints: 9 }),
      usage({ billingStatus: 'processing', chargedPoints: 0, completedAt: null, groupTurnId: 'turn-1', id: 'pending', netPoints: 0, requestStatus: 'pending', reservedPoints: 12 }),
    ])

    expect(result[0]).toMatchObject({
      billingStatus: 'processing',
      netPoints: 7,
      processingReservedPoints: 12,
    })
  })

  it.each([
    [['charged', 'review_pending'], 8, 0, 'review_pending'],
    [['charged', 'processing'], 8, 0, 'processing'],
    [['not_charged', 'charged'], 8, 0, 'charged'],
    [['not_charged', 'refunded'], 0, 8, 'refunded'],
    [['not_charged', 'not_charged'], 0, 0, 'not_charged'],
  ] as const)('uses the frozen group status precedence for %j', (statuses, netPoints, refundedPoints, expected) => {
    const children = statuses.map((billingStatus, index) => usage({
      billingStatus,
      chargedPoints: netPoints || refundedPoints,
      groupTurnId: 'turn-1',
      id: `entry-${index}`,
      netPoints: index === 0 ? netPoints : 0,
      refundedPoints: index === 0 ? refundedPoints : 0,
      requestStatus: billingStatus === 'processing' ? 'pending' : 'succeeded',
    }))

    expect(buildUsageHistoryDisplay(children)[0]?.billingStatus).toBe(expected)
  })

  it('keeps requests without a group turn as independent records', () => {
    const first = usage({ groupTurnId: undefined, id: 'request-a', surface: 'chat' })
    const second = usage({ groupTurnId: undefined, id: 'request-b', surface: 'chat' })

    const result = buildUsageHistoryDisplay([first, second])

    expect(result).toHaveLength(2)
    expect(result.every(item => item.kind === 'single' && item.children.length === 1)).toBe(true)
  })

  it('groups direct chat text and speech requests by their turn id', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'direct-text', purpose: 'main-reply', surface: 'chat', turnId: 'turn-1', characterName: 'Mina' }),
      usage({ id: 'direct-speech', purpose: 'speech', surface: 'chat', turnId: 'turn-1', characterName: 'Mina' }),
      usage({ id: 'direct-recommended', purpose: 'recommended-replies', surface: 'chat', turnId: 'turn-1', characterName: 'Mina' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      characterName: 'Mina',
      groupTurnId: undefined,
      id: 'turn:turn-1',
      kind: 'group',
      surface: 'chat',
      turnId: 'turn-1',
    })
    expect(result[0]?.children.map(entry => entry.id)).toEqual(['direct-text', 'direct-speech', 'direct-recommended'])
  })

  it('keeps late auxiliary children together when their projected surface differs', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'turn-text', purpose: 'main-reply', surface: 'chat', turnId: 'stable-turn-1' }),
      usage({ id: 'turn-speech', purpose: 'speech', surface: 'quick-chat', turnId: 'stable-turn-1' }),
      usage({ id: 'turn-recommended', purpose: 'recommended-replies', surface: 'chat', turnId: 'stable-turn-1' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('turn:stable-turn-1')
    expect(result[0]?.children.map(entry => entry.id)).toEqual(['turn-text', 'turn-speech', 'turn-recommended'])
  })

  it.each(['chat', 'quick-chat'] as const)('includes vision charges and refunds in the same %s turn', (surface) => {
    const vision = usage({
      chargedPoints: 5,
      id: 'image-understanding',
      netPoints: 3,
      purpose: 'vision',
      refundedPoints: 2,
      reservedPoints: 5,
      surface,
      turnId: 'image-chat-turn',
    })
    const result = buildUsageHistoryDisplay([
      usage({ id: 'main-reply', netPoints: 8, surface, turnId: 'image-chat-turn' }),
      vision,
      vision,
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      chargedPoints: 13,
      id: 'turn:image-chat-turn',
      netPoints: 11,
      refundedPoints: 2,
      surface,
    })
    expect(result[0]?.children).toHaveLength(2)
    expect(result[0]?.children.find(entry => entry.purpose === 'vision')?.id).toBe('image-understanding')
  })

  it('keeps vision attached to a group turn under the room total', () => {
    const result = buildUsageHistoryDisplay([
      usage({ groupTurnId: 'image-room-turn', id: 'room-reply', netPoints: 8, turnId: 'image-room-turn:actor' }),
      usage({ chargedPoints: 5, groupTurnId: 'image-room-turn', id: 'room-vision', netPoints: 5, purpose: 'vision', turnId: 'image-child-turn' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      groupTurnId: 'image-room-turn',
      id: 'group:image-room-turn',
      netPoints: 13,
      surface: 'group-chat',
    })
    expect(result[0]?.children.some(entry => entry.purpose === 'vision')).toBe(true)
  })

  it('keeps an automatic vision request with no chat turn as a separate charge', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'chat-reply', surface: 'chat', turnId: 'chat-turn' }),
      usage({ id: 'automatic-vision', purpose: 'vision', surface: 'automatic-screenshot', turnId: undefined }),
    ])

    expect(result).toHaveLength(2)
    expect(result.find(item => item.id === 'automatic-vision')).toMatchObject({ kind: 'single', turnId: undefined, surface: 'automatic-screenshot' })
  })

  it('includes script evaluation and sequel generation in the group total exactly once', () => {
    const evaluation = usage({
      chargedPoints: 2,
      groupTurnId: 'script-room-turn',
      id: 'script-evaluation',
      netPoints: 2,
      purpose: 'group-script-evaluation',
    })
    const result = buildUsageHistoryDisplay([
      usage({ chargedPoints: 8, groupTurnId: 'script-room-turn', id: 'script-reply', netPoints: 8 }),
      evaluation,
      evaluation,
      usage({ chargedPoints: 3, groupTurnId: 'script-room-turn', id: 'script-sequel', netPoints: 3, purpose: 'group-script-sequel' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      chargedPoints: 13,
      groupTurnId: 'script-room-turn',
      id: 'group:script-room-turn',
      netPoints: 13,
    })
    expect(result[0]?.children).toHaveLength(3)
    expect(result[0]?.children.map(entry => entry.purpose)).toEqual(expect.arrayContaining([
      'main-reply',
      'group-script-evaluation',
      'group-script-sequel',
    ]))
  })

  it('keeps separate direct chat turns from the same character independent', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'direct-turn-1', purpose: 'main-reply', surface: 'chat', turnId: 'turn-1', characterName: 'Mina' }),
      usage({ id: 'direct-turn-2', purpose: 'main-reply', surface: 'chat', turnId: 'turn-2', characterName: 'Mina' }),
    ])

    expect(result).toHaveLength(2)
    expect(result.map(item => item.turnId)).toEqual(['turn-2', 'turn-1'])
  })

  it('groups every loaded group-chat service under the room turn', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'role-a-text', purpose: 'main-reply', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:a', characterName: 'Ari', roomName: 'Night Room' }),
      usage({ id: 'role-a-speech', purpose: 'speech', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:a', characterName: 'Ari', roomName: 'Night Room' }),
      usage({ id: 'role-b-text', purpose: 'main-reply', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:b', characterName: 'Mina', roomName: 'Night Room' }),
      usage({ id: 'role-b-speech', purpose: 'speech', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:b', characterName: 'Mina', roomName: 'Night Room' }),
      usage({ id: 'narration-text', purpose: 'group-narration', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:b:narration', characterName: '旁白', roomName: 'Night Room' }),
      usage({ id: 'narration-speech', purpose: 'group-narration-speech', surface: 'group-chat', groupTurnId: 'group-turn-1', turnId: 'group-turn-1:b:narration', characterName: '旁白', roomName: 'Night Room' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      groupTurnId: 'group-turn-1',
      id: 'group:group-turn-1',
      kind: 'group',
      roomName: 'Night Room',
      surface: 'group-chat',
    })
    expect(result[0]?.children.map(entry => entry.id)).toEqual([
      'role-b-text',
      'role-b-speech',
      'role-a-text',
      'role-a-speech',
      'narration-text',
      'narration-speech',
    ])
  })

  it('keeps standalone speech requests outside chat turn grouping', () => {
    const result = buildUsageHistoryDisplay([
      usage({ id: 'standalone-speech', purpose: 'speech', surface: 'unknown', turnId: 'standalone-speech-intent', characterName: undefined }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'standalone-speech',
      kind: 'single',
      turnId: undefined,
    })
  })

  it('hides no-charge narration skips from the account-facing history', () => {
    const result = buildUsageHistoryDisplay([
      usage({
        id: 'narration-skip',
        purpose: 'group-narration',
        groupTurnId: 'group-turn-1',
        billingStatus: 'not_charged',
        failureCategory: 'not-needed',
        chargedPoints: 0,
        refundedPoints: 0,
        netPoints: 0,
      }),
      usage({
        id: 'speaker-charge',
        purpose: 'main-reply',
        groupTurnId: 'group-turn-1',
        billingStatus: 'charged',
        chargedPoints: 8,
        netPoints: 8,
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.children.map(entry => entry.id)).toEqual(['speaker-charge'])
  })

  it('orders a group row by its started time when another request falls between its children', () => {
    const result = buildUsageHistoryDisplay([
      usage({ createdAt: '2026-09-04T12:00:05.000Z', groupTurnId: 'turn-1', id: 'group-new' }),
      usage({ createdAt: '2026-09-04T12:00:03.000Z', groupTurnId: undefined, id: 'single-middle' }),
      usage({ createdAt: '2026-09-04T12:00:01.000Z', groupTurnId: 'turn-1', id: 'group-start' }),
    ])

    expect(result.map(item => item.id)).toEqual(['single-middle', 'group:turn-1'])
    expect(result[1]?.children.map(entry => entry.id)).toEqual(['group-new', 'group-start'])
  })
})
