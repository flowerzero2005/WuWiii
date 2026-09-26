import type { NativeImage } from 'electron'

export function serializeSourceThumbnail(thumbnail: Pick<NativeImage, 'isEmpty' | 'toJPEG'> | null | undefined) {
  if (!thumbnail || thumbnail.isEmpty())
    return undefined
  return new Uint8Array(thumbnail.toJPEG(90))
}

export function serializeSourceAppIcon(appIcon: Pick<NativeImage, 'isEmpty' | 'toPNG'> | null | undefined) {
  if (!appIcon || appIcon.isEmpty())
    return undefined
  return new Uint8Array(appIcon.toPNG())
}
