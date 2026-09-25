import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./context-bridge.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('context bridge stream session isolation', () => {
  it('uses the turn source session when mirroring stream events', () => {
    expect(source).toContain('function resolveStreamSessionId(context: Partial<ChatStreamEventContext>, fallback: string)')
    expect(source).toContain('sessionId: resolveStreamSessionId(context, chatSession.activeSessionId)')
  })

  it('ignores stream mirrors for a different active conversation', () => {
    expect(source).toContain('event.sessionId !== chatSession.activeSessionId && !needsGroupSpeechRegistration')
    expect(source).toContain('generation: chatSession.getSessionGenerationValue(event.sessionId)')
    expect(source).toContain('chatStream.beginStream(event.sessionId)')
  })

  it('still registers an inactive group turn speaker selection with the speech host', () => {
    expect(source).toContain("const needsGroupSpeechRegistration = event.type === 'before-compose'")
    expect(source).toContain("&& event.context.internal?.groupChat === true")
    expect(source).toContain('event.sessionId !== chatSession.activeSessionId && !needsGroupSpeechRegistration')
  })

  it('drops stale special-token mirrors from an older turn', () => {
    const tokenSpecial = source.slice(source.indexOf("case 'token-special':"), source.indexOf("case 'stream-end':"))
    expect(tokenSpecial).toContain('if (!remoteStreamGuard)')
    expect(tokenSpecial).toContain('remoteStreamGuard.sessionId !== chatSession.activeSessionId')
    expect(tokenSpecial).toContain('getSessionGenerationValue(remoteStreamGuard.sessionId) !== remoteStreamGuard.generation')
  })

  it('transports the frozen turn snapshot for speaker-specific speech playback', () => {
    const minimalContext = source.slice(source.indexOf('function createMinimalContext'), source.indexOf('function cloneContextsForTransport'))
    expect(minimalContext).toContain('turn: context.turn ? toRaw(context.turn) : undefined')
  })
})
