import type { ComposerSnapshot } from '../../shared/detached-composer'
import type { ComposerPoint } from '../../shared/detached-composer-geometry'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { composerChanged, composerDiscard, composerDragReturn, composerEdit, composerFlushAndClose, composerRead, composerRelease, composerSubmit } from '../../shared/detached-composer-events'
import { useDetachedComposerEditor } from './use-detached-composer-editor'

const mocks = vi.hoisted(() => ({ handlers: new Map<unknown, (event: { body?: ComposerSnapshot }) => void>(), invokes: new Map<unknown, ReturnType<typeof vi.fn>>(), drop: undefined as undefined | ((point: ComposerPoint) => Promise<void>) }))
vi.mock('./use-composer-pointer-drag', () => ({ useComposerPointerDrag: (drop: (point: ComposerPoint) => Promise<void>) => {
  mocks.drop = drop
  return { start: vi.fn(), dragging: { value: false } }
} }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ({ value: { on: (event: unknown, handler: (event: { body?: ComposerSnapshot }) => void) => {
    mocks.handlers.set(event, handler)
    return () => mocks.handlers.delete(event)
  } } }),
  useElectronEventaInvoke: (event: unknown) => mocks.invokes.get(event),
}))
const initial: ComposerSnapshot = { scope: { userScope: 'account-a', sessionId: 'room-a', surface: 'page', sourceGeneration: 'source-a', sourceWebContentsId: 1, leaseId: 'lease-a', group: false }, version: 0, draft: { text: 'Original', images: [] }, status: 'detached', busy: false }
const scopes: ReturnType<typeof effectScope>[] = []
function editor(reader?: (file: File) => Promise<string>) {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useDetachedComposerEditor(key => key, reader))!
}
describe('detached editor close and image lifecycle', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.invokes.clear()
    for (const event of [composerEdit, composerRead, composerRelease, composerSubmit, composerDiscard, composerDragReturn])
      mocks.invokes.set(event, vi.fn(async () => undefined))
    mocks.invokes.get(composerRead)!.mockResolvedValue(structuredClone(initial))
  })
  afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

  it('flushes the very last character before native close and releases only the acknowledged version', async () => {
    let acknowledge!: (value: ComposerSnapshot) => void
    mocks.invokes.get(composerEdit)!.mockImplementation(() => new Promise(resolve => acknowledge = resolve))
    const item = editor()
    await item.initialize()
    item.draft.value.text = 'Original plus last character!'
    mocks.handlers.get(composerFlushAndClose)!({ body: initial })
    expect(mocks.invokes.get(composerEdit)!.mock.calls[0][0].draft.text).toBe('Original plus last character!')
    expect(mocks.invokes.get(composerRelease)).not.toHaveBeenCalled()
    acknowledge({ ...initial, version: 1, draft: { text: item.draft.value.text, images: [] } })
    await vi.waitFor(() => expect(mocks.invokes.get(composerRelease)).toHaveBeenCalledOnce())
    expect(mocks.invokes.get(composerRelease)!.mock.calls[0][0]).toEqual({ leaseId: 'lease-a', version: 1 })
    expect(item.dirty.value).toBe(false)
  })

  it('keeps the editor open with its complete draft when final sync fails', async () => {
    mocks.invokes.get(composerEdit)!.mockRejectedValue(new Error('IPC unavailable.'))
    const item = editor()
    await item.initialize()
    item.draft.value.text = 'Unsynced last character!'
    await item.close()
    expect(mocks.invokes.get(composerRelease)).not.toHaveBeenCalled()
    expect(item.closing.value).toBe(false)
    expect(item.dirty.value).toBe(true)
    expect(item.draft.value.text).toBe('Unsynced last character!')
    expect(item.error.value).toBe('stage.chat.composer.sync-failed')
  })

  it('does not import a late image after the source scope is invalidated', async () => {
    let finishImage!: (data: string) => void
    const item = editor(() => new Promise(resolve => finishImage = resolve))
    await item.initialize()
    const loading = item.addImages([{ size: 5, type: 'image/png' } as File])
    mocks.handlers.get(composerChanged)!({ body: { ...initial, status: 'orphaned' } })
    finishImage('aGVsbG8=')
    await loading
    expect(item.draft.value.images).toEqual([])
    expect(item.dirty.value).toBe(false)
    expect(mocks.invokes.get(composerEdit)).not.toHaveBeenCalled()
  })

  it('flushes the latest drag draft and releases only after the source region accepts the acknowledged version', async () => {
    const item = editor()
    await item.initialize()
    item.draft.value.text = 'Latest drag draft!'
    mocks.invokes.get(composerEdit)!.mockResolvedValue({ ...initial, version: 1, draft: { text: item.draft.value.text, images: [] } })
    mocks.invokes.get(composerDragReturn)!.mockResolvedValue(true)
    await mocks.drop!({ x: 300, y: 600 })
    expect(mocks.invokes.get(composerEdit)!.mock.calls[0][0].draft.text).toBe('Latest drag draft!')
    expect(mocks.invokes.get(composerDragReturn)).toHaveBeenCalledWith({ leaseId: 'lease-a', version: 1, point: { x: 300, y: 600 } })
    expect(mocks.invokes.get(composerRelease)).toHaveBeenCalledWith({ leaseId: 'lease-a', version: 1 })
    expect(mocks.invokes.get(composerEdit)!.mock.invocationCallOrder[0]).toBeLessThan(mocks.invokes.get(composerDragReturn)!.mock.invocationCallOrder[0])
    expect(mocks.invokes.get(composerDragReturn)!.mock.invocationCallOrder[0]).toBeLessThan(mocks.invokes.get(composerRelease)!.mock.invocationCallOrder[0])
  })

  it('preserves a detached draft when a drop misses the actual composer region', async () => {
    const item = editor()
    await item.initialize()
    mocks.invokes.get(composerDragReturn)!.mockResolvedValue(false)
    await mocks.drop!({ x: 300, y: 300 })
    expect(mocks.invokes.get(composerRelease)).not.toHaveBeenCalled()
    expect(item.draft.value.text).toBe('Original')
    expect(item.error.value).toBe('stage.chat.composer.return-target-unavailable')
  })

  it('does not merge after the source is invalidated while a drag acknowledgement is pending', async () => {
    let finish!: (value: boolean) => void
    const item = editor()
    await item.initialize()
    mocks.invokes.get(composerDragReturn)!.mockImplementation(() => new Promise(resolve => finish = resolve))
    const dropping = mocks.drop!({ x: 300, y: 600 })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    mocks.handlers.get(composerChanged)!({ body: { ...initial, status: 'orphaned' } })
    finish(true)
    await dropping
    expect(mocks.invokes.get(composerRelease)).not.toHaveBeenCalled()
  })

  it('retains a read only recovery when explicit discard cannot be persisted', async () => {
    const item = editor()
    await item.initialize()
    mocks.handlers.get(composerChanged)!({ body: { ...initial, status: 'orphaned', uncertain: true } })
    mocks.invokes.get(composerDiscard)!.mockRejectedValue(new Error('Disk unavailable.'))
    await item.discard()
    expect(item.closing.value).toBe(false)
    expect(item.state.value!.uncertain).toBe(true)
    expect(item.draft.value.text).toBe('Original')
    expect(item.error.value).toBe('stage.chat.composer.sync-failed')
    expect(mocks.invokes.get(composerRelease)).not.toHaveBeenCalled()
  })
})
