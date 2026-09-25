import { describe, expect, it } from 'vitest'

import { createVoiceCallHangupState } from './voice-call-hangup'

describe('voice call pending hangup', () => {
  it('moves farewell responsibility to new input and invalidates the old hangup', () => {
    const state = createVoiceCallHangupState()
    const firstFarewell = state.request('turn-1')

    expect(state.supersedeForNewInput()).toBe(true)
    expect(state.isCurrent(firstFarewell)).toBe(false)
    expect(state.snapshotForTurn('turn-1')).toBeUndefined()

    const latestFarewell = state.bindToTurn('turn-2')
    expect(state.snapshotForTurn('turn-2')).toEqual(latestFarewell)
  })

  it('clears a pending hangup so the next turn is an ordinary call reply', () => {
    const state = createVoiceCallHangupState()
    const farewell = state.request('turn-1')

    state.clear()

    expect(state.isPending()).toBe(false)
    expect(state.isCurrent(farewell)).toBe(false)
    expect(state.bindToTurn('turn-2')).toBeUndefined()
  })
})
