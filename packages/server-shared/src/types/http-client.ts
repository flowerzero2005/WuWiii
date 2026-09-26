import type { InferOutput } from 'valibot'

import { array, boolean, literal, number, object, optional, record, strictObject, string, union } from 'valibot'

/** Public request contract shared by the desktop client and chat sync route. */
export const ChatSyncMessageSchema = object({
  id: string(),
  role: union([literal('system'), literal('user'), literal('assistant'), literal('tool'), literal('error')]),
  content: string(),
  characterId: optional(string()),
  createdAt: optional(number()),
})

export const ChatSyncSchema = object({
  chat: object({
    id: string(),
    type: optional(union([literal('private'), literal('bot'), literal('group'), literal('channel')])),
    title: optional(string()),
    createdAt: optional(number()),
    updatedAt: optional(number()),
  }),
  members: optional(array(object({
    type: union([literal('user'), literal('character'), literal('bot')]),
    userId: optional(string()),
    characterId: optional(string()),
  }))),
  messages: array(ChatSyncMessageSchema),
})

export type ChatSyncPayload = InferOutput<typeof ChatSyncSchema>

/** Provider writes accepted by both the client transport and server route. */
export const CreateProviderConfigSchema = object({
  id: optional(string()),
  definitionId: string(),
  name: string(),
  config: optional(record(string(), string())),
  validated: optional(boolean()),
  validationBypassed: optional(boolean()),
})

export const UpdateProviderConfigSchema = object({
  name: optional(string()),
  config: optional(record(string(), string())),
  validated: optional(boolean()),
  validationBypassed: optional(boolean()),
})

export type CreateProviderConfigPayload = InferOutput<typeof CreateProviderConfigSchema>
export type UpdateProviderConfigPayload = InferOutput<typeof UpdateProviderConfigSchema>

const PublicCharacterCapabilityTypeSchema = union([
  literal('llm'),
  literal('tts'),
  literal('vlm'),
  literal('asr'),
])

const PublicAvatarModelTypeSchema = union([
  literal('vrm'),
  literal('live2d'),
])

const PublicPromptTypeSchema = union([
  literal('system'),
  literal('personality'),
  literal('greetings'),
])

export const PublicAvatarModelConfigSchema = object({
  vrm: optional(object({ urls: array(string()) })),
  live2d: optional(object({ urls: array(string()) })),
})

/** Public capability settings never carry a user's API key. */
export const PublicCharacterCapabilityConfigSchema = strictObject({
  apiBaseUrl: string(),
  llm: optional(object({ temperature: number(), model: string() })),
  tts: optional(object({ ssml: string(), voiceId: string(), speed: number(), pitch: number() })),
  vlm: optional(object({ image: string() })),
  asr: optional(object({ audio: string() })),
})

/** Public create fields supported by the current client character editor. */
export const PublicCharacterCreateSchema = object({
  character: strictObject({
    id: optional(string()),
    version: string(),
    coverUrl: string(),
    characterId: string(),
    avatarUrl: optional(string()),
    creatorRole: optional(string()),
    priceCredit: optional(string()),
  }),
  cover: optional(object({
    id: optional(string()),
    foregroundUrl: string(),
    backgroundUrl: string(),
  })),
  capabilities: optional(array(object({
    type: PublicCharacterCapabilityTypeSchema,
    config: PublicCharacterCapabilityConfigSchema,
  }))),
  avatarModels: optional(array(object({
    name: string(),
    type: PublicAvatarModelTypeSchema,
    description: string(),
    config: PublicAvatarModelConfigSchema,
  }))),
  i18n: optional(array(object({
    language: string(),
    name: string(),
    tagline: optional(string()),
    description: string(),
    tags: array(string()),
  }))),
  prompts: optional(array(object({
    language: string(),
    type: PublicPromptTypeSchema,
    content: string(),
  }))),
})

export const PublicCharacterUpdateSchema = strictObject({
  version: optional(string()),
  coverUrl: optional(string()),
  avatarUrl: optional(string()),
  creatorRole: optional(string()),
  priceCredit: optional(string()),
  characterId: optional(string()),
})

export type PublicCharacterCreatePayload = InferOutput<typeof PublicCharacterCreateSchema>
export type PublicCharacterUpdatePayload = InferOutput<typeof PublicCharacterUpdateSchema>

export interface PublicProductAnnouncement {
  body: string
  id: string
  level: 'critical' | 'info' | 'warning'
  title: string
  updatedAt: string
}

export interface PublicProductRelease {
  forceUpdate: boolean
  notes: string
  version: string
}

export interface ProviderCatalogRecord {
  id: string
  definitionId: string
  name: string
  config: unknown
  validated: boolean
  validationBypassed: boolean
}
