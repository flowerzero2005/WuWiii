import { describe, expect, it, vi } from 'vitest'

import { createDesktopDisplayModelFilePicker } from './display-model-file-picker'

describe('createDesktopDisplayModelFilePicker', () => {
  it('rebuilds the selected desktop payload as an importable File', async () => {
    const invoke = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      lastModified: 123,
      mimeType: 'application/zip',
      name: 'avatar.zip',
    }))
    const pick = createDesktopDisplayModelFilePicker(invoke)

    const file = await pick('live2d')

    expect(invoke).toHaveBeenCalledWith({ kind: 'live2d' })
    expect(file).toMatchObject({ lastModified: 123, name: 'avatar.zip', type: 'application/zip' })
    await expect(file?.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer)
  })

  it('returns undefined when the user cancels the native dialog', async () => {
    const pick = createDesktopDisplayModelFilePicker(vi.fn(async () => undefined))

    await expect(pick('vrm')).resolves.toBeUndefined()
  })
})
