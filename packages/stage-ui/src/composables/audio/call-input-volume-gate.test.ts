import { describe, expect, it } from 'vitest'

import { createCallInputVolumeGate } from './call-input-volume-gate'

describe('call input volume gate', () => {
  it('rejects transcripts below the configured threshold', () => {
    const gate = createCallInputVolumeGate()
    gate.observe(24, 25, 1000)

    expect(gate.acceptsTranscript(false, 1100)).toBe(false)
    gate.observe(25, 25, 1200)
    expect(gate.acceptsTranscript(false, 1300)).toBe(true)
    expect(gate.acceptsTranscript(false, 7201)).toBe(false)
  })

  it('requires a fresh loud sample after assistant playback begins', () => {
    const gate = createCallInputVolumeGate()
    gate.observe(30, 25, 1000)
    gate.playbackStarted()

    expect(gate.canInterrupt(1100)).toBe(false)
    expect(gate.acceptsTranscript(true, 1100)).toBe(false)
    gate.observe(28, 25, 1200)
    expect(gate.canInterrupt(1300)).toBe(true)
    expect(gate.acceptsTranscript(true, 3001)).toBe(false)
  })

  it('keeps ASR available when volume sampling is unavailable', () => {
    const gate = createCallInputVolumeGate()

    expect(gate.acceptsTranscript(false)).toBe(true)
    expect(gate.canInterrupt()).toBe(true)
    gate.observe(0, 25, 1000)
    expect(gate.acceptsTranscript(false, 1100)).toBe(false)
    gate.reset()
    expect(gate.acceptsTranscript(false)).toBe(true)
  })
})
