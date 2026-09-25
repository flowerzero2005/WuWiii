export interface VoiceCallTranscript {
  text: string
  turnId: string
}

export interface VoiceCallTranscriptQueueOptions {
  /** Delay delivery to allow a short trailing pause in streaming ASR output. */
  graceMs?: number
}

export function createVoiceCallTranscriptQueue(
  deliver: (transcript: VoiceCallTranscript) => Promise<void>,
  createTurnId: () => string,
  options: VoiceCallTranscriptQueueOptions = {},
) {
  let tail = Promise.resolve()
  const deliveredTurnIds = new Set<string>()

  return (rawText: string) => {
    const text = rawText.trim()
    if (!text)
      return Promise.resolve()

    const transcript = Object.freeze({ text, turnId: createTurnId() })
    const task = tail.then(async () => {
      if (options.graceMs && options.graceMs > 0)
        await new Promise<void>(resolve => setTimeout(resolve, options.graceMs))

      if (deliveredTurnIds.has(transcript.turnId))
        return

      deliveredTurnIds.add(transcript.turnId)
      await deliver(transcript)
    })
    tail = task.catch(() => undefined)
    return task
  }
}
