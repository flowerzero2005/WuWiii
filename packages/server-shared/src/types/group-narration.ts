export interface GroupNarrationPublicEntry {
  kind: 'narration' | 'speaker'
  speakerName?: string
  text: string
}

export interface GroupNarrationScriptContext {
  background?: string
  currentScene?: string
  premise?: string
  relationships: Array<{
    description?: string
    direction: 'from-current' | 'to-current'
    otherMemberName: string
  }>
  role: {
    description?: string
    name: string
  }
  rules: string[]
  title: string
}

export interface GroupNarrationRequest {
  groupTurnId: string
  locale?: string
  priorPublicEntries: GroupNarrationPublicEntry[]
  protocolVersion: 1
  roomMembers: Array<{
    characterId: string
    displayName: string
    roleDescription?: string
    roleName?: string
  }>
  /** Frozen room label used only for the user's usage history. */
  roomName?: string
  roomRelationships: Array<{
    description?: string
    fromCharacterId: string
    fromMemberName: string
    toCharacterId: string
    toMemberName: string
  }>
  scriptContext?: GroupNarrationScriptContext
  sessionId: string
  speakerCharacterId: string
  speakerName: string
  speakerText: string
  speakerTurnId: string
  styleDescription?: string
  userText: string
}

export interface GroupNarrationResponse {
  after?: string
  before?: string
  protocolVersion: 1
  requestId: string
  skipped: boolean
  usageEventId: string
}
