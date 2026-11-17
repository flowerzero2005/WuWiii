import type { ChatProvider } from '@xsai-ext/providers/utils'

import { generateText } from '@xsai/generate-text'

import { getOfficialApiFetch, SERVER_URL } from '../../libs/auth'
import { loadAppStickerLibrary, updateAppSticker } from './app-stickers'
import { createChatTraceHeaders, createChatTraceRequest } from './chat-diagnostics'

interface CharacterSticker {
  id: string
  description: string
  emotionTags: string[]
  seriesTag: string
  favorite: boolean
  useCount: number
  imageData?: string
}

interface CharacterStickerLibrary {
  stickers: CharacterSticker[]
  stickerFrequency: number
}

const STICKER_ID = /^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/
const QQ_STICKER_CDN_URL = /^https:\/\/(?:p|gchat)\.qpic\.cn\/[\w%/.-]+$/

function hashTurnId(turnId: string) {
  let hash = 0
  for (const char of turnId)
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

export function shouldConsiderCharacterSticker(turnId: string, frequency: number) {
  return hashTurnId(turnId) % 100 < frequency
}

export function parseCharacterStickerChoice(text: string, candidates: readonly CharacterSticker[]) {
  const id = text.trim().toLowerCase()
  return STICKER_ID.test(id) ? candidates.find(item => item.id === id) : undefined
}

export function parseCharacterStickerDecision(text: string, candidates: readonly CharacterSticker[], maxParagraphIndex = 0) {
  const [id, placement, extra] = text.trim().toLowerCase().split('|')
  const paragraphIndex = /^paragraph:(\d+)$/.exec(placement ?? '')?.[1]
  if (extra || (placement && placement !== 'before' && placement !== 'after' && (!paragraphIndex || Number(paragraphIndex) < 1 || Number(paragraphIndex) > maxParagraphIndex)))
    return undefined
  const sticker = parseCharacterStickerChoice(id ?? '', candidates)
  if (!sticker)
    return undefined
  return paragraphIndex
    ? { sticker, placement: 'paragraph' as const, paragraphIndex: Number(paragraphIndex) }
    : { sticker, placement: placement === 'before' ? 'before' as const : 'after' as const }
}

export async function selectCharacterSticker(input: {
  characterId: string
  turnId: string
  userText: string
  assistantText: string
  placementText?: string
  chatProvider: ChatProvider
  model: string
  headers?: Record<string, string>
  sourceSurface: string
  characterName?: string
}) {
  const localLibrary = await loadAppStickerLibrary(input.characterId)
  const useLocal = localLibrary.stickers.length > 0
  const path = `/api/qq/characters/${encodeURIComponent(input.characterId)}/stickers`
  let library: CharacterStickerLibrary = localLibrary
  if (!useLocal) {
    const listResponse = await getOfficialApiFetch()(`${SERVER_URL}${path}`, { credentials: 'include' })
    if (!listResponse.ok)
      return undefined
    library = await listResponse.json() as CharacterStickerLibrary
  }
  if (!library.stickers.length || !shouldConsiderCharacterSticker(input.turnId, library.stickerFrequency))
    return undefined

  // Rotate the prompt window so stickers beyond the first twelve remain usable.
  const start = hashTurnId(input.turnId) % library.stickers.length
  const candidates = [...library.stickers.slice(start), ...library.stickers.slice(0, start)].slice(0, 12)
  const placementText = (input.placementText ?? input.assistantText).slice(0, 500)
  const maxParagraphIndex = Math.max(0, placementText.split(/\n\s*\n/).length - 1)
  const chatConfig = input.chatProvider.chat(input.model)
  const requestTrace = createChatTraceRequest({
    characterName: input.characterName,
    sourceSurface: input.sourceSurface,
    turnId: input.turnId,
  }, 'sticker-selection')
  const response = await generateText({
    ...chatConfig,
    headers: createChatTraceHeaders(input.headers ?? chatConfig.headers, requestTrace),
    messages: [
      {
        role: 'system',
        content: `你是角色的表情包选择器。根据用户消息、角色回复和素材描述，决定是否发送一张表情包。只在自然贴合语境时发送。输出 NONE，或精确输出 素材ID|before、素材ID|after${maxParagraphIndex ? `、素材ID|paragraph:N（N 为 1 到 ${maxParagraphIndex}，表示放在最后一条回复的第 N 段之后）` : ''}。由你根据语境选择插入位置，不要解释。`,
      },
      {
        role: 'user',
        content: `用户：${input.userText.slice(0, 500)}\n角色：${input.assistantText.slice(0, 500)}${maxParagraphIndex ? `\n最后一条回复可插入段落：${placementText}` : ''}\n可用素材：\n${candidates.map(item => `${item.id} ${item.description}${item.emotionTags?.length ? `；情绪：${item.emotionTags.join('、')}` : ''}${item.seriesTag ? `；系列：${item.seriesTag}` : ''}${item.favorite ? '；偏爱' : ''}；已用${item.useCount}次`).join('\n')}`,
      },
    ],
    maxSteps: 1,
    max_tokens: 90,
    temperature: 0.2,
  })
  const selected = parseCharacterStickerDecision(response.text ?? '', candidates, maxParagraphIndex)
  if (!selected)
    return undefined
  if (useLocal) {
    const imageData = selected.sticker.imageData
    return imageData?.startsWith('data:image/')
      ? { id: selected.sticker.id, imageData, placement: selected.placement, ...('paragraphIndex' in selected ? { paragraphIndex: selected.paragraphIndex } : {}) }
      : undefined
  }
  const imageResponse = await getOfficialApiFetch()(`${SERVER_URL}${path}/${selected.sticker.id}`, { credentials: 'include' })
  if (!imageResponse.ok)
    return undefined
  const image = await imageResponse.json() as { imageData?: string }
  return image.imageData && (image.imageData.startsWith('data:image/') || QQ_STICKER_CDN_URL.test(image.imageData))
    ? { id: selected.sticker.id, imageData: image.imageData, placement: selected.placement, ...('paragraphIndex' in selected ? { paragraphIndex: selected.paragraphIndex } : {}) }
    : undefined
}

export async function recordCharacterStickerUse(characterId: string, assetId: string) {
  const library = await loadAppStickerLibrary(characterId)
  const local = library.stickers.find(item => item.id === assetId)
  if (local) {
    await updateAppSticker(characterId, assetId, { useCount: local.useCount + 1 })
    return
  }
  await getOfficialApiFetch()(`${SERVER_URL}/api/qq/characters/${encodeURIComponent(characterId)}/stickers/${assetId}/use`, {
    method: 'POST',
    credentials: 'include',
  })
}
