export interface CallOverlayMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  playbackStartedAt?: number
  playbackDurationMs?: number
}

export interface CallPresentationEvent {
  role: CallOverlayMessage['role']
  text: string
  id: string
  startedAt: number
  durationMs: number
}

export function updateCallOverlayMessages(messages: CallOverlayMessage[], event: CallPresentationEvent): CallOverlayMessage[] {
  if (event.role === 'assistant' && !event.text.trim()) {
    const activeIndex = messages.findLastIndex(message => message.role === 'assistant' && (message.playbackDurationMs ?? 0) > 0)
    return activeIndex < 0 ? messages : messages.filter((_, index) => index !== activeIndex)
  }
  if (!event.text.trim() || !event.id)
    return messages

  const message: CallOverlayMessage = {
    id: event.id,
    role: event.role,
    text: event.text,
    ...(event.role === 'assistant' && event.durationMs > 0
      ? { playbackStartedAt: event.startedAt, playbackDurationMs: event.durationMs }
      : {}),
  }
  const existingIndex = messages.findIndex(item => item.id === event.id && item.role === event.role)
  const next = [...messages]
  if (existingIndex >= 0)
    next[existingIndex] = message
  else
    next.push(message)
  return next.slice(-12)
}
