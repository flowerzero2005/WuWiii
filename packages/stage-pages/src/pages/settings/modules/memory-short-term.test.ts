import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatHistoryCleanupResult, ChatSessionRecord } from '@proj-airi/stage-ui/types/chat-session'
import type { Ref } from 'vue'

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileScript, parse } from 'vue/compiler-sfc'

import * as Vue from 'vue'

const source = readFileSync(new URL('./memory-short-term.vue', import.meta.url), 'utf8')
// Execute the real setup script with reactive stores, without launching a browser.
const compiled = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'memory-test' }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

interface PageState {
  viewSessionId: Ref<string>
  viewRoleId: Ref<string>
  inspectionMessages: Ref<ChatHistoryItem[]>
  messageRows: Ref<{ message: ChatHistoryItem, starred: boolean }[]>
  actionPending: Ref<boolean>
  feedbackMessage: Ref<string>
  feedbackTone: Ref<string>
  keepCount: Ref<number>
  clearTarget: Ref<{ starCount: number } | undefined>
  deleteTarget: Ref<{ starCount: number } | undefined>
  refreshInspection: () => Promise<boolean | undefined>
  toggleMessageStar: (id: string) => Promise<void>
  requestClearAll: () => void
  clearAll: () => Promise<void>
  keepRecent: () => Promise<void>
  requestConversationDeletion: () => void
  deleteInspectedConversation: () => Promise<void>
}

function record(sessionId = 'one', characterId = 'alice'): ChatSessionRecord {
  return {
    meta: { sessionId, characterId, userId: 'user', title: sessionId, createdAt: 1, updatedAt: 1, messageStarsRevision: 7 },
    messages: [
      { id: `${sessionId}-old`, role: 'user', content: 'older', createdAt: 10 },
      { id: `${sessionId}-star`, role: 'assistant', content: 'favorite', createdAt: 20, slices: [], tool_results: [] },
      { id: `${sessionId}-new`, role: 'user', content: 'newer', createdAt: 30 },
    ],
    messageStars: { [`${sessionId}-star`]: { starred: true, revision: 7 } },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach(dispose => dispose()))

async function createPage() {
  const records = new Map([['one', record()], ['two', record('two')], ['other-role', record('other-role', 'bob')]])
  const session = Vue.reactive({
    sessionUserId: 'user',
    catalogReady: true,
    activeSessionId: 'one',
    directSessions: Array.from(records.values(), item => item.meta),
    groupSessions: [] as ChatSessionRecord['meta'][],
    readSessionForInspection: vi.fn(async (id: string) => records.get(id)),
    initializeForInspection: vi.fn(async () => {}),
    setMessageStarred: vi.fn(async (_id: string, _messageId: string, _starred: boolean) => {}),
    cleanupMessages: vi.fn(async (): Promise<ChatHistoryCleanupResult> => ({ removedMessageIds: ['one-old'], retainedMessageIds: [] })),
    retainRecentMessages: vi.fn(async (): Promise<ChatHistoryCleanupResult> => ({ removedMessageIds: ['one-old'], retainedMessageIds: ['one-star', 'one-new'] })),
    deleteSession: vi.fn(async () => true),
    refreshFromPersistence: vi.fn(async () => {}),
  })
  const notes = {
    allNotes: [],
    getGenerationErrorForMessage: vi.fn(),
    isGeneratingNoteForMessage: vi.fn(),
    getNoteForMessage: vi.fn(),
    hydrateSessionNotes: vi.fn(async () => {}),
    deleteNoteForMessage: vi.fn(async () => true),
    deleteNotesForSession: vi.fn(async () => []),
  }
  const beforeUnmount: (() => void)[] = []
  const modules: Record<string, unknown> = {
    'vue': { ...Vue, onMounted: () => {}, onBeforeUnmount: (fn: () => void) => beforeUnmount.push(fn) },
    'vue-i18n': { useI18n: () => ({ locale: Vue.ref('en'), t: (key: string, params: unknown) => `${key}:${JSON.stringify(params)}` }) },
    'vue-router': { useRoute: () => ({ query: {} }) },
    '@proj-airi/stage-ui/composables/use-conversation-navigation': { useConversationNavigation: () => undefined },
    '@proj-airi/stage-ui/stores/chat/inner-voice-notes': { useAssistantInnerVoiceNoteStore: () => notes },
    '@proj-airi/stage-ui/stores/chat/session-store': { useChatSessionStore: () => session },
    '@proj-airi/stage-ui/stores/modules/airi-card': { useAiriCardStore: () => ({ cards: new Map([['alice', { name: 'Alice' }], ['bob', { name: 'Bob' }]]) }) },
    '@proj-airi/stage-ui/stores/settings/memory-short-term': { useMemoryShortTermSettingsStore: () => ({ settings: { autoCleanupEnabled: false, autoCleanupLimit: 100 }, setAutoCleanupLimit: vi.fn() }) },
    '@proj-airi/stage-ui/utils': { summarizeChatHistoryMessage: vi.fn() },
    '@proj-airi/ui': {},
  }
  const exports = { default: { setup: (_: unknown, __: unknown): PageState => ({} as PageState) } }
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (!(id in modules))
        throw new Error(`Unexpected import: ${id}`)
      return modules[id]
    },
    window: { removeEventListener: vi.fn() },
    document: { removeEventListener: vi.fn() },
    localStorage: { setItem: vi.fn() },
    console,
  })
  const scope = Vue.effectScope()
  const state = scope.run(() => exports.default.setup({}, { expose: () => {} }))!
  const unmount = () => {
    beforeUnmount.forEach(fn => fn())
    scope.stop()
  }
  disposers.push(unmount)
  await Vue.nextTick()
  await state.refreshInspection()
  return { state, session, notes, records, unmount }
}

