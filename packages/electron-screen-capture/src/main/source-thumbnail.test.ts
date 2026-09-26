import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { serializeSourceAppIcon, serializeSourceThumbnail } from './source-thumbnail'

describe('source image serialization', () => {
  it('serializes only the JPEG Buffer view instead of its full backing array', () => {
    const backing = new Uint8Array([11, 22, 255, 216, 255, 33]).buffer
    const jpeg = Buffer.from(backing, 2, 3)

    expect(serializeSourceThumbnail({ isEmpty: () => false, toJPEG: () => jpeg } as never)).toEqual(new Uint8Array([255, 216, 255]))
  })

  it('serializes only the PNG Buffer view instead of its full backing array', () => {
    const backing = new Uint8Array([11, 137, 80, 78, 71, 33]).buffer
    const png = Buffer.from(backing, 1, 4)

    expect(serializeSourceAppIcon({ isEmpty: () => false, toPNG: () => png } as never)).toEqual(new Uint8Array([137, 80, 78, 71]))
  })
})
