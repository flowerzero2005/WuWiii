const TRANSCRIPT_EVIDENCE_MS = 6000
const PLAYBACK_EVIDENCE_MS = 1800

export function createCallInputVolumeGate() {
  let sampled = false
  let lastLoudAt = Number.NEGATIVE_INFINITY

  function observe(volume: number, threshold: number, now = Date.now()) {
    if (!Number.isFinite(volume))
      return
    sampled = true
    if (volume >= threshold)
      lastLoudAt = now
  }

  function playbackStarted() {
    lastLoudAt = Number.NEGATIVE_INFINITY
  }

  function canInterrupt(now = Date.now()) {
    return !sampled || now - lastLoudAt <= PLAYBACK_EVIDENCE_MS
  }

  function acceptsTranscript(playbackActive: boolean, now = Date.now()) {
    return !sampled || now - lastLoudAt <= (playbackActive ? PLAYBACK_EVIDENCE_MS : TRANSCRIPT_EVIDENCE_MS)
  }

  function reset() {
    sampled = false
    lastLoudAt = Number.NEGATIVE_INFINITY
  }

  return { observe, playbackStarted, canInterrupt, acceptsTranscript, reset }
}
