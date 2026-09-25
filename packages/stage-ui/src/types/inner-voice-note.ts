export interface AiriAssistantInnerVoiceNote {
  id: string
  messageId: string
  sessionId: string
  personaCardId: string
  userId: string
  text: string
  moodTags?: string[]
  createdAt: number
  updatedAt: number
  visibleByDefault: false
}

export type AiriAssistantInnerVoiceNoteDraft = Omit<
  AiriAssistantInnerVoiceNote,
  'id' | 'createdAt' | 'updatedAt' | 'visibleByDefault'
> & {
  id?: string
  createdAt?: number
  updatedAt?: number
  visibleByDefault?: false
}
