import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type InvokeHandler = (payload: unknown, options: unknown) => Promise<unknown>

const handlers = vi.hoisted(() => new Map<string, InvokeHandler>())
const readFile = vi.hoisted(() => vi.fn())
const showOpenDialog = vi.hoisted(() => vi.fn())
const stat = vi.hoisted(() => vi.fn())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context, eventa, handler) => {
      handlers.set(eventa.sendEvent?.id ?? eventa.id, handler)
    }),
  }
})

vi.mock('electron', () => ({ dialog: { showOpenDialog } }))
vi.mock('node:fs/promises', () => ({ readFile, stat }))

describe('createDisplayModelFilePickerService', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it('opens one filtered file asynchronously and returns its bytes', async () => {
    const { electronPickDisplayModelFile } = await import('../../../shared/eventa')
    const { createDisplayModelFilePickerService } = await import('./display-model-file-picker')
    const bytes = Buffer.from('vrm-bytes')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\models\\avatar.vrm'] })
    stat.mockResolvedValue({ isFile: () => true, mtimeMs: 123, size: bytes.byteLength })
    readFile.mockResolvedValue(bytes)

    createDisplayModelFilePickerService({
      context: {} as never,
      window: { webContents: { id: 7 } } as never,
    })
    const handler = handlers.get(electronPickDisplayModelFile.sendEvent.id)
    const result = await handler?.({ kind: 'vrm' }, { raw: { ipcMainEvent: { sender: { id: 7 } } } })

    expect(showOpenDialog).toHaveBeenCalledWith({
      filters: [{ extensions: ['vrm'], name: 'VRM model' }],
      properties: ['openFile'],
    })
    expect(readFile).toHaveBeenCalledWith('C:\\models\\avatar.vrm')
    expect(result).toMatchObject({ lastModified: 123, mimeType: 'model/gltf-binary', name: 'avatar.vrm' })
    expect(Array.from((result as { bytes: Uint8Array }).bytes)).toEqual(Array.from(bytes))
  })

  it('rejects files above the IPC memory limit before reading them', async () => {
    const { electronPickDisplayModelFile } = await import('../../../shared/eventa')
    const { createDisplayModelFilePickerService, MAX_DISPLAY_MODEL_FILE_BYTES } = await import('./display-model-file-picker')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\models\\large.zip'] })
    stat.mockResolvedValue({ isFile: () => true, mtimeMs: 123, size: MAX_DISPLAY_MODEL_FILE_BYTES + 1 })

    createDisplayModelFilePickerService({
      context: {} as never,
      window: { webContents: { id: 7 } } as never,
    })
    const handler = handlers.get(electronPickDisplayModelFile.sendEvent.id)

    await expect(handler?.({ kind: 'live2d' }, { raw: { ipcMainEvent: { sender: { id: 7 } } } }))
      .rejects
      .toThrow('256 MiB or smaller')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('waits for the asynchronous dialog and does not read after cancellation', async () => {
    const { electronPickDisplayModelFile } = await import('../../../shared/eventa')
    const { createDisplayModelFilePickerService } = await import('./display-model-file-picker')
    let resolveDialog!: (result: { canceled: boolean, filePaths: string[] }) => void
    showOpenDialog.mockReturnValue(new Promise(resolve => resolveDialog = resolve))

    createDisplayModelFilePickerService({
      context: {} as never,
      window: { webContents: { id: 7 } } as never,
    })
    const handler = handlers.get(electronPickDisplayModelFile.sendEvent.id)
    const pending = handler?.({ kind: 'live2d' }, { raw: { ipcMainEvent: { sender: { id: 7 } } } })

    expect(stat).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    resolveDialog({ canceled: true, filePaths: [] })
    await expect(pending).resolves.toBeUndefined()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('rejects a mismatched extension before accessing the file', async () => {
    const { electronPickDisplayModelFile } = await import('../../../shared/eventa')
    const { createDisplayModelFilePickerService } = await import('./display-model-file-picker')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\models\\avatar.exe'] })

    createDisplayModelFilePickerService({
      context: {} as never,
      window: { webContents: { id: 7 } } as never,
    })
    const handler = handlers.get(electronPickDisplayModelFile.sendEvent.id)

    await expect(handler?.({ kind: 'vrm' }, { raw: { ipcMainEvent: { sender: { id: 7 } } } }))
      .rejects
      .toThrow('Expected a .vrm')
    expect(stat).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })
})
