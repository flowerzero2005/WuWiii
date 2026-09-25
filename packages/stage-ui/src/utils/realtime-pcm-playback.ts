export interface RealtimePcmPlaybackAudio {
  sampleRate: number
  stream: ReadableStream<ArrayBuffer>
}

export interface RealtimePcmPlaybackOptions {
  audio: RealtimePcmPlaybackAudio
  audioContext: AudioContext
  audibleStartDelayMs: number
  connectOutputGain?: (gain: GainNode) => void
  onPlaybackStart: () => void
  outputVolume: number
  signal: AbortSignal
}

function createPcmAudioBuffer(audioContext: AudioContext, audio: ArrayBuffer, sampleRate: number) {
  const sampleCount = Math.floor(audio.byteLength / 2)
  const buffer = audioContext.createBuffer(1, sampleCount, sampleRate)
  const channel = buffer.getChannelData(0)
  const samples = new Int16Array(audio, 0, sampleCount)
  for (let index = 0; index < sampleCount; index += 1)
    channel[index] = samples[index]! / 32768
  return buffer
}

/** Schedule a 16-bit mono PCM stream without gaps while preserving abort semantics. */
export async function playRealtimePcmStream(options: RealtimePcmPlaybackOptions): Promise<void> {
  const { audio, audioContext, signal } = options
  const reader = audio.stream.getReader()
  const gain = audioContext.createGain()
  gain.gain.value = Math.min(1, Math.max(0, options.outputVolume))
  gain.connect(audioContext.destination)
  options.connectOutputGain?.(gain)

  const sources = new Set<AudioBufferSourceNode>()
  const pendingChunks: ArrayBuffer[] = []
  let nextStartAt = audioContext.currentTime
  let firstSource: AudioBufferSourceNode | undefined
  let playbackAnnounced = false
  let settled = false
  let bufferedBytes = 0
  let audibleStartTimer: ReturnType<typeof setTimeout> | undefined

  const announce = () => {
    if (playbackAnnounced || settled || signal.aborted)
      return
    playbackAnnounced = true
    options.onPlaybackStart()
  }

  const stop = () => {
    settled = true
    if (audibleStartTimer)
      clearTimeout(audibleStartTimer)
    try {
      gain.gain.cancelScheduledValues(audioContext.currentTime)
      gain.gain.setValueAtTime(0, audioContext.currentTime)
    }
    catch {}
    for (const source of sources) {
      try {
        source.stop()
      }
      catch {}
      source.disconnect()
    }
    sources.clear()
    pendingChunks.length = 0
    gain.disconnect()
    void reader.cancel()
  }

  const schedulePendingChunks = () => {
    while (pendingChunks.length > 0) {
      if (settled || signal.aborted)
        return

      const chunk = pendingChunks.shift()!
      const decoded = createPcmAudioBuffer(audioContext, chunk, audio.sampleRate)
      const source = audioContext.createBufferSource()
      source.buffer = decoded
      source.connect(gain)
      sources.add(source)
      const startAt = Math.max(nextStartAt, audioContext.currentTime)
      source.start(startAt)
      nextStartAt = startAt + decoded.duration
      if (!firstSource) {
        firstSource = source
        audibleStartTimer = setTimeout(announce, Math.max(0, options.audibleStartDelayMs))
      }
      source.onended = () => {
        sources.delete(source)
        source.disconnect()
        if (source === firstSource)
          announce()
      }
      bufferedBytes -= chunk.byteLength
    }
  }

  if (signal.aborted) {
    stop()
    return
  }

  signal.addEventListener('abort', stop, { once: true })

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done || settled)
        break
      if (!value?.byteLength)
        continue

      pendingChunks.push(value)
      bufferedBytes += value.byteLength
      if (!firstSource && bufferedBytes < audio.sampleRate * 2 * 0.18)
        continue

      schedulePendingChunks()
    }

    schedulePendingChunks()
    if (!firstSource)
      return

    await new Promise<void>((resolve) => {
      const poll = () => {
        if (settled || sources.size === 0) {
          resolve()
          return
        }
        setTimeout(poll, 20)
      }
      poll()
    })
  }
  finally {
    signal.removeEventListener('abort', stop)
    if (!settled)
      stop()
  }
}
