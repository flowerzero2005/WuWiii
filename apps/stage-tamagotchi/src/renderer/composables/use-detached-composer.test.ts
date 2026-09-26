import type { ComposerSnapshot } from '../../shared/detached-composer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive } from 'vue'

import { composerChanged, composerDetach, composerDragDetach, composerExecute, composerFlushSource, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceSubmit, composerViewRecovery } from '../../shared/detached-composer-events'
import { useDetachedComposerSource } from './use-detached-composer'

const mocks = vi.hoisted(() => ({ handlers: new Map<unknown, (event: { body: unknown }) => void>(), invokes: new Map<unknown, ReturnType<typeof vi.fn>>() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ({ value: { on: (event: unknown, handler: (event: { body: unknown }) => void) => {
    mocks.handlers.set(event, handler)
    return () => mocks.handlers.delete(event)
  } } }),
  useElectronEventaInvoke: (event: unknown) => mocks.invokes.get(event),
}))
const scopes: ReturnType<typeof effectScope>[] = []
function source(send = vi.fn(async () => ({ consumed: true, draft: { text: '', images: [] } })), draftText = 'Original draft.', surface: 'page' | 'widget' = 'page') {
  const scope = effectScope()
  scopes.push(scope)
  const input = reactive({ sessionId: 'room-a', userScope: 'account-a', busy: false, draft: { text: draftText, images: [] } })
  const applyDraft = vi.fn(draft => input.draft = draft)
  const composer = scope.run(() => useDetachedComposerSource({ sessionId: () => input.sessionId, userScope: () => input.userScope, surface, group: () => false, busy: () => input.busy, draft: () => input.draft, applyDraft, send }))!
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
    for (const event of [composerDetach, composerDragDetach, composerInvalidate, composerRecovery, composerRequestReturn, composerSettle, composerViewRecovery, composerSourceCheckpoint, composerSourceRead, composerSourceRegion, composerSourceCloseAck, composerSourceSubmit])
      mocks.invokes.set(event, vi.fn(async () => undefined))
    mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: false, uncertain: false })
    mocks.invokes.get(composerSourceRead)!.mockResolvedValue({ version: 0, uncertain: false })
    mocks.invokes.get(composerSourceCheckpoint)!.mockImplementation(async input => ({ version: input.version + 1 }))
    mocks.invokes.get(composerDetach)!.mockImplementation(async input => ({ scope: { ...input, sourceWebContentsId: 1, leaseId: 'lease-a' }, version: 0, status: 'detached', busy: false, draft: input.draft }))
    mocks.invokes.get(composerDragDetach)!.mockImplementation(async input => ({ scope: { ...input, sourceWebContentsId: 1, leaseId: 'lease-a' }, version: 0, status: 'detached', busy: false, draft: input.draft }))
    mocks.invokes.get(composerSourceSubmit)!.mockImplementation(async input => ({ scope: { ...input, sourceWebContentsId: 1, leaseId: 'inline-lease' }, version: input.version, commandId: input.commandId, busy: true, uncertain: true, status: 'orphaned', draft: input.draft }))
    mocks.invokes.get(composerSettle)!.mockImplementation(async input => ({ scope: { userScope: 'account-a', sessionId: 'room-a', surface: 'page', sourceGeneration: 'source-a', sourceWebContentsId: 1, leaseId: input.leaseId, group: false }, version: input.version + 1, status: 'orphaned', busy: false, uncertain: false, draft: input.consumed ? { text: '', images: [] } : input.draft }))
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

  it('uses the same verified drag detach request for a quick-chat source', async () => {
    const item = source(undefined, 'Quick chat draft.', 'widget')

    await item.composer.detach(false, { x: 720, y: 640 })

    expect(mocks.invokes.get(composerDragDetach)).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'widget',
      point: { x: 720, y: 640 },
      draft: { text: 'Quick chat draft.', images: [] },
    }))
  })

  it('does not wait for a stale checkpoint before verifying a drag detach', async () => {
    const item = source(undefined, 'Latest draft.')
    let rejectCheckpoint!: (error: Error) => void
    mocks.invokes.get(composerSourceCheckpoint)!.mockImplementationOnce(() => new Promise((_, reject) => rejectCheckpoint = reject))

    const checkpoint = item.composer.checkpoint()
    await vi.waitFor(() => expect(mocks.invokes.get(composerSourceCheckpoint)).toHaveBeenCalledOnce())
    const detaching = item.composer.detach(false, { x: 720, y: 640 })
    await vi.waitFor(() => expect(mocks.invokes.get(composerDragDetach)).toHaveBeenCalledOnce())
    expect(mocks.invokes.get(composerDragDetach)!.mock.calls[0][0]).toMatchObject({
      point: { x: 720, y: 640 },
      draft: { text: 'Latest draft.', images: [] },
    })

    rejectCheckpoint(new Error('The detached editor owns this draft.'))
    await expect(checkpoint).rejects.toThrow('The detached editor owns this draft.')
    await detaching
    expect(item.composer.detached.value).toBe(true)
    expect(item.composer.checkpointFailed.value).toBe(false)
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
    await vi.waitFor(() => expect(item.composer.readonly.value).toBe(false))
  })

  it('preserves a newer local draft while invalidating the detached account scope', async () => {
    const item = source()
    await item.composer.detach()
    item.input.draft = { text: 'Newer local draft.', images: [] }
    item.input.userScope = 'account-b'
    expect(item.input.draft.text).toBe('Newer local draft.')
  })

  it('hydrates a saved inline draft after restart without sending it', async () => {
    mocks.invokes.get(composerSourceRead)!.mockResolvedValue({ version: 4, uncertain: false, draft: { text: 'Restart draft.', images: [] } })
    const item = source(undefined, '')
    await vi.waitFor(() => expect(item.input.draft.text).toBe('Restart draft.'))
    expect(item.send).not.toHaveBeenCalled()
    item.input.draft.text = 'Updated restart draft.'
    await item.composer.checkpoint()
    expect(mocks.invokes.get(composerSourceCheckpoint)!.mock.calls.at(-1)![0]).toMatchObject({ version: 4, userScope: 'account-a', sessionId: 'room-a', draft: { text: 'Updated restart draft.' } })
  })

  it('keeps text typed while hydration is pending and checkpoints it against the loaded version', async () => {
    let acknowledge!: (value: unknown) => void
    mocks.invokes.get(composerSourceRead)!.mockImplementationOnce(() => new Promise(resolve => acknowledge = resolve))
    const item = source(undefined, '')
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    item.input.draft.text = 'New input before hydration finishes.'
    acknowledge({ version: 7, uncertain: false, draft: { text: 'Old saved draft.', images: [] } })
    await item.composer.checkpoint()
    expect(item.input.draft.text).toBe('New input before hydration finishes.')
    expect(mocks.invokes.get(composerSourceCheckpoint)!.mock.calls.at(-1)![0]).toMatchObject({ version: 7, draft: { text: 'New input before hydration finishes.' } })
  })

  it('restores A to B to A drafts without overwriting newly edited current text', async () => {
    const saved = new Map([['room-a', { version: 2, uncertain: false, draft: { text: 'Saved A.', images: [] } }]])
    mocks.invokes.get(composerSourceRead)!.mockImplementation(async input => saved.get(input.sessionId) ?? { version: 0, uncertain: false })
    mocks.invokes.get(composerSourceCheckpoint)!.mockImplementation(async (input) => {
      saved.set(input.sessionId, { version: input.version + 1, uncertain: false, draft: structuredClone(input.draft) })
      return { version: input.version + 1 }
    })
    const item = source(undefined, '')
    await vi.waitFor(() => expect(item.input.draft.text).toBe('Saved A.'))
    item.input.sessionId = 'room-b'
    await vi.waitFor(() => expect(item.composer.readonly.value).toBe(false))
    expect(item.input.draft.text).toBe('')
    item.input.draft.text = 'Saved B.'
    await item.composer.checkpoint()
    item.input.sessionId = 'room-a'
    item.input.draft.text = 'New A before restore.'
    await item.composer.checkpoint()
    expect(item.input.draft.text).toBe('New A before restore.')
    expect(saved.get('room-b')!.draft.text).toBe('Saved B.')
    expect(saved.get('room-a')!.draft.text).toBe('New A before restore.')
  })

  it('keeps the source open until the latest character is persisted and then acknowledges its current generation', async () => {
    const item = source()
    await item.composer.checkpoint()
    item.input.draft.text = 'Last source character!'
    let acknowledge!: (value: unknown) => void
    mocks.invokes.get(composerSourceCheckpoint)!.mockImplementationOnce(() => new Promise(resolve => acknowledge = resolve))
    const scope = mocks.invokes.get(composerSourceRead)!.mock.calls[0][0]
    mocks.handlers.get(composerFlushSource)!({ body: { sourceGeneration: scope.sourceGeneration } })
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    expect(mocks.invokes.get(composerSourceCloseAck)).not.toHaveBeenCalled()
    expect(mocks.invokes.get(composerSourceCheckpoint)!.mock.calls.at(-1)![0].draft.text).toBe('Last source character!')
    acknowledge({ version: 2 })
    await vi.waitFor(() => expect(mocks.invokes.get(composerSourceCloseAck)).toHaveBeenCalledWith({ sourceGeneration: scope.sourceGeneration }))
  })

  it('keeps unknown recovered outcomes read only without importing or replaying them', async () => {
    mocks.invokes.get(composerSourceRead)!.mockResolvedValue({ version: 4, uncertain: true, draft: { text: 'May already be sent.', images: [] } })
    mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: true, uncertain: true })
    const item = source(undefined, '')
    await vi.waitFor(() => expect(item.composer.recoveryUncertain.value).toBe(true))
    await item.composer.detach()
    await item.composer.checkpoint()
    expect(item.composer.readonly.value).toBe(true)
    expect(item.input.draft.text).toBe('')
    expect(item.send).not.toHaveBeenCalled()
    expect(mocks.invokes.get(composerDetach)).not.toHaveBeenCalled()
    expect(mocks.invokes.get(composerSourceCheckpoint)).not.toHaveBeenCalled()
  })

  it('retains unsaved text when checkpoint fails and allows an explicit retry', async () => {
    const item = source()
    await item.composer.checkpoint()
    item.input.draft.text = 'Keep this draft after disk failure.'
    mocks.invokes.get(composerSourceCheckpoint)!.mockRejectedValueOnce(new Error('capacity full'))
    await expect(item.composer.checkpoint()).rejects.toThrow('capacity full')
    expect(item.composer.checkpointFailed.value).toBe(true)
    expect(item.input.draft.text).toBe('Keep this draft after disk failure.')
    await item.composer.checkpoint()
    expect(item.composer.checkpointFailed.value).toBe(false)
  })

  it('waits for the inline durable command before calling the pipeline and retries only a proven receipt', async () => {
    const item = source()
    let acknowledge!: (value: ComposerSnapshot) => void
    mocks.invokes.get(composerSourceSubmit)!.mockImplementationOnce(() => new Promise(resolve => acknowledge = resolve))
    const sending = item.composer.sendInline()
    const repeated = item.composer.sendInline()
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    expect(item.send).not.toHaveBeenCalled()
    const command = mocks.invokes.get(composerSourceSubmit)!.mock.calls[0][0]
    mocks.invokes.get(composerSettle)!.mockRejectedValueOnce(new Error('lost receipt ACK'))
    acknowledge({ scope: { ...command, leaseId: 'inline-lease', sourceWebContentsId: 1 }, version: command.version, commandId: command.commandId, status: 'orphaned', busy: true, uncertain: true, draft: command.draft })
    await Promise.all([sending, repeated])
    expect(item.send).toHaveBeenCalledOnce()
    expect(mocks.invokes.get(composerSourceSubmit)).toHaveBeenCalledOnce()
    expect(mocks.invokes.get(composerSettle)).toHaveBeenCalledTimes(2)
    expect(mocks.invokes.get(composerSettle)!.mock.calls[0][0]).toEqual(mocks.invokes.get(composerSettle)!.mock.calls[1][0])
  })

  it('preserves an unconsumed inline draft and quarantines a thrown pipeline without replay', async () => {
    const unconsumed = source(vi.fn(async () => ({ consumed: false, draft: { text: 'Original draft.', images: [] } })))
    await unconsumed.composer.sendInline()
    expect(unconsumed.input.draft.text).toBe('Original draft.')
    expect(unconsumed.composer.recoveryUncertain.value).toBe(false)
    unconsumed.scope.stop()
    const unknown = source(vi.fn(async () => {
      throw new Error('no proven receipt')
    }))
    await unknown.composer.sendInline()
    await unknown.composer.sendInline()
    expect(unknown.send).toHaveBeenCalledOnce()
    expect(unknown.composer.readonly.value).toBe(true)
    expect(unknown.input.draft.text).toBe('Original draft.')
  })

  it('retains an editable draft after main proves that a failed begin did not commit', async () => {
    const item = source()
    mocks.invokes.get(composerSourceSubmit)!.mockRejectedValueOnce(new Error('disk full'))
    mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: true, uncertain: false })
    await item.composer.sendInline()
    expect(item.send).not.toHaveBeenCalled()
    expect(item.composer.readonly.value).toBe(false)
    expect(item.composer.failed.value).toBe(true)
    expect(item.input.draft.text).toBe('Original draft.')
    expect(mocks.invokes.get(composerSourceSubmit)).toHaveBeenCalledOnce()
  })

  it('quarantines a lost begin acknowledgement when main confirms a durable uncertainty marker', async () => {
    const item = source()
    await item.composer.checkpoint()
    mocks.invokes.get(composerSourceSubmit)!.mockRejectedValueOnce(new Error('lost ACK'))
    mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: true, uncertain: true })
    await item.composer.sendInline()
    await item.composer.sendInline()
    expect(item.send).not.toHaveBeenCalled()
    expect(item.composer.readonly.value).toBe(true)
    expect(item.input.draft.text).toBe('Original draft.')
    expect(mocks.invokes.get(composerSourceSubmit)).toHaveBeenCalledOnce()
  })

  it.each([true, false])('recovers the confirmed consumed=%s terminal state after both settle acknowledgements are lost', async (consumed) => {
    const item = source()
    await item.composer.checkpoint()
    item.send.mockImplementation(async () => {
      if (consumed)
        item.input.draft = { text: '', images: [] }
      return { consumed, draft: { text: consumed ? '' : 'Original draft.', images: [] } }
    })
    mocks.invokes.get(composerSettle)!.mockImplementation(async (receipt) => {
      mocks.invokes.get(composerRecovery)!.mockResolvedValue({ exists: !consumed, uncertain: false, version: receipt.version + 1, draft: consumed ? undefined : receipt.draft })
      if (consumed)
        item.input.draft.text = 'New local text after send.'
      throw new Error('Committed in main, but ACK lost.')
    })
    await item.composer.sendInline()
    expect(item.send).toHaveBeenCalledOnce()
    expect(mocks.invokes.get(composerSettle)).toHaveBeenCalledTimes(2)
    expect(item.composer.readonly.value).toBe(false)
    expect(item.composer.recoveryUncertain.value).toBe(false)
    expect(item.composer.recoverable.value).toBe(!consumed)
    expect(item.composer.failed.value).toBe(false)
    expect(item.input.draft.text).toBe(consumed ? 'New local text after send.' : 'Original draft.')
    expect(mocks.invokes.get(composerInvalidate)).not.toHaveBeenCalled()
    const submittedVersion = mocks.invokes.get(composerSourceSubmit)!.mock.calls[0][0].version
    item.input.draft.text += ' Updated.'
    await item.composer.checkpoint()
    expect(mocks.invokes.get(composerSourceCheckpoint)!.mock.calls.at(-1)![0].version).toBe(submittedVersion + 1)
    expect(item.send).toHaveBeenCalledOnce()
  })

  it('keeps a double lost settle acknowledgement quarantined when main cannot confirm its terminal state', async () => {
    const item = source()
    await item.composer.checkpoint()
    mocks.invokes.get(composerSettle)!.mockRejectedValue(new Error('lost ACK'))
    mocks.invokes.get(composerRecovery)!.mockRejectedValue(new Error('unavailable'))
    await item.composer.sendInline()
    await item.composer.sendInline()
    expect(item.send).toHaveBeenCalledOnce()
    expect(item.composer.readonly.value).toBe(true)
    expect(item.input.draft.text).toBe('Original draft.')
  })
})
