import { describe, expect, it } from 'vitest'

import { buildPersonaChatContacts } from './persona-contacts'

describe('persona chat contacts', () => {
  it('pins AIRI/default first and includes loaded persona cards', () => {
    const contacts = buildPersonaChatContacts({
      personas: [
        { id: 'mi-side', name: 'MiSide' },
        { id: 'default', name: 'AIRI' },
      ],
      sessions: [],
    })

    expect(contacts.map(contact => contact.characterId)).toEqual(['default', 'mi-side'])
    expect(contacts[0]).toMatchObject({
      characterId: 'default',
      displayName: 'AIRI',
      sessionId: 'default',
      unreadCount: 0,
    })
    expect(contacts[1]).toMatchObject({
      characterId: 'mi-side',
      displayName: 'MiSide',
      sessionId: 'mi-side',
      unreadCount: 0,
    })
  })

  it('binds contacts to existing sessions by characterId', () => {
    const contacts = buildPersonaChatContacts({
      personas: [
        { id: 'default', name: 'AIRI' },
        { id: 'narrator', name: 'Narrator' },
      ],
      sessions: [
        {
          characterId: 'narrator',
          id: 'session-narrator',
          lastMessageAt: 200,
          lastMessagePreview: 'Last line',
          unreadCount: 3,
        },
      ],
    })

    expect(contacts.find(contact => contact.characterId === 'narrator')).toMatchObject({
      characterId: 'narrator',
      lastMessageAt: 200,
      lastMessagePreview: 'Last line',
      sessionId: 'session-narrator',
      unreadCount: 3,
    })
  })

  it('sorts non-default contacts by last message time after the pinned default contact', () => {
    const contacts = buildPersonaChatContacts({
      personas: [
        { id: 'older', name: 'Older' },
        { id: 'default', name: 'AIRI' },
        { id: 'newer', name: 'Newer' },
        { id: 'no-session', name: 'No session' },
      ],
      sessions: [
        { characterId: 'default', id: 'session-default', lastMessageAt: 1_000 },
        { characterId: 'older', id: 'session-older', lastMessageAt: 10 },
        { characterId: 'newer', id: 'session-newer', lastMessageAt: 20 },
      ],
    })

    expect(contacts.map(contact => contact.characterId)).toEqual(['default', 'newer', 'older', 'no-session'])
    expect(contacts[0].sessionId).toBe('session-default')
  })

  it('defaults unread count to 0 when session does not provide it', () => {
    const contacts = buildPersonaChatContacts({
      personas: [{ id: 'default', name: 'AIRI' }],
      sessions: [{ characterId: 'default', id: 'session-default' }],
    })

    expect(contacts[0].unreadCount).toBe(0)
  })
})
