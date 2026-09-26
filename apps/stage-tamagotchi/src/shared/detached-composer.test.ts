import { describe, expect, it } from 'vitest'

import { createComposerState, mergeComposerSnapshot, parseComposerRecoveryData, validateComposerDraft } from './detached-composer'

const draft = { text: 'Open the gate.', images: [{ id: 'picture', mimeType: 'image/png', data: 'aGVsbG8=' }] }
const input = { userScope: 'account-a', sessionId: 'room-a', surface: 'page' as const, sourceGeneration: 'component-a', group: false, draft }
const version = (state: ReturnType<typeof createComposerState>) => ({ leaseId: state.read()!.scope.leaseId, version: state.read()!.version })
const FORBIDDEN_PERSISTED_FIELDS_RE = /paid-a|sourceWebContentsId|leaseId|sourceGeneration/

describe('detached composer ownership', () => {
  it('reads revisions by account/session/surface while retaining group draft restrictions', () => {
    const state = createComposerState()
    const groupInput = { ...input, sessionId: 'group-room', group: true, draft: { text: 'Group draft.', images: [] } }
    state.sourceDraft(1, { ...groupInput, version: 0 })
    const identity = { userScope: groupInput.userScope, sessionId: groupInput.sessionId, surface: groupInput.surface }
    expect(state.draftVersion(identity)).toBe(1)
    expect(state.draftVersion({ ...identity, userScope: 'account-b' })).toBe(0)
    expect(state.draftVersion({ ...identity, sessionId: input.sessionId })).toBe(0)
    expect(state.draftVersion({ ...identity, surface: 'widget' })).toBe(0)
    expect(state.recovery(identity.userScope, identity.sessionId, identity.surface)).toMatchObject({ scope: { group: true }, draft: groupInput.draft })
    expect(() => state.sourceDraft(1, { ...groupInput, version: 1, draft })).toThrow('Invalid composer draft')
    expect(state.draftVersion(identity)).toBe(1)
  })

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
    expect(state.recovery('account-a', 'room-a', 'page')).toBeUndefined()
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

  it('restores only scoped safe DTO drafts and never restores an executable old lease', async () => {
    const first = createComposerState()
    let durable: unknown
    const save = async (data: unknown) => {
      durable = structuredClone(data)
    }
    await first.commit(() => first.detach(1, input), save)
    await first.commit(() => first.submit({ ...version(first), commandId: 'paid-a' }), save)
    expect(JSON.stringify(durable)).not.toMatch(FORBIDDEN_PERSISTED_FIELDS_RE)
    const restarted = createComposerState()
    restarted.restore(durable)
    expect(restarted.read()).toBeUndefined()
    expect(restarted.hasRecovery('account-b', 'room-a', 'page')).toBe(false)
    expect(restarted.hasRecovery('account-a', 'room-a', 'widget')).toBe(false)
    expect(restarted.recovery('account-a', 'room-a', 'page')).toMatchObject({ uncertain: true, busy: false, status: 'orphaned', draft })
    expect(() => restarted.detach(2, { ...input, recover: false })).toThrow('quarantined')
    expect(() => restarted.sourceDraft(2, { ...input, version: 0 })).toThrow('read only')
    restarted.viewRecovery('account-a', 'room-a', 'page')
    expect(() => restarted.submit({ ...version(restarted), commandId: 'replay' })).toThrow('cannot submit')
    await restarted.commit(() => restarted.discard(version(restarted)), save)
    const afterDiscard = createComposerState()
    afterDiscard.restore(durable)
    expect(afterDiscard.hasRecovery('account-a', 'room-a', 'page')).toBe(false)
  })

  it('rolls back versions and command idempotency markers when persistence fails', async () => {
    const state = createComposerState()
    state.detach(1, input)
    const before = state.read()
    const failed = async () => {
      throw new Error('disk full')
    }
    await expect(state.commit(() => state.edit({ ...version(state), draft: { ...draft, text: 'Not acknowledged.' } }), failed)).rejects.toThrow('disk full')
    expect(state.read()).toEqual(before)
    const command = { ...version(state), commandId: 'paid-a' }
    await expect(state.commit(() => state.submit(command), failed)).rejects.toThrow('disk full')
    expect(state.read()).toEqual(before)
    expect(state.submit(command).execute).toBe(true)
  })

  it('clears durable drafts after a confirmed successful send, preventing restart resurrection', async () => {
    const state = createComposerState()
    let durable: unknown
    const save = async (data: unknown) => {
      durable = structuredClone(data)
    }
    await state.commit(() => state.detach(1, input), save)
    const command = { ...version(state), commandId: 'paid-a' }
    await state.commit(() => state.submit(command), save)
    await state.commit(() => state.settle(1, { ...command, consumed: true, draft }), save)
    const restarted = createComposerState()
    restarted.restore(durable)
    expect(restarted.hasRecovery('account-a', 'room-a', 'page')).toBe(false)
  })

  it('rejects excess aggregate attachment bytes and strips unknown persisted fields', () => {
    const clean = parseComposerRecoveryData({ version: 1, secret: 'not stored', drafts: [{ ...input, version: 0, uncertain: false, leaseId: 'not stored' }] })
    expect(clean.drafts[0]).not.toHaveProperty('leaseId')
    expect(clean).not.toHaveProperty('secret')
    const data = 'AAAA'.repeat(Math.floor(10 * 1024 * 1024 / 3))
    const fullDraft = { text: '', images: [0, 1, 2, 3].map(index => ({ id: `full-${index}`, mimeType: 'image/png', data })) }
    const full = { userScope: 'account-a', sessionId: 'full', surface: 'page', group: false, draft: fullDraft, version: 0, uncertain: false }
    expect(() => parseComposerRecoveryData({ version: 1, drafts: [full, { ...full, sessionId: 'overflow', draft }] })).toThrow('attachment capacity')
  })
})
