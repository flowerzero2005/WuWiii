export const OFFICIAL_STREAM_FIRST_EVENT_TIMEOUT_MS = 90_000
export const OFFICIAL_CHAT_IDLE_TIMEOUT_MS = 120_000

/** Freeze this budget when a turn starts, before any provider selection changes. */
export function resolveChatTurnIdleTimeoutMs(officialCloud: boolean, defaultTimeoutMs: number) {
  return officialCloud ? OFFICIAL_CHAT_IDLE_TIMEOUT_MS : defaultTimeoutMs
}
