import { ChatSyncSchema, PublicCharacterCreateSchema } from '@proj-airi/server-shared/types'
import { safeParse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { parseCreateProviderConfigPayload, projectPublicCharacterCreatePayload } from './client-api-contract'
import { createApiClient } from './http-client'

describe('standalone client HTTP contract', () => {
  it('retains cookie credentials, query encoding and empty release response', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ release: null }))
    const client = createApiClient('https://fixtures.example.invalid', transport)
    const response = await client.api.releases.$get({ query: { channel: 'beta' } })
    const [url, init] = transport.mock.calls[0]!
    expect(String(url)).toBe('https://fixtures.example.invalid/api/releases?channel=beta')
    expect(init).toMatchObject({ credentials: 'include', method: 'GET' })
    expect(init?.headers).toBeInstanceOf(Headers)
    expect(await response.json()).toEqual({ release: null })
  })

  it('sends chat payloads accepted by the shared server schema', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }))
    const client = createApiClient('https://fixtures.example.invalid', transport)
    const payload = {
      chat: { id: 'fixture-chat', type: 'group' as const },
      members: [{ type: 'user' as const, userId: 'fixture-user' }],
      messages: [{ id: 'fixture-message', role: 'assistant' as const, content: '你好', createdAt: 100 }],
    }
    await client.api.chats.sync.$post({ json: payload })
    const [url, init] = transport.mock.calls[0]!
    expect(String(url)).toBe('https://fixtures.example.invalid/api/chats/sync')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual(payload)
    expect(safeParse(ChatSyncSchema, body).success).toBe(true)
    expect(safeParse(ChatSyncSchema, { ...body, messages: [{ ...body.messages[0], role: 'invalid' }] }).success).toBe(false)
  })

  it('keeps PATCH bodies and the provider path used by fetch', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    const client = createApiClient('https://fixtures.example.invalid', transport)
    const patch = { config: { model: 'fixture-model' }, validated: true, validationBypassed: false }
    await client.api.providers[':id'].$patch({ param: { id: 'fixture provider' }, json: patch })
    const [url, init] = transport.mock.calls[0]!
    expect(new URL(String(url)).href).toBe('https://fixtures.example.invalid/api/providers/fixture%20provider')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual(patch)
  })

  it('rejects provider config values the server route cannot accept', () => {
    expect(() => parseCreateProviderConfigPayload({
      definitionId: 'fixture',
      name: 'Fixture',
      config: { retries: 3 },
    })).toThrow()
  })

  it('projects character creates to the shared public schema without sending API keys', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}))
    const client = createApiClient('https://fixtures.example.invalid', transport)
    const payload = projectPublicCharacterCreatePayload({
      character: { characterId: 'fixture', coverUrl: 'https://example.invalid/cover.png', id: 'character-1', version: '1' },
      capabilities: [{
        type: 'llm',
        config: { apiBaseUrl: 'https://example.invalid/v1', apiKey: 'private-key', llm: { model: 'fixture', temperature: 0.4 } },
      }],
      avatarModels: [{ description: 'Fixture model', name: 'Fixture', type: 'live2d', config: { live2d: { urls: ['https://example.invalid/model.model3.json'] } } }],
      i18n: [{ description: 'Fixture description', language: 'en', name: 'Fixture', tags: ['fixture'] }],
      prompts: [{ content: 'Be useful.', language: 'en', type: 'system' }],
    })

    expect(safeParse(PublicCharacterCreateSchema, payload).success).toBe(true)
    await client.api.characters.$post({ json: payload })
    const [, init] = transport.mock.calls[0]!
    const body = JSON.parse(String(init?.body))
    expect(body.capabilities[0].config).not.toHaveProperty('apiKey')
    expect(JSON.stringify(body)).not.toContain('private-key')
  })
})
