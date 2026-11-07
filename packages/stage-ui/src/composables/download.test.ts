import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveBlobDocument } from './download'

afterEach(() => vi.unstubAllGlobals())

describe('saveBlobDocument on Android', () => {
  it('sends a binary model in ordered chunks without changing its bytes', async () => {
    const original = Uint8Array.from({ length: 420_001 }, (_, index) => index % 251)
    const chunks: Uint8Array[] = []
    const beginDocumentExport = vi.fn().mockResolvedValue(undefined)
    const appendDocumentExport = vi.fn(async ({ chunk }: { chunk: string }) => {
      chunks.push(Uint8Array.from(atob(chunk), character => character.charCodeAt(0)))
    })
    const finishDocumentExport = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { pocketBridge: { beginDocumentExport, appendDocumentExport, finishDocumentExport } })

    await saveBlobDocument(new Blob([original], { type: 'model/gltf-binary' }), 'character.vrm')

    expect(beginDocumentExport).toHaveBeenCalledWith({ name: 'character.vrm', mimeType: 'model/gltf-binary' })
    expect(chunks).toHaveLength(3)
    expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))).toEqual(Buffer.from(original))
    expect(finishDocumentExport).toHaveBeenCalledOnce()
  })
})
