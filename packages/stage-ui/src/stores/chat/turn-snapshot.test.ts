import { describe, expect, it } from 'vitest'

import { createAiriPersonaAffectDefinition } from './persona-affect-definition'
import { createChatTurnSnapshot } from './turn-snapshot'

describe('createChatTurnSnapshot', () => {
  it('freezes turn identity and speech selection at turn creation', () => {
    const persona = {
      affectDefinition: createAiriPersonaAffectDefinition(),
      personaCardId: 'character-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      emotionDimensions: ['affection'],
      systemPrompt: 'character A prompt',
    }
    const snapshot = createChatTurnSnapshot({
      turnId: 'turn-a',
      sessionId: 'session-a',
      sourceSurface: 'chat',
      assistantMessageIds: ['assistant-a'],
      language: {
        source: 'message-language',
        targetLanguage: 'en',
      },
      persona,
      speaker: {
        characterId: 'character-a',
        displayName: 'AIRI',
        avatarUrl: '/avatar-a.png',
        roomName: 'Room A',
      },
      speech: {
        segmentation: 'streaming',
        selection: {
          providerId: 'provider-a',
          modelId: 'model-a',
          voiceId: 'voice-a',
        },
      },
    })

    expect(snapshot.speech?.intentId).toBe('turn-a')
    expect(snapshot.speech?.streamId).toBe('turn-a:speech')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.speech)).toBe(true)
    expect(Object.isFrozen(snapshot.speech?.selection)).toBe(true)
    expect(snapshot.speaker?.avatarUrl).toBe('/avatar-a.png')
    expect(snapshot.speaker?.roomName).toBe('Room A')
    expect(snapshot.language).toEqual({ source: 'message-language', targetLanguage: 'en' })
    expect(Object.isFrozen(snapshot.language)).toBe(true)

    persona.providerId = 'provider-b'
    persona.emotionDimensions.push('hurt')
    persona.systemPrompt = 'character B prompt'

    expect(snapshot.persona).toEqual({
      affectDefinition: createAiriPersonaAffectDefinition(),
      personaCardId: 'character-a',
      providerId: 'provider-a',
      modelId: 'model-a',
      emotionDimensions: ['affection'],
      systemPrompt: 'character A prompt',
    })
    expect(Object.isFrozen(snapshot.persona)).toBe(true)
    expect(Object.isFrozen(snapshot.persona?.emotionDimensions)).toBe(true)
    expect(Object.isFrozen(snapshot.persona?.affectDefinition)).toBe(true)
  })
})
