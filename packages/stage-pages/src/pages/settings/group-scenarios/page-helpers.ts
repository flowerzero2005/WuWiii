import type { GroupRoomScriptState } from './model'

export const GROUP_SCRIPT_ROUTE_KEYS = {
  title: 'settings.pages.group-scripts.title',
  description: 'settings.pages.group-scripts.description',
} as const

/** Keeps a complete one-to-one cast by swapping the member already using a newly selected role. */
export function reassignRoomCast(
  bindings: Record<string, string>,
  slotId: string,
  characterId: string,
) {
  const previousCharacterId = bindings[slotId]
  const occupiedSlotId = Object.entries(bindings)
    .find(([candidateSlotId, candidateCharacterId]) => candidateSlotId !== slotId && candidateCharacterId === characterId)?.[0]

  return {
    ...bindings,
    [slotId]: characterId,
    ...(occupiedSlotId && previousCharacterId ? { [occupiedSlotId]: previousCharacterId } : {}),
  }
}

/** Discards a slow room load once a newer room selection has started. */
export async function resolveRoomScriptForRequest(input: {
  requestRevision: number
  currentRevision: () => number
  resolve: () => Promise<GroupRoomScriptState | undefined>
}) {
  const roomScript = await input.resolve()
  return input.currentRevision() === input.requestRevision ? roomScript : undefined
}
