const OFFICIAL_PROVIDER_ID_PREFIX = 'official-cloud'

export function resolveChatVisionRouting(
  hasAttachments: boolean,
  modelSupportsVision: boolean,
  providerId: string | undefined,
) {
  const useNativeChatVision = hasAttachments
    && modelSupportsVision
    && Boolean(providerId?.trim())
    && !providerId?.startsWith(OFFICIAL_PROVIDER_ID_PREFIX)
  return {
    shouldUseVisionAnalysis: hasAttachments && !useNativeChatVision,
    useNativeChatVision,
  }
}
