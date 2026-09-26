import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive } from 'vue'

import { useGroupScriptJobs } from './use-group-script-jobs'

const mocks = vi.hoisted(() => ({
  consciousness: { activeProvider: 'custom', activeModel: 'model-a' },
  auth: { userId: 'account-a', isAuthenticated: true },
  meta: { roomScriptRevision: 1 },
  getProvider: vi.fn(),
  generate: vi.fn(),
  parse: vi.fn(),
  command: vi.fn(),
  consentRequired: false,
  resolve: vi.fn(),
}))

vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../stores/modules/consciousness', () => ({ useConsciousnessStore: () => mocks.consciousness }))
vi.mock('../stores/providers', () => ({ useProvidersStore: () => ({ getProviderConfig: () => ({ baseURL: 'https://configured.invalid' }), getProviderInstance: mocks.getProvider }) }))
vi.mock('../stores/settings/official-capability-consent', () => ({ useOfficialCapabilityConsentStore: () => ({ getQuote: () => ({ fingerprint: 'quote-a' }), getAcceptance: () => ({ quote: { fingerprint: 'quote-a' } }), needsConsent: () => mocks.consentRequired }) }))
vi.mock('../stores/chat/chat-diagnostics', () => ({ createChatTraceRequest: () => ({ requestId: 'request-a' }) }))
vi.mock('../stores/chat/session-store', () => ({ useChatSessionStore: () => ({
  getSessionMeta: () => mocks.meta,
  resolveGroupRoomScript: mocks.resolve,
  executeGroupScriptCommand: mocks.command,
  getSessionMessages: () => [{ id: 'user-a', role: 'user', content: 'We reached the gate.' }],
}) }))
vi.mock('../stores/chat/group-script-runtime', () => ({ generateGroupScriptResponse: mocks.generate, parseGroupScriptEvaluation: mocks.parse, parseGroupScriptSequelResponse: mocks.parse }))

const state = { progress: { revision: 0, currentActId: 'act-a', isComplete: false }, templateSnapshot: { acts: [{ actId: 'act-a', unlockConditions: [{ conditionId: 'condition-a' }] }] }, chapterSettings: { automaticEvaluationEnabled: true } }
const scopes: ReturnType<typeof effectScope>[] = []
function runner() {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useGroupScriptJobs('room-a'))!
}
const input = { sessionId: 'room-a', turnId: 'user-a', language: 'en' }

describe('chapter request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consciousness = reactive({ activeProvider: 'custom', activeModel: 'model-a' })
    mocks.auth = reactive({ userId: 'account-a', isAuthenticated: true })
    mocks.meta = reactive({ roomScriptRevision: 1 })
    mocks.consentRequired = false
    mocks.resolve.mockResolvedValue(state)
    mocks.getProvider.mockResolvedValue({ chat: () => ({ baseURL: 'https://configured.invalid' }) })
    mocks.generate.mockResolvedValue('{}')
    mocks.parse.mockReturnValue({ actId: 'act-a', conditions: [] })
    mocks.command.mockImplementation(async (_session, _revision, command) => {
      if (command.type !== 'fail')
        mocks.meta.roomScriptRevision += 1
      return state
    })
  })
  afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop())
    vi.useRealTimers()
  })

  it('requires official price consent before claiming or calling a provider', async () => {
    mocks.consciousness.activeProvider = 'official-cloud'
    mocks.consentRequired = true
    await expect(runner().run('evaluation', input)).rejects.toThrow('Confirm')
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.getProvider).not.toHaveBeenCalled()
  })

  it('cancels an account change during provider lookup and records one failed attempt', async () => {
    let resolveProvider!: (provider: unknown) => void
    mocks.getProvider.mockImplementation(() => new Promise(resolve => resolveProvider = resolve))
    const jobs = runner()
    const request = jobs.run('evaluation', input)
    await vi.waitFor(() => expect(mocks.getProvider).toHaveBeenCalledOnce())
    mocks.auth.userId = 'account-b'
    resolveProvider({ chat: () => ({}) })
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.command.mock.calls.map(call => call[2].type)).toEqual(['claim', 'fail'])
    expect(jobs.pending.value).toBe(false)
  })

  it('keeps the attempt marker when model JSON is malformed', async () => {
    mocks.parse.mockImplementation(() => {
      throw new Error('Invalid chapter evaluation.')
    })
    await expect(runner().run('evaluation', input)).rejects.toThrow('Invalid chapter')
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.command.mock.calls.map(call => call[2].type)).toEqual(['claim', 'fail'])
  })

  it('aborts a request at the deadline and blocks duplicate UI submissions', async () => {
    vi.useFakeTimers()
    mocks.generate.mockImplementation(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    const jobs = runner()
    const request = jobs.run('evaluation', input)
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    await jobs.run('evaluation', input)
    expect(mocks.generate).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(90_000)
    await rejection
    expect(mocks.command.mock.calls.map(call => call[2].type)).toEqual(['claim', 'fail'])
  })
})
