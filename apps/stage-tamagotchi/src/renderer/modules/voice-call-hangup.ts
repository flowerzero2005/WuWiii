export interface PendingVoiceCallHangup {
  generation: number
  turnId?: string
}

/** Keeps a hangup request attached only to the latest voice-call reply. */
export function createVoiceCallHangupState() {
  let generation = 0
  let pending: PendingVoiceCallHangup | undefined

  function request(turnId?: string) {
    pending = { generation: ++generation, turnId }
    return { ...pending }
  }

  function supersedeForNewInput() {
    if (!pending)
      return false
    pending = { generation: ++generation }
    return true
  }

  function bindToTurn(turnId: string) {
    if (!pending)
      return undefined
    pending = { ...pending, turnId }
    return { ...pending }
  }

  function snapshotForTurn(turnId: string) {
    return pending?.turnId === turnId ? { ...pending } : undefined
  }

  function isCurrent(snapshot: PendingVoiceCallHangup) {
    return pending?.generation === snapshot.generation && pending.turnId === snapshot.turnId
  }

  function isPending() {
    return Boolean(pending)
  }

  function clear() {
    pending = undefined
  }

  return { bindToTurn, clear, isCurrent, isPending, request, snapshotForTurn, supersedeForNewInput }
}
