export async function resyncRendererState(options: {
  refreshAccount: () => Promise<unknown>
  refreshProfileAndSettings: () => Promise<unknown> | unknown
  refreshChatSessions?: () => Promise<unknown>
}) {
  await options.refreshAccount()
  await options.refreshProfileAndSettings()
  await options.refreshChatSessions?.()
}
