export interface PersonaChatContact {
  avatarUrl?: string
  characterId: string
  displayName: string
  lastMessagePreview?: string
  lastMessageAt?: number
  sessionId: string
  unreadCount: number
}

interface PersonaContactInput {
  avatarUrl?: string
  id: string
  name: string
}

interface PersonaSessionInput {
  characterId?: string
  id: string
  lastMessageAt?: number
  lastMessagePreview?: string
  unreadCount?: number
}

export function buildPersonaChatContacts(params: {
  activeCharacterId?: string
  defaultDisplayName?: string
  personas: PersonaContactInput[]
  sessions: PersonaSessionInput[]
}): PersonaChatContact[] {
  const personasById = new Map(params.personas.map(persona => [persona.id, persona]))
  const sessionsByCharacterId = new Map<string, PersonaSessionInput>()

  for (const session of params.sessions) {
    if (!session.characterId)
      continue

    const current = sessionsByCharacterId.get(session.characterId)
    if (!current || (session.lastMessageAt ?? 0) > (current.lastMessageAt ?? 0))
      sessionsByCharacterId.set(session.characterId, session)
  }

  const defaultDisplayName = params.defaultDisplayName?.trim() || 'Wuwu'
  const defaultPersona = personasById.get('default') ?? { id: 'default', name: defaultDisplayName }
  personasById.set('default', defaultPersona)

  const contacts = Array.from(personasById.values()).map((persona) => {
    const session = sessionsByCharacterId.get(persona.id)

    return {
      avatarUrl: persona.avatarUrl,
      characterId: persona.id,
      displayName: persona.name || defaultDisplayName,
      lastMessageAt: session?.lastMessageAt,
      lastMessagePreview: session?.lastMessagePreview,
      sessionId: session?.id ?? persona.id,
      unreadCount: session?.unreadCount ?? 0,
    } satisfies PersonaChatContact
  })

  return contacts.sort((left, right) => {
    if (left.characterId === 'default')
      return -1
    if (right.characterId === 'default')
      return 1
    return (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0)
  })
}
