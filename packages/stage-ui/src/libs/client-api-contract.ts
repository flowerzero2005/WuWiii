import type { ChatSyncPayload, CreateProviderConfigPayload, ProviderCatalogRecord, PublicCharacterCreatePayload, PublicCharacterUpdatePayload, PublicProductAnnouncement, PublicProductRelease, UpdateProviderConfigPayload } from '@proj-airi/server-shared/types'
import type { Env, Hono } from 'hono'

import type { CreateCharacterPayload, UpdateCharacterPayload } from '../types/character'

import { CreateProviderConfigSchema, PublicCharacterCreateSchema, PublicCharacterUpdateSchema, UpdateProviderConfigSchema } from '@proj-airi/server-shared/types'
import { parse } from 'valibot'

// NOTICE: Hono's Client conditional needs an implicit index signature. Interfaces
// produce an unknown RPC client here; use aliases for endpoint descriptors.
// Verified in hono/dist/types/client/types.d.ts (Client and PathToChain).
// eslint-disable-next-line ts/consistent-type-definitions
type JsonEndpoint<Input, Output, Status extends 200 | 201 | 403 = 200> = {
  input: Input
  output: Output
  outputFormat: 'json'
  status: Status
}

// eslint-disable-next-line ts/consistent-type-definitions
type DeleteEndpoint = {
  input: { param: { id: string } }
  output: null
  outputFormat: 'text'
  status: 204
}

export function parseCreateProviderConfigPayload(value: unknown): CreateProviderConfigPayload {
  return parse(CreateProviderConfigSchema, value)
}

export function parseUpdateProviderConfigPayload(value: unknown): UpdateProviderConfigPayload {
  return parse(UpdateProviderConfigSchema, value)
}

/** Projects local character data to the public wire shape and excludes API keys. */
export function projectPublicCharacterCreatePayload(value: CreateCharacterPayload): PublicCharacterCreatePayload {
  return parse(PublicCharacterCreateSchema, {
    character: {
      id: value.character.id,
      version: value.character.version,
      coverUrl: value.character.coverUrl,
      characterId: value.character.characterId,
    },
    ...(value.capabilities && {
      capabilities: value.capabilities.map(capability => ({
        type: capability.type,
        config: {
          apiBaseUrl: capability.config.apiBaseUrl,
          ...(capability.config.llm && { llm: capability.config.llm }),
          ...(capability.config.tts && { tts: capability.config.tts }),
          ...(capability.config.vlm && { vlm: capability.config.vlm }),
          ...(capability.config.asr && { asr: capability.config.asr }),
        },
      })),
    }),
    ...(value.avatarModels && { avatarModels: value.avatarModels }),
    ...(value.i18n && { i18n: value.i18n }),
    ...(value.prompts && { prompts: value.prompts }),
  })
}

export function projectPublicCharacterUpdatePayload(value: UpdateCharacterPayload): PublicCharacterUpdatePayload {
  return parse(PublicCharacterUpdateSchema, {
    version: value.version,
    coverUrl: value.coverUrl,
    characterId: value.characterId,
  })
}

/** Only client-visible endpoints belong here; no server implementation is imported. */
export type ClientApi = Hono<Env, {
  '/api/announcements': {
    $get: JsonEndpoint<{ query: { locale?: string } }, { announcements: PublicProductAnnouncement[] }>
  }
  '/api/releases': {
    $get: JsonEndpoint<{ query: { channel?: string } }, { release: PublicProductRelease | null }>
  }
  '/api/chats/sync': {
    $post: JsonEndpoint<{ json: ChatSyncPayload }, unknown, 200 | 403>
  }
  '/api/providers': {
    $get: JsonEndpoint<Record<never, never>, ProviderCatalogRecord[]>
    $post: JsonEndpoint<{ json: CreateProviderConfigPayload }, ProviderCatalogRecord, 201>
  }
  '/api/providers/:id': {
    $get: JsonEndpoint<{ param: { id: string } }, ProviderCatalogRecord>
    $patch: JsonEndpoint<{ param: { id: string }, json: UpdateProviderConfigPayload }, ProviderCatalogRecord>
    $delete: DeleteEndpoint
  }
  '/api/characters': {
    $get: JsonEndpoint<{ query: { all: string } }, unknown[]>
    $post: JsonEndpoint<{ json: PublicCharacterCreatePayload }, unknown, 201>
  }
  '/api/characters/:id': {
    $get: JsonEndpoint<{ param: { id: string } }, unknown>
    $patch: JsonEndpoint<{ param: { id: string }, json: PublicCharacterUpdatePayload }, unknown>
    $delete: DeleteEndpoint
  }
  '/api/characters/:id/like': {
    $post: JsonEndpoint<{ param: { id: string } }, { liked: boolean }>
  }
  '/api/characters/:id/bookmark': {
    $post: JsonEndpoint<{ param: { id: string } }, { bookmarked: boolean }>
  }
}>
