import { describe, expect, it } from 'vitest'

import { createAvatarFramingStyle, normalizeAvatarFraming } from './avatar-framing'

describe('avatar framing', () => {
  it('normalizes invalid persisted values', () => {
    expect(normalizeAvatarFraming({
      lens: true,
      scale: Number.POSITIVE_INFINITY,
      x: -900,
      y: 900,
    })).toEqual({
      lens: true,
      scale: 0.2,
      x: -600,
      y: 600,
    })
  })

  it('converts model framing into a centered portrait crop', () => {
    expect(createAvatarFramingStyle(normalizeAvatarFraming({ scale: 2, x: 10, y: -5 }))).toMatchObject({
      left: 'calc(50% + 10%)',
      maxWidth: 'none',
      top: 'calc(50% + -5%)',
      transform: 'translate(-50%, -45%)',
    })
  })
})
