import type { ComposerDetach } from '../../../shared/detached-composer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { composerDetach, composerEdit, composerFlushAndClose, composerInvalidate, composerRead, composerRecovery, composerRelease, composerSettle, composerSubmit, composerViewRecovery } from '../../../shared/detached-composer-events'
import { createDetachedComposerService } from './detached-composer'

const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  contexts: new Map<number, any>(),
  appHooks: new Map<string, (...args: any[]) => void>(),
  open: vi.fn(),
}))
vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvokeHandler: (context: any, event: unknown, handler: unknown) => context.handlers.set(event, handler) }
})
vi.mock('electron', () => ({
  app: { on: (event: string, handler: (...args: any[]) => void) => mocks.appHooks.set(event, handler), removeListener: vi.fn() },
  BrowserWindow: { getAllWindows: () => mocks.windows },
}))
vi.mock('../../windows/composer', () => ({ createDetachedComposerWindow: mocks.open }))
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
  return { hooks, webContents: { id, getURL: () => `file:///renderer/index.html#${route}`, on: vi.fn(), once: vi.fn(), setWindowOpenHandler: vi.fn() }, on: (event: string, handler: (...args: any[]) => void) => hooks.set(event, handler), once: vi.fn(), isDestroyed: () => false, show: vi.fn(), focus: vi.fn(), close: vi.fn(), destroy: vi.fn() }
}
const input: ComposerDetach = { userScope: 'account-a', sessionId: 'room-a', surface: 'page', sourceGeneration: 'source-a', group: false, draft: { text: 'Hello', images: [] } }
async function invoke(id: number, event: unknown, body?: unknown, sender = id) {
  return mocks.contexts.get(id).handlers.get(event)(body, { raw: { ipcMainEvent: { sender: { id: sender } } } })
}

describe('composer main sender and close guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.contexts.clear()
    mocks.appHooks.clear()
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
    const service = createDetachedComposerService()
    await expect(invoke(1, composerDetach, input, 2)).resolves.toBeUndefined()
    await expect(invoke(2, composerDetach, input)).rejects.toThrow('conversation window')
    await expect(invoke(2, composerRecovery, input)).rejects.toThrow('conversation window')
    await expect(invoke(2, composerViewRecovery, input)).rejects.toThrow('conversation window')
    expect(service.read()).toBeUndefined()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('allows only the active editor to edit, submit or release its owner lease', async () => {
    const service = createDetachedComposerService()
    const detached = await invoke(1, composerDetach, input)
    const version = { leaseId: detached.scope.leaseId, version: detached.version }
    for (const event of [composerEdit, composerSubmit, composerRelease])
      await expect(invoke(2, event, { ...version, draft: input.draft, commandId: 'command-a' })).rejects.toThrow('editing window')
    expect(service.read()!.busy).toBe(false)
    await expect(invoke(2, composerRead)).resolves.toBeUndefined()
    const submitted = await invoke(3, composerSubmit, { ...version, commandId: 'command-a' })
    expect(submitted.busy).toBe(true)
    await expect(invoke(2, composerSettle, { ...version, commandId: 'command-a', consumed: true, draft: input.draft })).rejects.toThrow('source')
    await expect(invoke(1, composerSettle, { ...version, commandId: 'command-a', consumed: false, draft: input.draft })).resolves.toMatchObject({ busy: false })
  })

  it('blocks native close until the editor flushes and explicitly releases its confirmed revision', async () => {
    const service = createDetachedComposerService()
    const detached = await invoke(1, composerDetach, input)
    const preventDefault = vi.fn()
    mocks.windows[2].hooks.get('close')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(mocks.contexts.get(3).emit).toHaveBeenCalledWith(composerFlushAndClose, service.read())
    expect(service.read()!.status).toBe('detached')
    await invoke(3, composerRelease, { leaseId: detached.scope.leaseId, version: detached.version })
    expect(service.read()!.status).toBe('returned')
    expect(mocks.windows[2].close).toHaveBeenCalledOnce()
  })

  it('accepts an old source outcome for its quarantined cache while a different source owns a new lease', async () => {
    const service = createDetachedComposerService()
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
})
