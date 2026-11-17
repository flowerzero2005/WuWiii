import { storage } from '../../database/storage'

export interface AppSticker {
  id: string
  imageData: string
  description: string
  emotionTags: string[]
  seriesTag: string
  favorite: boolean
  useCount: number
}

export interface AppStickerLibrary {
  stickers: AppSticker[]
  stickerFrequency: number
}

const keyFor = (characterId: string) => `local:chat/stickers/${characterId}`

export async function loadAppStickerLibrary(characterId: string): Promise<AppStickerLibrary> {
  const stored = await storage.getItemRaw<AppStickerLibrary>(keyFor(characterId))
  return {
    stickers: Array.isArray(stored?.stickers) ? stored.stickers : [],
    stickerFrequency: Math.max(0, Math.min(100, Number(stored?.stickerFrequency ?? 25))),
  }
}

export async function saveAppStickerLibrary(characterId: string, library: AppStickerLibrary) {
  await storage.setItemRaw(keyFor(characterId), library)
}

export async function addAppSticker(characterId: string, imageData: string, description: string, options: Partial<Pick<AppSticker, 'emotionTags' | 'seriesTag' | 'favorite'>> = {}) {
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(imageData) || imageData.length > 2_800_000)
    throw new Error('请选择不超过 2 MB 的 PNG、JPEG、WebP 或 GIF 图片')
  const library = await loadAppStickerLibrary(characterId)
  const existing = library.stickers.find(item => item.imageData === imageData)
  if (existing)
    return existing
  if (library.stickers.length >= 48)
    throw new Error('每个角色最多保存 48 张表情包')
  const sticker: AppSticker = {
    id: crypto.randomUUID(),
    imageData,
    description: description.trim() || '未描述的表情包',
    emotionTags: options.emotionTags ?? [],
    seriesTag: options.seriesTag ?? '',
    favorite: options.favorite ?? false,
    useCount: 0,
  }
  library.stickers.push(sticker)
  await saveAppStickerLibrary(characterId, library)
  return sticker
}

export async function updateAppSticker(characterId: string, stickerId: string, changes: Partial<Pick<AppSticker, 'description' | 'emotionTags' | 'seriesTag' | 'favorite' | 'useCount'>>) {
  const library = await loadAppStickerLibrary(characterId)
  const sticker = library.stickers.find(item => item.id === stickerId)
  if (!sticker)
    return
  Object.assign(sticker, changes)
  await saveAppStickerLibrary(characterId, library)
}

export async function removeAppSticker(characterId: string, stickerId: string) {
  const library = await loadAppStickerLibrary(characterId)
  library.stickers = library.stickers.filter(item => item.id !== stickerId)
  await saveAppStickerLibrary(characterId, library)
}
