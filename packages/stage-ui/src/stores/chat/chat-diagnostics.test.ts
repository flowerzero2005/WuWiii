import { describe, expect, it, vi } from 'vitest'

import { createChatTraceHeaders, createChatTraceRequest, logChatTrace } from './chat-diagnostics'

describe('chat diagnostics', () => {
  it('adds a distinct staged request identity while preserving caller headers', () => {
    const request = createChatTraceRequest({
      groupTurnId: 'group/turn 1',
      requestId: 'parent-request',
      sourceSurface: 'quick chat',
      turnId: 'turn/1',
    }, 'tool-execution')
    const headers = createChatTraceHeaders({ authorization: 'secret' }, request)

    expect(headers).toMatchObject({
      'authorization': 'secret',
      'x-airi-group-turn-id': 'group_turn_1',
      'x-airi-parent-request-id': 'parent-request',
      'x-airi-request-id': request.requestId,
      'x-airi-request-stage': 'tool-execution',
      'x-airi-source-surface': 'quick_chat',
      'x-airi-turn-id': 'turn_1',
    })
    expect(request.requestId).not.toBe('parent-request')
    expect(request.groupTurnId).toBe('group/turn 1')
  })

  it('normalizes Headers before adding trace headers', () => {
    const headers = createChatTraceHeaders(new Headers({ authorization: 'secret' }), {
      requestId: 'request-1',
      sourceSurface: 'chat',
      stage: 'recommended-replies',
      turnId: 'turn-1',
    })

    expect(headers).toMatchObject({
      'authorization': 'secret',
      'x-airi-request-id': 'request-1',
      'x-airi-request-stage': 'recommended-replies',
    })
    expect(headers).not.toHaveProperty('x-airi-group-turn-id')
  })

  it('encodes user-visible role and room labels for billing snapshots', () => {
    const headers = createChatTraceHeaders(undefined, {
      characterName: '小明',
      roomName: '晚餐房间',
      sourceSurface: 'group-chat',
      stage: 'group-narration-tts',
      turnId: 'turn-1',
    })

    expect(decodeURIComponent(headers['x-airi-character-name']!)).toBe('小明')
    expect(decodeURIComponent(headers['x-airi-room-name']!)).toBe('晚餐房间')
  })

  it('logs only the diagnostic allowlist', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const unsafeDetails = {
      trace: {
        sourceSurface: 'chat',
        stage: 'chat-primary' as const,
        turnId: 'turn-1',
      },
      status: 'error' as const,
      textLength: 42,
      error: Object.assign(new Error('private prompt text'), { code: 'UPSTREAM_502' }),
      prompt: 'private prompt text',
      headers: { Authorization: 'secret', Cookie: 'private' },
      audio: new Uint8Array([1, 2, 3]),
    }

    logChatTrace('request:end', unsafeDetails)

    const payload = info.mock.calls[0]?.[2]
    expect(payload).toMatchObject({
      errorCode: 'UPSTREAM_502',
      errorName: 'Error',
      status: 'error',
      textLength: 42,
      turnId: 'turn-1',
    })
    expect(JSON.stringify(payload)).not.toContain('private prompt text')
    expect(JSON.stringify(payload)).not.toContain('Authorization')
    expect(JSON.stringify(payload)).not.toContain('Cookie')
    expect(JSON.stringify(payload)).not.toContain('audio')
    info.mockRestore()
  })
})
