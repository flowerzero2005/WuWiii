import type { ComposerSnapshot } from '../../shared/detached-composer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive } from 'vue'

import { composerChanged, composerDetach, composerExecute, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerViewRecovery } from '../../shared/detached-composer-events'
import { useDetachedComposerSource } from './use-detached-composer'

const mocks = vi.hoisted(() => ({ handlers: new Map<unknown, (event: { body: ComposerSnapshot }) => void>(), invokes: new Map<unknown, ReturnType<typeof vi.fn>>() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ({ value: { on: (event: unknown, handler: (event: { body: ComposerSnapshot }) => void) => {
    mocks.handlers.set(event, handler)
    return () => mocks.handlers.delete(event)
  } } }),
  useElectronEventaInvoke: (event: unknown) => mocks.invokes.get(event),
}))
const scopes: ReturnType<typeof effectScope>[] = []
function source(send = vi.fn(async () => ({ consumed: true, draft: { text: '', images: [] } }))) {
  const scope = effectScope()
  scopes.push(scope)
  const input = reactive({ sessionId: 'room-a', userScope: 'account-a', busy: false, draft: { text: 'Original draft.', images: [] } })
  const applyDraft = vi.fn(draft => input.draft = draft)
  const composer = scope.run(() => useDetachedComposerSource({ sessionId: () => input.sessionId, userScope: () => input.userScope, surface: 'page', group: () => false, busy: () => input.busy, draft: () => input.draft, applyDraft, send }))!
  return { composer, input, applyDraft, send, scope }
}
function emit(event: unknown, body: ComposerSnapshot) {
  mocks.handlers.get(event)!({ body })
}
function submitted(): ComposerSnapshot {
  const request = mocks.invokes.get(composerDetach)!.mock.calls[0][0]
  return { scope: { ...request, sourceWebContentsId: 1, leaseId: 'lease-a' }, version: 0, status: 'detached', busy: true, commandId: 'command-a', draft: request.draft }
}

describe('source composer lifecycle', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.invokes.clear()
    for (const event of [composerDetach, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerViewRecovery])
      mocks.invokes.set(event, vi.fn(async () => undefined))
    mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: false, uncertain: false })
    mocks.invokes.get(composerDetach)!.mockImplementation(async input => ({ scope: { ...input, sourceWebContentsId: 1, leaseId: 'lease-a' }, version: 0, status: 'detached', busy: false, draft: input.draft }))
  })
  afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

  it('calls the existing source send once and keeps a successful receipt through an acknowledgement failure', async () => {
    const item = source()
    await item.composer.detach()
    mocks.invokes.get(composerSettle)!.mockRejectedValueOnce(new Error('Transport disconnected.'))
    const command = submitted()
    emit(composerChanged, command)
    emit(composerExecute, command)
    emit(composerExecute, command)
    await vi.waitFor(() => expect(mocks.invokes.get(composerSettle)).toHaveBeenCalledTimes(2))
    expect(item.send).toHaveBeenCalledOnce()
    expect(mocks.invokes.get(composerSettle)!.mock.calls.every(call => call[0].consumed === true)).toBe(true)
    expect(mocks.invokes.get(composerInvalidate)).toHaveBeenCalled()
  })

  it('quarantines a thrown send rather than declaring it unconsumed', async () => {
    const send = vi.fn(async () => {
      throw new Error('Unknown send outcome.')
    })
    const item = source(send)
    await item.composer.detach()
    const command = submitted()
    emit(composerChanged, command)
    emit(composerExecute, command)
    await vi.waitFor(() => expect(mocks.invokes.get(composerInvalidate)).toHaveBeenCalled())
    expect(mocks.invokes.get(composerSettle)).not.toHaveBeenCalled()
  })

  it('refuses to call the pipeline when the source is already busy', async () => {
    const item = source()
    await item.composer.detach()
    item.input.busy = true
    const command = submitted()
    emit(composerChanged, command)
    emit(composerExecute, command)
    await vi.waitFor(() => expect(mocks.invokes.get(composerSettle)).toHaveBeenCalled())
    expect(item.send).not.toHaveBeenCalled()
    expect(mocks.invokes.get(composerSettle)!.mock.calls[0][0].consumed).toBe(false)
  })

  it('reports the old lease outcome after a session switch without injecting its draft into the new session', async () => {
    let finish!: (result: { consumed: boolean, draft: { text: string, images: never[] } }) => void
    const send = vi.fn(() => new Promise<{ consumed: boolean, draft: { text: string, images: never[] } }>(resolve => finish = resolve))
    const item = source(send)
    await item.composer.detach()
    const command = submitted()
    emit(composerChanged, command)
    emit(composerExecute, command)
    item.input.sessionId = 'room-b'
    item.input.draft = { text: 'New room draft.', images: [] }
    finish({ consumed: true, draft: { text: '', images: [] } })
    await vi.waitFor(() => expect(mocks.invokes.get(composerSettle)).toHaveBeenCalled())
    emit(composerChanged, { ...command, version: 1, busy: false, draft: { text: '', images: [] } })
    expect(item.input.draft.text).toBe('New room draft.')
    expect(mocks.invokes.get(composerSettle)!.mock.calls[0][0].leaseId).toBe('lease-a')
  })

  it('keeps an uncertain returned source read only and ignores its late active snapshot', async () => {
    const item = source()
    await item.composer.detach()
    const command = submitted()
    emit(composerChanged, { ...command, status: 'returned', busy: false, uncertain: true })
    emit(composerChanged, command)
    expect(item.composer.readonly.value).toBe(true)
    item.scope.stop()
    expect(mocks.handlers.has(composerExecute)).toBe(false)
    expect(mocks.invokes.get(composerInvalidate)).toHaveBeenCalled()
  })

  it('clears only the mirrored old scope draft and ignores its terminal receipt after returning to that session', async () => {
    const item = source()
    await item.composer.detach()
    const command = submitted()
    item.input.sessionId = 'room-b'
    expect(item.input.draft.text).toBe('')
    item.input.sessionId = 'room-a'
    item.input.draft = { text: 'New draft in the original room.', images: [] }
    emit(composerChanged, { ...command, version: 1, status: 'returned', busy: false, draft: { text: '', images: [] } })
    expect(item.input.draft.text).toBe('New draft in the original room.')
    expect(item.composer.readonly.value).toBe(false)
  })

  it('preserves a newer local draft while invalidating the detached account scope', async () => {
    const item = source()
    await item.composer.detach()
    item.input.draft = { text: 'Newer local draft.', images: [] }
    item.input.userScope = 'account-b'
    expect(item.input.draft.text).toBe('Newer local draft.')
  })
})
