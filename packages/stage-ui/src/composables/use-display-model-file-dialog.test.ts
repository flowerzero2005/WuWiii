import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktopPicker = vi.hoisted(() => vi.fn())
const onBrowserChange = vi.hoisted(() => vi.fn())

vi.mock('@vueuse/core', () => ({
  useFileDialog: () => ({
    onChange: onBrowserChange,
    open: vi.fn(),
  }),
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return {
    ...actual,
    inject: () => desktopPicker,
  }
})

describe('display model file picker activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('resumes previews after the first paint following native picker close', async () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    }))
    const { useDisplayModelFileDialog, useDisplayModelFilePickerActive } = await import('./use-display-model-file-dialog')
    desktopPicker.mockResolvedValue(undefined)
    const dialog = useDisplayModelFileDialog({
      accept: '.zip',
      kind: 'live2d',
      onChange: vi.fn(),
    })

    await dialog.open()
    expect(useDisplayModelFilePickerActive().value).toBe(true)
    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks[0]?.(performance.now())
    expect(useDisplayModelFilePickerActive().value).toBe(true)
    expect(frameCallbacks).toHaveLength(2)
    frameCallbacks[1]?.(performance.now())
    expect(useDisplayModelFilePickerActive().value).toBe(false)
  })

  it('stays active until the desktop picker closes', async () => {
    const { useDisplayModelFileDialog, useDisplayModelFilePickerActive } = await import('./use-display-model-file-dialog')
    let resolvePicker!: (file: File | undefined) => void
    desktopPicker.mockReturnValue(new Promise(resolve => resolvePicker = resolve))
    const dialog = useDisplayModelFileDialog({
      accept: '.zip',
      kind: 'live2d',
      onChange: vi.fn(),
    })

    const pending = dialog.open()
    expect(useDisplayModelFilePickerActive().value).toBe(true)
    resolvePicker(undefined)
    await pending
    expect(useDisplayModelFilePickerActive().value).toBe(false)
  })

  it('clears activity when the desktop picker fails', async () => {
    const { useDisplayModelFileDialog, useDisplayModelFilePickerActive } = await import('./use-display-model-file-dialog')
    const onError = vi.fn()
    desktopPicker.mockRejectedValue(new Error('picker failed'))
    const dialog = useDisplayModelFileDialog({
      accept: '.vrm',
      kind: 'vrm',
      onChange: vi.fn(),
      onError,
    })

    await dialog.open()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'picker failed' }))
    expect(useDisplayModelFilePickerActive().value).toBe(false)
  })
})
