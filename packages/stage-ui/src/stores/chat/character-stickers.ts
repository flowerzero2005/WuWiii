import type { ChatProvider } from '@xsai-ext/providers/utils'

import { generateText } from '@xsai/generate-text'

import { getOfficialApiFetch, SERVER_URL } from '../../libs/auth'
import { createChatTraceHeaders, createChatTraceRequest } from './chat-diagnostics'

interface CharacterSticker {
  id: string
  description: string
  emotionTags: string[]
  seriesTag: string
  favorite: boolean
  useCount: number
}

interface CharacterStickerLibrary {
  stickers: CharacterSticker[]
  stickerFrequency: number
}

const STICKER_ID = /^[a-f0-9]{64}$/
const QQ_STICKER_CDN_URL = /^https:\/\/(?:p|gchat)\.qpic\.cn\/[\w%/.-]+$/

export function shouldConsiderCharacterSticker(turnId: string, frequency: number) {
  let hash = 0
  for (const char of turnId)
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 100 < frequency
}

export function parseCharacterStickerChoice(text: string, candidates: readonly CharacterSticker[]) {
  const id = text.trim().toLowerCase()
  return STICKER_ID.test(id) ? candidates.find(item => item.id === id) : undefined
}

export async function selectCharacterSticker(input: {
  characterId: string
  turnId: string
  userText: string
  assistantText: string
  chatProvider: ChatProvider
  model: string
  headers?: Record<string, string>
  sourceSurface: string
  characterName?: string
}) {
  const path = `/api/qq/characters/${encodeURIComponent(input.characterId)}/stickers`
  const listResponse = await getOfficialApiFetch()(`${SERVER_URL}${path}`, { credentials: 'include' })
  if (!listResponse.ok)
    return undefined
  const library = await listResponse.json() as CharacterStickerLibrary
  if (!library.stickers.length || !shouldConsiderCharacterSticker(input.turnId, library.stickerFrequency))
    return undefined

  const candidates = library.stickers.slice(0, 8)
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
      { role: 'system', content: '你是角色的表情包选择器。只在当前回复配图自然且有助于表达时选择一张。优先考虑角色偏爱的系列，但必须贴合语境。只输出已收藏素材的 64 位编号，或者 NONE。不要搜索新图片，也不要解释。' },
      { role: 'user', content: `用户：${input.userText.slice(0, 500)}\n角色：${input.assistantText.slice(0, 500)}\n可用素材：\n${candidates.map(item => `${item.id} ${item.description}${item.emotionTags?.length ? `；情绪：${item.emotionTags.join('、')}` : ''}${item.seriesTag ? `；系列：${item.seriesTag}` : ''}${item.favorite ? '；偏爱' : ''}；已用${item.useCount}次`).join('\n') || '暂无'}` },
    ],
    maxSteps: 1,
    max_tokens: 90,
    temperature: 0.2,
  })
  const selected = parseCharacterStickerChoice(response.text ?? '', candidates)
  if (!selected)
    return undefined
  const imageResponse = await getOfficialApiFetch()(`${SERVER_URL}${path}/${selected.id}`, { credentials: 'include' })
  if (!imageResponse.ok)
    return undefined
  const image = await imageResponse.json() as { imageData?: string }
  return image.imageData && (image.imageData.startsWith('data:image/') || QQ_STICKER_CDN_URL.test(image.imageData))
    ? { id: selected.id, imageData: image.imageData }
    : undefined
}

export async function recordCharacterStickerUse(characterId: string, assetId: string) {
  await getOfficialApiFetch()(`${SERVER_URL}/api/qq/characters/${encodeURIComponent(characterId)}/stickers/${assetId}/use`, {
    method: 'POST',
    credentials: 'include',
  })
}
