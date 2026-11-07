import JSZip from 'jszip'

import { ZipLoader } from 'pixi-live2d-display/cubism4'
import { afterEach, describe, expect, it, vi } from 'vitest'

import './live2d-zip-loader'

vi.mock('pixi-live2d-display/cubism4', () => ({
  Cubism4ModelSettings: class {},
  Live2DFactory: {},
  ZipLoader: {},
}))

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x89504E47)
  view.setUint32(12, 0x49484452)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('live2D ZIP texture loading on Android', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a long 8K atlas when GPU and memory allow it, but shrinks an 8K square', async () => {
    const drawImage = vi.fn()
    const close = vi.fn()
    const createImageBitmap = vi.fn(async () => ({ close }))
    vi.stubGlobal('navigator', { userAgent: 'Android' })
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: (type: string) => type === 'webgl'
          ? { MAX_TEXTURE_SIZE: 0x0D33, getParameter: () => 8192, getExtension: () => null }
          : { drawImage },
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['resized'])),
      }),
    })

    const zip = new JSZip()
    zip.file('model/large.png', pngHeader(8192, 8192))
    zip.file('model/long.png', pngHeader(8192, 2048))
    zip.file('model/small.png', pngHeader(2048, 2048))

    const files = await ZipLoader.getFiles(zip, ['model/large.png', 'model/long.png', 'model/small.png'])

    expect(files.map(file => file.name)).toEqual(['large.png', 'long.png', 'small.png'])
    expect(await files[0].text()).toBe('resized')
    expect(files[1].size).toBe(24)
    expect(files[2].size).toBe(24)
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      resizeWidth: 4096,
      resizeHeight: 4096,
      resizeQuality: 'high',
    })
    expect(drawImage).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