describe('short-term memory favorites', () => {
  it('shows favorites first without mutating history, timestamps, or selection', async () => {
    const { state, records } = await createPage()
    expect(state.messageRows.value.map(row => row.message.id)).toEqual(['one-star', 'one-old', 'one-new'])
    expect(records.get('one')!.messages.map(item => item.id)).toEqual(['one-old', 'one-star', 'one-new'])
    expect(state.messageRows.value[0].message.createdAt).toBe(20)
    expect(state.viewSessionId.value).toBe('one')
    expect(state.viewRoleId.value).toBe('direct:alice')
  })

  it('waits for persistence, blocks duplicate clicks, and keeps favorites on failure', async () => {
    const { state, session } = await createPage()
    const save = deferred<void>()
    session.setMessageStarred.mockImplementationOnce(() => save.promise)
    const pending = state.toggleMessageStar('one-star')
    await state.toggleMessageStar('one-star')
    expect(session.setMessageStarred).toHaveBeenCalledTimes(1)
    expect(state.actionPending.value).toBe(true)
    expect(state.messageRows.value[0].starred).toBe(true)
    save.reject(new Error('disk full'))
    await pending
    expect(state.messageRows.value[0].starred).toBe(true)
    expect(state.feedbackTone.value).toBe('error')
    expect(state.feedbackMessage.value).toContain('favorites.failed')
    expect(state.actionPending.value).toBe(false)
  })

  it('unstars without deleting and restores original viewing order', async () => {
    const { state, session, records } = await createPage()
    session.setMessageStarred.mockImplementationOnce(async () => {
      records.get('one')!.messageStars!['one-star'] = { starred: false, revision: 8 }
    })
    await state.toggleMessageStar('one-star')
    expect(session.setMessageStarred).toHaveBeenCalledWith('one', 'one-star', false)
    expect(state.messageRows.value.map(row => row.message.id)).toEqual(['one-old', 'one-star', 'one-new'])
    expect(session.cleanupMessages).not.toHaveBeenCalled()
    expect(session.retainRecentMessages).not.toHaveBeenCalled()
  })

  it.each(['session', 'role', 'account', 'unmount'])('ignores a late star result after changing %s', async (change) => {
    const { state, session, unmount } = await createPage()
    const save = deferred<void>()
    session.setMessageStarred.mockImplementationOnce(() => save.promise)
    const pending = state.toggleMessageStar('one-old')
    if (change === 'session')
      state.viewSessionId.value = 'two'
    else if (change === 'role')
      state.viewRoleId.value = 'direct:bob'
    else if (change === 'account')
      session.sessionUserId = 'another-user'
    else
      unmount()
    await Vue.nextTick()
    const reads = session.readSessionForInspection.mock.calls.length
    save.reject(new Error('late failure'))
    await pending
    expect(state.feedbackMessage.value).toBe('')
    expect(session.readSessionForInspection).toHaveBeenCalledTimes(reads)
  })

  it('ignores an old inspection result after the account changes', async () => {
    const { state, session } = await createPage()
    const read = deferred<ChatSessionRecord>()
    session.readSessionForInspection.mockImplementationOnce(() => read.promise)
    const pending = state.refreshInspection()
    session.sessionUserId = 'another-user'
    session.readSessionForInspection.mockResolvedValue(undefined)
    await Vue.nextTick()
    read.resolve(record('stale'))
    await pending
    expect(state.inspectionMessages.value).toEqual([])
  })

  it('freezes favorite counts and revisions for explicit clear and conversation deletion', async () => {
    const { state, session } = await createPage()
    await state.clearAll()
    expect(session.cleanupMessages).not.toHaveBeenCalled()
    state.requestClearAll()
    expect(state.clearTarget.value?.starCount).toBe(1)
    await state.clearAll()
    expect(session.cleanupMessages).toHaveBeenCalledWith('one', { expectedMessageStarsRevision: 7 })
    state.requestConversationDeletion()
    expect(state.deleteTarget.value?.starCount).toBe(1)
    await state.deleteInspectedConversation()
    expect(session.deleteSession).toHaveBeenCalledWith('one', { expectedMessageStarsRevision: 7 })
  })

  it('requires another confirmation after a destructive write fails', async () => {
    const { state, session, notes } = await createPage()
    session.cleanupMessages.mockRejectedValueOnce(new Error('star revision changed'))
    state.requestClearAll()
    await state.clearAll()
    expect(state.feedbackTone.value).toBe('error')
    expect(state.clearTarget.value).toBeUndefined()
    expect(notes.deleteNotesForSession).not.toHaveBeenCalled()
    await state.clearAll()
    expect(session.cleanupMessages).toHaveBeenCalledTimes(1)
  })

  it('reports committed removal counts and delegates linked note cleanup to the store', async () => {
    const { state, session, notes } = await createPage()
    state.keepCount.value = 1
    await state.keepRecent()
    expect(session.retainRecentMessages).toHaveBeenCalledWith('one', 1)
    expect(state.feedbackMessage.value).toContain('"removed":1')
    expect(notes.deleteNoteForMessage).not.toHaveBeenCalled()
    expect(notes.deleteNotesForSession).not.toHaveBeenCalled()
  })

  it('reports partial note cleanup failure after message cleanup was committed', async () => {
    const { state, session } = await createPage()
    session.retainRecentMessages.mockResolvedValueOnce({ removedMessageIds: ['one-old'], retainedMessageIds: ['one-star'], innerVoiceCleanupFailed: true })
    await state.keepRecent()
    expect(state.feedbackTone.value).toBe('error')
    expect(state.feedbackMessage.value).toContain('manual-cleanup.notes-failed')
  })

  it('does not release a newer save when an old session save finishes', async () => {
    const { state, session } = await createPage()
    const oldSave = deferred<void>()
    const newSave = deferred<void>()
    session.setMessageStarred.mockImplementationOnce(() => oldSave.promise).mockImplementationOnce(() => newSave.promise)
    const first = state.toggleMessageStar('one-old')
    state.viewSessionId.value = 'two'
    await Vue.nextTick()
    await state.refreshInspection()
    const second = state.toggleMessageStar('two-old')
    oldSave.resolve()
    await first
    expect(state.actionPending.value).toBe(true)
    expect(state.feedbackMessage.value).toBe('')
    newSave.resolve()
    await second
    expect(state.actionPending.value).toBe(false)
  })
})
