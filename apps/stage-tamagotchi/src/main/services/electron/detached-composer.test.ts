import type { ComposerDetach, ComposerRecoveryData } from '../../../shared/detached-composer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { composerChanged, composerDetach, composerDiscard, composerDragCancel, composerDragMove, composerDragReturn, composerDragStart, composerEdit, composerEditorCloseAck, composerExecute, composerFlushAndClose, composerFlushSource, composerInvalidate, composerRead, composerRecovery, composerRelease, composerSettle, composerSourceAction, composerSourceActionChanged, composerSourceActionRequest, composerSourceActionStatus, composerSourceCheckpoint, composerSourceCloseAck, composerSourceRead, composerSourceRegion, composerSourceReturnTargetState, composerSourceReveal, composerSourceSubmit, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { createDetachedComposerService } from './detached-composer'

const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  contexts: new Map<number, any>(),
  appHooks: new Map<string, (...args: any[]) => void>(),
  open: vi.fn(),
  cursor: { x: 200, y: 200 },
}))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvokeHandler: (context: any, event: unknown, handler: unknown) => context.handlers.set(event, handler) }
})
vi.mock('electron', () => ({
  app: { on: (event: string, handler: (...args: any[]) => void) => mocks.appHooks.set(event, handler), removeListener: vi.fn(), quit: vi.fn() },
  BrowserWindow: { getAllWindows: () => mocks.windows },
  screen: { getCursorScreenPoint: () => mocks.cursor, getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}))
vi.mock('../../windows/composer', () => ({ DETACHED_COMPOSER_TOP_LEVEL: 7, createDetachedComposerWindow: mocks.open }))
vi.mock('../../windows/shared/window', () => ({
  createWindowEventaContext: (window: any) => {
    const context = { handlers: new Map(), emit: vi.fn() }
    mocks.contexts.set(window.webContents.id, context)
    return { context, dispose: vi.fn() }
  },
  isIpcEventFromWindow: (window: any, options: any) => options?.raw?.ipcMainEvent?.sender?.id === window.webContents.id,
}))
function window(id: number, route = '/chat') {
  const hooks = new Map<string, (...args: any[]) => void>()
  const webHooks = new Map<string, (...args: any[]) => void>()
  return { hooks, webHooks, webContents: { id, getURL: () => `file:///renderer/index.html#${route}`, getZoomFactor: () => 1, on: (event: string, handler: (...args: any[]) => void) => webHooks.set(event, handler), once: vi.fn(), setWindowOpenHandler: vi.fn() }, on: (event: string, handler: (...args: any[]) => void) => hooks.set(event, handler), once: (event: string, handler: (...args: any[]) => void) => hooks.set(`once:${event}`, handler), isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, getContentBounds: () => ({ x: 100, y: 100, width: 800, height: 600 }), getBounds: () => ({ x: 100, y: 100, width: 640, height: 430 }), setPosition: vi.fn(), setAlwaysOnTop: vi.fn(), moveTop: vi.fn(), show: vi.fn(), focus: vi.fn(), close: vi.fn(), destroy: vi.fn() }
}
const input: ComposerDetach = { userScope: 'account-a', sessionId: 'room-a', surface: 'page', sourceGeneration: 'source-a', group: false, draft: { text: 'Hello', images: [] } }
let durable: ComposerRecoveryData
const persistence = { load: vi.fn(async () => structuredClone(durable)), save: vi.fn(async (data: ComposerRecoveryData) => {
  durable = structuredClone(data)
}) }
function createService() {
  return createDetachedComposerService(persistence)
}
async function invoke(id: number, event: unknown, body?: unknown, sender = id) {
  return mocks.contexts.get(id).handlers.get(event)(body, { raw: { ipcMainEvent: { sender: { id: sender } } } })
}

describe('composer main sender and close guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contexts.clear()
    mocks.appHooks.clear()
    durable = { version: 1, drafts: [] }
    persistence.load.mockImplementation(async () => structuredClone(durable))
    persistence.save.mockImplementation(async (data) => {
      durable = structuredClone(data)
    })
    mocks.cursor = { x: 200, y: 200 }
    mocks.windows = [window(1), window(2, '/settings')]
    mocks.open.mockImplementation(async (onCreated) => {
      const editor = window(3, '/composer')
      mocks.windows.push(editor)
      mocks.appHooks.get('browser-window-created')!(undefined, editor)
      onCreated(editor)
      return editor
    })
  })

  it('rejects a spoofed sender and a settings window pretending to be a conversation source', async () => {
    const service = createService()
    await expect(invoke(1, composerDetach, input, 2)).resolves.toBeUndefined()
    await expect(invoke(2, composerDetach, input)).rejects.toThrow('conversation window')
    await expect(invoke(2, composerRecovery, input)).rejects.toThrow('conversation window')
    await expect(invoke(2, composerViewRecovery, input)).rejects.toThrow('conversation window')
    expect(service.read()).toBeUndefined()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('shows the detached source state while the editor window is still loading', async () => {
    let finishOpen: (() => void) | undefined
    mocks.open.mockImplementation(onCreated => new Promise((resolve) => {
      finishOpen = () => {
        const editor = window(3, '/composer')
        mocks.windows.push(editor)
        mocks.appHooks.get('browser-window-created')!(undefined, editor)
        onCreated(editor)
        resolve(editor)
      }
    }))
    createService()
    const result = invoke(1, composerDetach, input)
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())
    expect(mocks.contexts.get(1).emit).toHaveBeenCalledWith(composerChanged, expect.objectContaining({ status: 'detached' }))
    finishOpen?.()
    await expect(result).resolves.toMatchObject({ status: 'detached' })
  })

  it('keeps the composer below settings until the user focuses it again', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const detached = await invoke(1, composerDetach, input)
    await invoke(1, composerSourceReveal, { leaseId: detached.scope.leaseId, sourceGeneration: input.sourceGeneration, restore: false })
    expect(mocks.windows[2].setAlwaysOnTop).toHaveBeenCalledWith(false)
    mocks.windows[2].hooks.get('focus')!()
    expect(mocks.windows[2].setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver', 7)
  })

  it('forwards only the current editor action to its bound source and returns the source status', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const detached = await invoke(1, composerDetach, input)
    const action = { leaseId: detached.scope.leaseId, version: detached.version, requestId: 'action-a', action: 'toggle-microphone' as const }
    await invoke(3, composerSourceActionRequest, action)
    expect(mocks.contexts.get(1).emit).toHaveBeenCalledWith(composerSourceAction, action)
    await invoke(1, composerSourceActionStatus, { ...action, sourceGeneration: input.sourceGeneration, enabled: true })
    expect(mocks.contexts.get(3).emit).toHaveBeenCalledWith(composerSourceActionChanged, { ...action, sourceGeneration: input.sourceGeneration, enabled: true })
    await expect(invoke(2, composerSourceActionRequest, action)).rejects.toThrow('editing window')
    await expect(invoke(1, composerSourceActionStatus, { ...action, sourceGeneration: input.sourceGeneration })).rejects.toThrow('no longer current')
  })

  it('accepts an action acknowledgement after an editor draft revision advances on the same lease', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const detached = await invoke(1, composerDetach, input)
    const action = { leaseId: detached.scope.leaseId, version: detached.version, requestId: 'action-after-edit', action: 'toggle-web-search' as const }
    await invoke(3, composerSourceActionRequest, action)
    await invoke(3, composerEdit, { leaseId: detached.scope.leaseId, version: detached.version, draft: { text: 'Edited while the source asked for consent.', images: [] } })
    await expect(invoke(1, composerSourceActionStatus, {
      ...action,
      sourceGeneration: input.sourceGeneration,
      enabled: true,
    })).resolves.toBeUndefined()
    expect(mocks.contexts.get(3).emit).toHaveBeenCalledWith(composerSourceActionChanged, expect.objectContaining({ requestId: action.requestId, version: action.version }))
  })

  it('allows only the active editor to edit, submit or release its owner lease', async () => {
    const service = createService()
    const detached = await invoke(1, composerDetach, input)
    const version = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-a' }
    for (const event of [composerEdit, composerSubmit, composerRelease, composerDragStart])
      await expect(invoke(2, event, { ...version, draft: input.draft, commandId: 'command-a' })).rejects.toThrow('editing window')
    expect(service.read()!.busy).toBe(false)
    await expect(invoke(2, composerRead)).resolves.toBeUndefined()
    const submitted = await invoke(3, composerSubmit, { ...version, commandId: 'command-a' })
    expect(submitted.busy).toBe(true)
    await expect(invoke(2, composerSettle, { ...version, commandId: 'command-a', consumed: true, draft: input.draft })).rejects.toThrow('source')
    await expect(invoke(1, composerSettle, { ...version, commandId: 'command-a', consumed: false, draft: input.draft })).resolves.toMatchObject({ busy: false })
  })

  it('focuses the returned source only after the editor has closed', async () => {
    const service = createService()
    const detached = await invoke(1, composerDetach, input)
    const preventDefault = vi.fn()
    mocks.windows[2].hooks.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(mocks.contexts.get(3).emit).toHaveBeenCalledWith(composerFlushAndClose, service.read())
    expect(service.read()!.status).toBe('detached')
    let reply: unknown
    await invoke(3, composerRelease, { leaseId: detached.scope.leaseId, version: detached.version }).then((value) => {
      // Eventa awaits the handler and emits its response in this microtask.
      reply = value
    })
    expect(service.read()!.status).toBe('returned')
    expect(reply).toMatchObject({ status: 'returned' })
    expect(mocks.windows[0].focus).not.toHaveBeenCalled()
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await expect(invoke(2, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      action: 'release',
    })).rejects.toThrow('editing window')
    await invoke(3, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      action: 'release',
    })
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(mocks.windows[2].close).toHaveBeenCalledOnce()
    mocks.windows[2].hooks.get('once:closed')!()
    expect(mocks.windows[0].focus).toHaveBeenCalledOnce()
  })

  it('keeps the editor open when its original chat window is no longer a return target', async () => {
    const service = createService()
    const detached = await invoke(1, composerDetach, input)
    mocks.windows[0].isVisible = () => false

    await expect(invoke(3, composerRelease, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
    })).rejects.toThrow('original chat window')

    expect(service.read()).toEqual(detached)
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
  })

  it('keeps the source open during a durable release and tolerates a failed focus', async () => {
    const service = createService()
    await invoke(1, composerSourceRead, input)
    const detached = await invoke(1, composerDetach, input)
    let finishSave!: () => void
    persistence.save.mockImplementationOnce(async (data) => {
      await new Promise<void>(resolve => finishSave = resolve)
      durable = structuredClone(data)
    })
    mocks.windows[0].focus.mockImplementation(() => {
      throw new Error('source closed while focusing')
    })

    const releasing = invoke(3, composerRelease, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
    })
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    const preventDefault = vi.fn()
    mocks.windows[0].hooks.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()

    finishSave()
    await expect(releasing).resolves.toMatchObject({ status: 'returned' })
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await invoke(3, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      action: 'release',
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(mocks.windows[2].close).toHaveBeenCalledOnce()
    expect(service.read()).toMatchObject({ status: 'returned' })
  })

  it('preserves the source when its queued close acknowledgement loses to a release', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const detached = await invoke(1, composerDetach, input)
    const firstClosePreventDefault = vi.fn()
    mocks.windows[0].hooks.get('close')!({ preventDefault: firstClosePreventDefault })
    const olderCloseAttempt = mocks.contexts.get(1).emit.mock.calls.find((call: unknown[]) => call[0] === composerFlushSource)![1]
    let finishSave!: () => void
    persistence.save.mockImplementationOnce(async (data) => {
      await new Promise<void>(resolve => finishSave = resolve)
      durable = structuredClone(data)
    })

    const releasing = invoke(3, composerRelease, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
    })
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    const closingSource = invoke(1, composerSourceCloseAck, olderCloseAttempt)

    finishSave()
    await expect(releasing).resolves.toMatchObject({ status: 'returned' })
    await expect(closingSource).resolves.toBeUndefined()
    expect(mocks.windows[0].close).not.toHaveBeenCalled()

    await invoke(3, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      action: 'release',
    })
    const secondClosePreventDefault = vi.fn()
    mocks.windows[0].hooks.get('close')!({ preventDefault: secondClosePreventDefault })
    const newerCloseAttempt = mocks.contexts.get(1).emit.mock.calls.filter((call: unknown[]) => call[0] === composerFlushSource).at(-1)![1]
    expect(newerCloseAttempt).not.toEqual(olderCloseAttempt)
    await invoke(1, composerSourceCloseAck, newerCloseAttempt)
    expect(mocks.windows[0].close).toHaveBeenCalledOnce()
  })

  it('keeps a discarded editor alive until it acknowledges the cleared revision', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    const discarded = await invoke(3, composerDiscard, { leaseId: detached.scope.leaseId, version: detached.version })

    expect(discarded).toMatchObject({ status: 'returned', version: detached.version + 1, draft: { text: '', images: [] } })
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await expect(invoke(3, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      action: 'discard',
    })).rejects.toThrow('no longer current')
    await invoke(3, composerEditorCloseAck, {
      leaseId: detached.scope.leaseId,
      version: detached.version + 1,
      action: 'discard',
    })
    expect(mocks.windows[2].close).not.toHaveBeenCalled()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(mocks.windows[2].close).toHaveBeenCalledOnce()
  })

  it('accepts an old source outcome for its quarantined cache while a different source owns a new lease', async () => {
    const service = createService()
    const detached = await invoke(1, composerDetach, input)
    const oldCommand = { leaseId: detached.scope.leaseId, version: detached.version, commandId: 'command-old' }
    await invoke(3, composerSubmit, oldCommand)
    await invoke(1, composerInvalidate, { sourceGeneration: input.sourceGeneration })
    await invoke(3, composerRelease, oldCommand)
    const differentSource = window(4)
    mocks.windows.push(differentSource)
    mocks.appHooks.get('browser-window-created')!(undefined, differentSource)
    const later = await invoke(4, composerDetach, { ...input, sessionId: 'room-b', sourceGeneration: 'source-b', draft: { text: 'Later draft.', images: [] } })
    await expect(invoke(1, composerSettle, { ...oldCommand, consumed: true, draft: input.draft })).resolves.toMatchObject({ uncertain: false, draft: { text: '', images: [] } })
    expect(service.read()).toEqual(later)
  })

  it('waits for a durable submit marker before executing and rolls back failed editor acknowledgements', async () => {
    const service = createService()
    const detached = await invoke(1, composerDetach, input)
    const version = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-a' }
    persistence.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(invoke(3, composerEdit, { ...version, draft: { text: 'Not saved.', images: [] } })).rejects.toThrow('disk full')
    expect(service.read()).toEqual(detached)
    let finish!: () => void
    persistence.save.mockImplementationOnce(async (data) => {
      await new Promise<void>(resolve => finish = resolve)
      durable = structuredClone(data)
    })
    const submitting = invoke(3, composerSubmit, { ...version, commandId: 'paid-a' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(mocks.contexts.get(1).emit.mock.calls.some((call: unknown[]) => call[0] === composerExecute)).toBe(false)
    finish()
    await submitting
    expect(durable.drafts[0].uncertain).toBe(true)
    expect(mocks.contexts.get(1).emit).toHaveBeenCalledWith(composerExecute, service.read())
  })

  it('flushes a source before native close and refuses a stale scope close acknowledgement', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const preventDefault = vi.fn()
    mocks.windows[0].hooks.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    const closeAttempt = mocks.contexts.get(1).emit.mock.calls.find((call: unknown[]) => call[0] === composerFlushSource)![1]
    expect(closeAttempt).toMatchObject({ sourceGeneration: input.sourceGeneration, closeAttemptId: expect.any(String) })
    await invoke(1, composerSourceCheckpoint, { ...input, version: 0 })
    await expect(invoke(1, composerSourceCloseAck, { ...closeAttempt, sourceGeneration: 'old-source' })).rejects.toThrow('older source')
    expect(mocks.windows[0].close).not.toHaveBeenCalled()
    await invoke(1, composerSourceCloseAck, closeAttempt)
    expect(mocks.windows[0].close).toHaveBeenCalledOnce()
    expect(durable.drafts[0].draft.text).toBe('Hello')
  })

  it('restores inline drafts in the precise account/session/surface scope and quarantines unknown outcomes', async () => {
    durable = { version: 1, drafts: [{ userScope: input.userScope, sessionId: input.sessionId, surface: input.surface, group: false, version: 4, uncertain: true, draft: input.draft }] }
    createService()
    expect(await invoke(1, composerSourceRead, { ...input, userScope: 'account-b' })).toEqual({ version: 0, uncertain: false, draft: undefined })
    expect(await invoke(1, composerSourceRead, input)).toMatchObject({ version: 4, uncertain: true, draft: input.draft })
    await expect(invoke(1, composerSourceCheckpoint, { ...input, version: 4 })).rejects.toThrow('read only')
    await expect(invoke(1, composerDetach, input)).rejects.toThrow('quarantined')
    await invoke(1, composerViewRecovery, input)
    const value = await invoke(3, composerRead)
    await invoke(3, composerDiscard, { leaseId: value.scope.leaseId, version: value.version })
    expect(durable.drafts).toEqual([])
  })

  it('allows drag return anywhere in the live source conversation and verifies the actual cursor', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    await invoke(1, composerSourceRegion, { sourceGeneration: input.sourceGeneration, region: { rect: { x: 20, y: 450, width: 600, height: 100 }, viewport: { width: 800, height: 600 } } })
    const detached = await invoke(1, composerDetach, input)
    const version = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-a' }
    mocks.cursor = { x: 300, y: 300 }
    expect(await invoke(3, composerDragReturn, { ...version, point: mocks.cursor })).toBe(true)
    mocks.cursor = { x: 300, y: 600 }
    expect(await invoke(3, composerDragReturn, { ...version, point: mocks.cursor })).toBe(true)
    expect(await invoke(3, composerDragReturn, { ...version, point: { x: 340, y: 600 } })).toBe(true)
    mocks.cursor = { x: 950, y: 600 }
    expect(await invoke(3, composerDragReturn, { ...version, point: mocks.cursor })).toBe(false)
    await expect(invoke(3, composerDragReturn, { ...version, point: { x: 850, y: 600 } })).resolves.toBe(false)
    mocks.cursor = { x: 300, y: 600 }
    // Browser pointer coordinates can differ from Electron's DIP screen
    // coordinates on a scaled Windows display. The actual cursor wins.
    await expect(invoke(3, composerDragReturn, { ...version, point: { x: 1_200, y: 750 } })).resolves.toBe(true)
  })

  it('moves the detached editor from the main-process cursor on scaled displays', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    mocks.cursor = { x: 200, y: 200 }
    await invoke(3, composerDragStart, { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-a' })
    mocks.cursor = { x: 600, y: 500 }

    expect(await invoke(3, composerDragMove, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      gestureId: 'drag-a',
      // At 150% scale the renderer's screen coordinates differ from DIP.
      origin: { x: 300, y: 300 },
      point: { x: 900, y: 750 },
    })).toBe(true)

    expect(mocks.windows[2].setPosition).toHaveBeenCalledWith(500, 400)
    await invoke(3, composerDragReturn, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      gestureId: 'drag-a',
      origin: { x: 300, y: 300 },
      point: { x: 900, y: 750 },
    })
    await invoke(3, composerDragMove, {
      leaseId: detached.scope.leaseId,
      version: detached.version,
      gestureId: 'drag-a',
      origin: { x: 300, y: 300 },
      point: { x: 930, y: 780 },
    })
    expect(mocks.windows[2].setPosition).toHaveBeenCalledTimes(1)
  })

  it('does not reset a drag that moved before its delayed start invoke arrived', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    const drag = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-race', origin: { x: 200, y: 200 } }
    mocks.cursor = { x: 600, y: 300 }
    await invoke(3, composerDragMove, { ...drag, point: { x: 900, y: 450 } })
    mocks.cursor = { x: 700, y: 300 }
    await invoke(3, composerDragStart, drag)
    mocks.cursor = { x: 800, y: 300 }
    await invoke(3, composerDragMove, { ...drag, point: { x: 1_200, y: 450 } })

    expect(mocks.windows[2].setPosition).toHaveBeenLastCalledWith(300, 100)
  })

  it('does not revive a returned gesture when its delayed start arrives', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    const drag = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-late', origin: { x: 200, y: 200 } }
    mocks.cursor = { x: 600, y: 300 }
    await invoke(3, composerDragMove, { ...drag, point: { x: 900, y: 450 } })
    await invoke(3, composerDragReturn, { ...drag, point: { x: 900, y: 450 } })
    await invoke(3, composerDragStart, drag)
    mocks.cursor = { x: 700, y: 300 }

    expect(await invoke(3, composerDragMove, { ...drag, point: { x: 1_050, y: 450 } })).toBe(false)
    expect(mocks.windows[2].setPosition).toHaveBeenCalledTimes(1)
  })

  it('does not let an old gesture move the editor after a newer gesture starts', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    const oldDrag = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-old', origin: { x: 200, y: 200 } }
    const newDrag = { ...oldDrag, gestureId: 'drag-new' }
    mocks.cursor = { x: 600, y: 300 }
    await invoke(3, composerDragMove, { ...oldDrag, point: { x: 900, y: 450 } })
    mocks.cursor = { x: 650, y: 300 }
    await invoke(3, composerDragStart, newDrag)
    mocks.cursor = { x: 800, y: 300 }

    expect(await invoke(3, composerDragMove, { ...oldDrag, point: { x: 1_200, y: 450 } })).toBe(false)
    expect(mocks.windows[2].setPosition).toHaveBeenCalledTimes(1)
  })

  it('clears the source return highlight for a verified cancelled editor drag without returning it', async () => {
    createService()
    const detached = await invoke(1, composerDetach, input)
    const version = { leaseId: detached.scope.leaseId, version: detached.version, gestureId: 'drag-a' }
    mocks.cursor = { x: 600, y: 500 }
    await invoke(3, composerDragMove, { ...version, origin: { x: 200, y: 200 }, point: mocks.cursor })

    await invoke(3, composerDragCancel, { ...version, sourceGeneration: input.sourceGeneration })

    expect(mocks.contexts.get(1).emit).toHaveBeenLastCalledWith(composerSourceReturnTargetState, {
      sourceGeneration: input.sourceGeneration,
      active: false,
    })
    await expect(invoke(3, composerDragCancel, { ...version, sourceGeneration: 'stale-source' })).rejects.toThrow('ownership changed')
  })

  it('keeps corrupt storage unavailable without replacing it or opening an editor', async () => {
    persistence.load.mockRejectedValue(new Error('corrupt storage'))
    createService()
    await expect(invoke(1, composerSourceRead, input)).rejects.toThrow('corrupt storage')
    await expect(invoke(1, composerDetach, input)).rejects.toThrow('corrupt storage')
    expect(persistence.save).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('does not resurrect a confirmed inline send after service restart or accept its stale clear revision', async () => {
    const first = createService()
    await invoke(1, composerSourceRead, input)
    const checkpoint = await invoke(1, composerSourceCheckpoint, { ...input, version: 0 })
    const submitted = await invoke(1, composerSourceSubmit, { ...input, version: checkpoint.version, commandId: 'inline-paid' })
    expect(durable.drafts[0].uncertain).toBe(true)
    const receipt = { leaseId: submitted.scope.leaseId, version: submitted.version, commandId: submitted.commandId, consumed: true, draft: input.draft }
    await invoke(1, composerSettle, receipt)
    expect(durable.drafts).toEqual([])
    expect(await invoke(1, composerRecovery, input)).toEqual({ exists: false, uncertain: false, version: submitted.version + 1, draft: undefined })
    await expect(invoke(1, composerSourceCheckpoint, { ...input, version: 0 })).rejects.toThrow('saved draft version')
    first.dispose()
    createService()
    expect(await invoke(1, composerSourceRead, { ...input, sourceGeneration: 'after-restart' })).toEqual({ version: 0, uncertain: false, draft: undefined })
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('restores an inline pending outcome read only and requires explicit discard after restart', async () => {
    const first = createService()
    await invoke(1, composerSourceRead, input)
    const checkpoint = await invoke(1, composerSourceCheckpoint, { ...input, version: 0 })
    await invoke(1, composerSourceSubmit, { ...input, version: checkpoint.version, commandId: 'inline-unknown' })
    first.dispose()
    createService()
    await invoke(1, composerSourceRead, { ...input, sourceGeneration: 'after-restart' })
    await expect(invoke(1, composerSourceSubmit, { ...input, sourceGeneration: 'after-restart', version: checkpoint.version, commandId: 'no-replay' })).rejects.toThrow('outcome')
    await invoke(1, composerViewRecovery, input)
    const restored = await invoke(3, composerRead)
    expect(restored).toMatchObject({ busy: false, uncertain: true, status: 'orphaned', draft: input.draft })
    await invoke(3, composerDiscard, { leaseId: restored.scope.leaseId, version: restored.version })
    expect(durable.drafts).toEqual([])
  })

  it('reports the persisted editable inline draft and terminal version after an unconsumed receipt', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const checkpoint = await invoke(1, composerSourceCheckpoint, { ...input, version: 0 })
    const command = await invoke(1, composerSourceSubmit, { ...input, version: checkpoint.version, commandId: 'inline-unconsumed' })
    await invoke(1, composerSettle, { leaseId: command.scope.leaseId, version: command.version, commandId: command.commandId, consumed: false, draft: input.draft })
    expect(await invoke(1, composerRecovery, input)).toEqual({ exists: true, uncertain: false, version: command.version + 1, draft: input.draft })
    expect(durable.drafts[0]).toMatchObject({ uncertain: false, draft: input.draft })
  })

  it('quarantines a crashed source outcome and removes the dead renderer close barrier', async () => {
    createService()
    await invoke(1, composerSourceRead, input)
    const checkpoint = await invoke(1, composerSourceCheckpoint, { ...input, version: 0 })
    await invoke(1, composerSourceSubmit, { ...input, version: checkpoint.version, commandId: 'crashed-inline' })
    mocks.windows[0].webHooks.get('render-process-gone')!()
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(3))
    await invoke(1, composerViewRecovery, input)
    expect(await invoke(3, composerRead)).toMatchObject({ busy: false, uncertain: true, status: 'orphaned' })
    const preventDefault = vi.fn()
    mocks.windows[0].hooks.get('close')!({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(durable.drafts[0]).toMatchObject({ uncertain: true, draft: input.draft })
    expect(mocks.contexts.get(1).emit.mock.calls.some((call: unknown[]) => call[0] === composerExecute)).toBe(false)
  })
})
