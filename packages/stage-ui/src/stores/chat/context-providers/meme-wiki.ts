import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { getOfficialApiFetch, SERVER_URL } from '../../../libs/auth'

export const MEME_WIKI_CONTEXT_ID = 'system:meme-wiki'
export const MEME_WIKI_STYLE_CONTEXT_ID = 'system:meme-wiki-style'

export type MemeWikiIntensityBand = 'off' | 'very-low' | 'low' | 'medium' | 'high'

export function resolveMemeWikiIntensityBand(intensity: number): MemeWikiIntensityBand {
  if (intensity <= 0)
    return 'off'
  if (intensity <= 20)
    return 'very-low'
  if (intensity <= 45)
    return 'low'
  if (intensity <= 70)
    return 'medium'
  return 'high'
}

export function createMemeWikiContextMessage(text = ''): ContextMessage {
  return {
    id: nanoid(),
    contextId: MEME_WIKI_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}

export function createMemeWikiStyleContextMessage(intensity?: number): ContextMessage {
  const text = intensity === undefined
    ? ''
    : [
        '梗百科与玩梗风格设置：',
        (intensity <= 0
          ? '关闭主动玩梗。保持自然表达，不主动加入网络梗、流行语或熟人式调侃。'
          : resolveMemeWikiIntensityBand(intensity) === 'very-low'
            ? '很低（1–20）。只在语境非常明确时轻轻带过网络梗；不接黑称，不为了玩梗改变回答重点。'
            : resolveMemeWikiIntensityBand(intensity) === 'low'
              ? '偏低（21–45）。可以接住明确的网络梗和轻微损操作，但不要损长相，不要主动把每句话都改成梗。'
              : resolveMemeWikiIntensityBand(intensity) === 'medium'
                ? '中等（46–70）。不必等对方先抛梗；普通聊天遇到贴切场景时，主动用一句熟悉的网络梗或流行语接话，再把正事说清楚。对方抛梗时先接一句，不深挖来源或追问含义；70 档应明显比普通聊天更会玩梗，但不要连续刷梗。'
                : '很高（71–100）。更主动、更频繁地使用网络梗、流行语、梗句和熟人式调侃，即使对方没有先说出同一个梗也可以自然带入；对方抛梗时先接话，不深挖或追问来历。仍要服从用户意图和严肃语境。'),
        '梗是说话风格的一部分。已命中的词条只提供接法，不等于要解释；对方没有明确求科普时，别把玩笑变成查出处、问背景或采访对方。',
      ].join('\n')

  return {
    id: nanoid(),
    contextId: MEME_WIKI_STYLE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}

export async function lookupMemeWikiContext(message: string, request: typeof fetch = getOfficialApiFetch(), intensity = 50): Promise<ContextMessage> {
  if (!message.trim() || message.length > 500)
    return createMemeWikiContextMessage()
  try {
    const response = await request(`${SERVER_URL}/api/meme-wiki/lookup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message, intensity }),
    })
    if (!response.ok)
      return createMemeWikiContextMessage()
    const body = await response.json() as { context?: unknown }
    return createMemeWikiContextMessage(typeof body.context === 'string' ? body.context : '')
  }
  catch {
    return createMemeWikiContextMessage()
  }
}
