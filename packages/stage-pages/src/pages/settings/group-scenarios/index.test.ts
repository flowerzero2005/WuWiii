import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('group script editor page contract', () => {
  it('keeps template drafts separate from room snapshots and persists through session APIs', () => {
    expect(source).toContain('const templateDraft = ref<GroupScriptTemplate>')
    expect(source).toContain('const roomScriptDraft = ref<GroupRoomScriptState>()')
    expect(source).toContain('createRoomScriptFromTemplate({')
    expect(source).toContain('roomScriptDraft.value.roleBindings = reassignRoomCast(')
    expect(source).toContain('chatSession.updateGroupRoomScript(')
    expect(source).toContain('chatSession.clearGroupRoomScript(')
    expect(source).toContain('const next = parseGroupRoomScriptState(')
    expect(source).not.toContain('structuredClone(draft)')
  })

  it('guards asynchronous room loading against a stale selection', () => {
    expect(source).toContain('const revision = ++roomLoadRevision')
    expect(source).toContain('revision !== roomLoadRevision || sessionId !== selectedRoomId.value')
  })

  it('opens a deep-linked room directly and reloads after session initialization', () => {
    expect(source).toContain('const requestedRoomId = computed(() =>')
    expect(source).toContain('requestedRoomId.value ? \'room\' : \'template\'')
    expect(source).toContain('watch(requestedRoomId, (roomId) =>')
    expect(source).toContain('await loadSelectedRoomScript()')
  })

  it('stores narration controls without exposing a client-side narration model call', () => {
    expect(source).toContain('narrationSettings.speech = {')
    expect(source).not.toMatch(/generateNarration|requestNarration|narrationProvider/)
  })

  it('renames the selected room through the persisted session API', () => {
    expect(source).toContain('const roomTitleDraft = ref(\'\')')
    expect(source).toContain('await chatSession.renameGroupSession(room.sessionId, title)')
    expect(source).toContain('@keydown.enter.prevent="saveRoomTitle"')
    expect(source).toContain('setStatus(renamed ? \'success\' : \'error\'')
  })

  it('uses localized route metadata and contains no hard-coded Chinese UI copy', () => {
    expect(source).toContain('titleKey: settings.pages.group-scripts.title')
    expect(source).toContain('descriptionKey: settings.pages.group-scripts.description')
    expect(source).not.toMatch(/[\u4E00-\u9FFF]/)
  })

  it('uses a Solar icon that exists in the bundled icon set', () => {
    expect(source).toContain('i-solar:clapperboard-play-bold-duotone')
    expect(source).not.toContain('i-solar:theatre-bold-duotone')
  })
})
