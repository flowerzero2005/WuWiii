import { afterEach, describe, expect, it, vi } from 'vitest'

import { acknowledgeOfficialCloudChatDelivery } from '../../libs/providers/providers/official-cloud/delivery-ack'
import { requestGroupNarration, shouldRequestGroupNarration } from './group-narration'

const request = {
  groupTurnId: 'group-turn',
  priorPublicEntries: [],
  protocolVersion: 1 as const,
  roomMembers: [{ characterId: 'character-a', displayName: 'A' }],
  roomName: 'Room',
  roomRelationships: [],
  sessionId: 'room-session',
  speakerCharacterId: 'character-a',
  speakerName: 'A',
  speakerText: 'Hello.',
  speakerTurnId: 'speaker-turn-a',
  userText: 'Start.',
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch }).__AIRI_ELECTRON_FETCH_PROXY__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('group narration client', () => {
  it('offers narration for every non-empty speaker reply when enabled', () => {
    expect(shouldRequestGroupNarration({ hasScriptScene: false, priorPublicEntries: [], speakerText: 'The answer is 42.' })).toBe(true)
    expect(shouldRequestGroupNarration({ hasScriptScene: false, priorPublicEntries: [], speakerText: '*She looks toward the door.* Let us go.' })).toBe(true)
    expect(shouldRequestGroupNarration({ hasScriptScene: true, priorPublicEntries: [], speakerText: 'All right.' })).toBe(true)
    expect(shouldRequestGroupNarration({ hasScriptScene: true, priorPublicEntries: [], speakerText: '   ' })).toBe(false)
  })
  it('uses the Electron fetch proxy and registers the server delivery token', async () => {
    const proxy = vi.fn()
      .mockResolvedValueOnce(Response.json({
        before: 'Before.',
        protocolVersion: 1,
        requestId: 'server-request',
        skipped: false,
        usageEventId: 'usage-1',
      }, { headers: { 'x-airi-delivery-token': 'delivery-token' } }))
      .mockResolvedValueOnce(Response.json({ kind: 'chat', status: 'settled' }))
    ;(globalThis as typeof globalThis & { __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch }).__AIRI_ELECTRON_FETCH_PROXY__ = proxy

    await expect(requestGroupNarration(request, { requestId: 'stable-request' })).resolves.toMatchObject({ before: 'Before.' })
    const [, init] = proxy.mock.calls[0]!
    const body = JSON.parse(init.body)
    expect(body.roomMembers).toEqual([{ characterId: 'character-a', displayName: 'A' }])
    expect(body.roomRelationships).toEqual([])
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('providerId')
    expect(init.headers).toMatchObject({
      'x-airi-delivery-ack': 'v1',
      'x-airi-request-id': 'stable-request',
    })

    await expect(acknowledgeOfficialCloudChatDelivery('server-request')).resolves.toBe(true)
    expect(proxy).toHaveBeenCalledTimes(2)
  })

  it('does not register a delivery for a no-charge skip', async () => {
    const proxy = vi.fn().mockResolvedValue(Response.json({
      protocolVersion: 1,
      requestId: 'skipped-request',
      skipped: true,
      usageEventId: 'usage-skip',
    }))
    ;(globalThis as typeof globalThis & { __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch }).__AIRI_ELECTRON_FETCH_PROXY__ = proxy

    await requestGroupNarration(request, { requestId: 'stable-request' })

    await expect(acknowledgeOfficialCloudChatDelivery('skipped-request')).resolves.toBe(false)
    expect(proxy).toHaveBeenCalledOnce()
  })

  it('retries once without roomName for an older strict server schema', async () => {
    const proxy = vi.fn()
      .mockResolvedValueOnce(Response.json({
        details: [{ expected: 'never', path: [{ key: 'roomName' }] }],
        message: 'Invalid group narration request',
      }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({
        protocolVersion: 1,
        requestId: 'legacy-request',
        skipped: true,
        usageEventId: 'usage-legacy',
      }))
    ;(globalThis as typeof globalThis & { __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch }).__AIRI_ELECTRON_FETCH_PROXY__ = proxy

    await expect(requestGroupNarration(request, { requestId: 'legacy-client' })).resolves.toMatchObject({ skipped: true })
    expect(proxy).toHaveBeenCalledTimes(2)
    expect(JSON.parse(proxy.mock.calls[1]![1].body)).not.toHaveProperty('roomName')
  })
})
