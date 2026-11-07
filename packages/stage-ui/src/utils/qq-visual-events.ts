import { getOfficialApiFetch, SERVER_URL } from '../libs/auth'

export interface QqVisualEvent {
  turnId: string
  characterId: string
  emotion: 'happy' | 'sad' | 'angry' | 'think' | 'surprised' | 'awkward' | 'question' | 'curious' | 'neutral' | null
  deliveredAt: string
}

export function startQqVisualEventPolling(onEvent: (event: QqVisualEvent) => void) {
  let stopped = false
  let polling = false
  const startedAt = Date.now()
  const seen = new Set<string>()

  async function poll() {
    if (stopped || polling)
      return
    polling = true
    try {
      const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/visual-events`, { credentials: 'include' })
      if (!response.ok)
        return
      const events = await response.json() as QqVisualEvent[]
      if (stopped || !Array.isArray(events))
        return
      for (const event of [...events].reverse()) {
        if (seen.has(event.turnId))
          continue
        seen.add(event.turnId)
        if (Date.parse(event.deliveredAt) >= startedAt && event.emotion && event.emotion !== 'neutral')
          onEvent(event)
      }
      if (seen.size > 100) {
        const current = new Set(events.map(event => event.turnId))
        seen.clear()
        current.forEach(id => seen.add(id))
      }
    }
    catch {
      // QQ remains independent of the current device and its network state.
    }
    finally {
      polling = false
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), 2500)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
