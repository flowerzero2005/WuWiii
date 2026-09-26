import { describe, expect, it } from 'vitest'

import { createComposerState, mergeComposerSnapshot, validateComposerDraft } from './detached-composer'

const draft = { text: 'Open the gate.', images: [{ id: 'picture', mimeType: 'image/png', data: 'aGVsbG8=' }] }
const input = { userScope: 'account-a', sessionId: 'room-a', surface: 'page' as const, sourceGeneration: 'component-a', group: false, draft }
const version = (state: ReturnType<typeof createComposerState>) => ({ leaseId: state.read()!.scope.leaseId, version: state.read()!.version })

describe('detached composer ownership', () => {
  it('never transfers an active draft to a second source and validates plain image data', () => {
    const state = createComposerState()
    const value = state.detach(1, input)
    expect(() => state.detach(2, { ...input, sessionId: 'room-b' })).toThrow('already owns')
    expect(value.draft).toEqual(draft)
    expect(() => validateComposerDraft(draft, true)).toThrow()
    for (const data of ['abc_', 'abc', ''])
      expect(() => validateComposerDraft({ ...draft, images: [{ ...draft.images[0], data }] }, false)).toThrow()
    expect(() => validateComposerDraft({ ...draft, images: [draft.images[0], draft.images[0]] }, false)).toThrow()
    expect(() => validateComposerDraft({ ...draft, images: [{ ...draft.images[0], mimeType: { toString: () => 'image/png' } as unknown as string }] }, false)).toThrow()
    const oversize = 'AAAA'.repeat(Math.floor(10 * 1024 * 1024 / 3) + 1)
    expect(() => validateComposerDraft({ ...draft, images: [{ ...draft.images[0], data: oversize }] }, false)).toThrow()
  })

  it('rejects malformed scopes and commands before changing ownership or busy state', () => {
    const state = createComposerState()
    expect(() => state.detach(1, { ...input, userScope: '' })).toThrow()
    expect(state.read()).toBeUndefined()
    state.detach(1, input)
    expect(() => state.submit({ ...version(state), commandId: '' })).toThrow()
    expect(state.read()!.busy).toBe(false)
  })

  it('serializes draft versions and executes one command only once', () => {
    const state = createComposerState()
    state.detach(1, input)
    const stale = version(state)
    state.edit({ ...stale, draft: { ...draft, text: 'A different draft.' } })
    expect(() => state.edit({ ...stale, draft })).toThrow('version changed')
    const submit = { ...version(state), commandId: 'command-a' }
    expect(state.submit(submit).execute).toBe(true)
    expect(state.submit(submit).execute).toBe(false)
    expect(() => state.submit({ ...submit, commandId: 'command-b' })).toThrow('cannot submit')
    expect(() => state.release(submit)).toThrow('current submit')
    state.settle(1, { ...submit, consumed: false, draft })
    expect(state.read()!.draft).toEqual(draft)
    expect(() => state.submit(submit)).toThrow('version changed')
  })

  it('returns the last confirmed text and image bytes without mutating prior snapshots', () => {
    const state = createComposerState()
    const original = state.detach(1, input)
    const updated = state.edit({ ...version(state), draft: { ...draft, text: 'Final text.' } })
    const returned = state.release(version(state))
    expect(returned.draft).toEqual(updated.draft)
    expect(returned.status).toBe('returned')
    expect(original.draft.text).toBe(draft.text)
  })

  it('keeps revocation and uncertainty when an earlier edit acknowledgement arrives late', () => {
    const state = createComposerState()
    state.detach(1, input)
    const editAck = state.edit({ ...version(state), draft: { ...draft, text: 'Last confirmed edit.' } })
    state.submit({ ...version(state), commandId: 'command-a' })
    const revoked = state.invalidate(1)!
    const merged = mergeComposerSnapshot(revoked, editAck)
    expect(merged).toMatchObject({ status: 'orphaned', uncertain: true, commandId: 'command-a', busy: false })
    expect(merged.draft).toEqual(editAck.draft)
    expect(mergeComposerSnapshot(merged, { ...editAck, version: 0 })).toBe(merged)
    const settled = state.settle(1, { ...version(state), commandId: 'command-a', consumed: true, draft })
    expect(mergeComposerSnapshot(merged, settled).uncertain).toBe(false)
  })

  it('keeps abandoned drafts in the original user and conversation scope', () => {
    const state = createComposerState()
    state.detach(1, input)
    state.invalidate(1, input.sourceGeneration)
    state.release(version(state))
    expect(state.hasRecovery('account-a', 'room-a', 'page')).toBe(true)
    expect(state.hasRecovery('account-b', 'room-a', 'page')).toBe(false)
    expect(() => state.detach(2, { ...input, userScope: 'account-b', recover: true })).toThrow('No recoverable')
    const recovered = state.detach(2, { ...input, sourceGeneration: 'new-component', recover: true })
    expect(recovered.draft).toEqual(draft)
    expect(recovered.scope.sourceWebContentsId).toBe(2)
  })

  it('quarantines an abandoned send and accepts only its exact old source outcome', () => {
    const state = createComposerState()
    state.detach(1, input)
    const command = { ...version(state), commandId: 'command-a' }
    state.submit(command)
    state.invalidate(1)
    expect(state.read()).toMatchObject({ uncertain: true, status: 'orphaned', commandId: 'command-a' })
    expect(() => state.submit({ ...command, commandId: 'command-b' })).toThrow('cannot submit')
    expect(() => state.edit({ ...command, draft })).toThrow('busy or returned')
    state.release(command)
    expect(() => state.detach(2, { ...input, recover: true })).toThrow('quarantined')
    expect(() => state.settle(2, { ...command, consumed: true, draft })).toThrow('no longer owns')
    state.settle(1, { ...command, consumed: true, draft })
    expect(state.recovery('account-a', 'room-a', 'page')).toMatchObject({ uncertain: false, draft: { text: '', images: [] } })
  })

  it('updates the precise old recovery record without overwriting a later lease or draft', () => {
    const state = createComposerState()
    state.detach(1, input)
    const oldCommand = { ...version(state), commandId: 'command-old' }
    state.submit(oldCommand)
    state.invalidate(1)
    state.release(oldCommand)
    const later = state.detach(2, { ...input, sessionId: 'room-b', draft: { text: 'New room draft.', images: [] } })
    state.settle(1, { ...oldCommand, consumed: false, draft })
    expect(state.read()).toEqual(later)
    expect(state.recovery('account-a', 'room-a', 'page')!.draft).toEqual(draft)
    expect(() => state.settle(1, { ...oldCommand, consumed: true, draft })).toThrow()
  })

  it('bounds recovery scopes by refusing new detach while preserving every abandoned draft', () => {
    const state = createComposerState()
    for (let index = 0; index < 8; index++) {
      state.detach(1, { ...input, sessionId: `room-${index}` })
      state.invalidate(1)
      state.release(version(state))
    }
    expect(() => state.detach(1, { ...input, sessionId: 'room-ninth' })).toThrow('Recover an earlier')
    expect(state.hasRecovery('account-a', 'room-0', 'page')).toBe(true)
    expect(state.detach(1, { ...input, sessionId: 'room-0', recover: true }).draft).toEqual(draft)
  })
})
