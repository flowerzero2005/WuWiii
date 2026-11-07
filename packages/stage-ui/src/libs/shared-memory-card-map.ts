const STORAGE_PREFIX = 'airi-shared-memory-card-map:'

function readMappings(ownerId: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${ownerId}`) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  catch {
    return {}
  }
}

export function resolveLocalMemoryCardId(ownerId: string, serverPersonaId: string, localCardIds: Iterable<string>): string | null {
  const ids = new Set(localCardIds)
  const mappedId = readMappings(ownerId)[serverPersonaId]
  if (mappedId)
    return ids.has(mappedId) ? mappedId : null
  return ids.has(serverPersonaId) ? serverPersonaId : null
}

export function mappedServerMemoryCardIds(ownerId: string): string[] {
  return Object.keys(readMappings(ownerId))
}

export function setLocalMemoryCardId(ownerId: string, serverPersonaId: string, localCardId: string) {
  const mappings = readMappings(ownerId)
  mappings[serverPersonaId] = localCardId
  localStorage.setItem(`${STORAGE_PREFIX}${ownerId}`, JSON.stringify(mappings))
}
