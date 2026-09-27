/** Shared upload contract for chat, detached drafts and official vision. */
export const VISION_MAX_IMAGES = 10
export const VISION_MAX_IMAGE_BYTES = 10 * 1024 * 1024
// Keep the previous four-image binary budget when allowing more images.
export const VISION_MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024
export const VISION_REQUEST_BODY_LIMIT_BYTES = Math.ceil(VISION_MAX_TOTAL_IMAGE_BYTES / 3) * 4
  + VISION_MAX_IMAGES * 64 + 1024 * 1024

export const VISION_IMAGE_LIMITS_I18N_PARAMS = {
  count: VISION_MAX_IMAGES,
  maxImageMb: VISION_MAX_IMAGE_BYTES / 1024 / 1024,
  maxTotalMb: VISION_MAX_TOTAL_IMAGE_BYTES / 1024 / 1024,
} as const
