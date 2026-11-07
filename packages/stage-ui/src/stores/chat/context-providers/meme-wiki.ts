import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { getOfficialApiFetch, SERVER_URL } from '../../../libs/auth'

export const MEME_WIKI_CONTEXT_ID = 'system:meme-wiki'

export function createMemeWikiContextMessage(text = ''): ContextMessage {
  return {
    id: nanoid(),
    contextId: MEME_WIKI_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: Date.now(),
  }
}

export async function lookupMemeWikiContext(message: string, request: typeof fetch = getOfficialApiFetch()): Promise<ContextMessage> {
  if (!message.trim() || message.length > 500)
    return createMemeWikiContextMessage()
  try {
    const response = await request(`${SERVER_URL}/api/meme-wiki/lookup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message }),
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
