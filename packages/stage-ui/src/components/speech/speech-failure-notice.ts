const lastNoticeAt = new Map<string, number>()

export function shouldShowSpeechFailureNotice(kind: string, now = Date.now(), dedupeMs = 5000) {
  const previous = lastNoticeAt.get(kind) ?? 0
  if (now - previous < dedupeMs)
    return false
  lastNoticeAt.set(kind, now)
  return true
}

export function resetSpeechFailureNoticeDedupe() {
  lastNoticeAt.clear()
}
