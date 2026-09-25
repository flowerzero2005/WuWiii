import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchRenderWindow,
  limitWorkbenchTextPreview,
} from './workbench-performance'

describe('workbench performance helpers', () => {
  it('keeps all items when the list is within the render limit', () => {
    const items = [
      { id: 'one' },
      { id: 'two' },
    ]

    expect(buildWorkbenchRenderWindow({
      getId: item => item.id,
      items,
      limit: 5,
    })).toEqual({
      items,
      limit: 5,
      omittedCount: 0,
      totalCount: 2,
      visibleCount: 2,
    })
  })

  it('keeps the recent tail for long lists', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: `item-${index}` }))

    expect(buildWorkbenchRenderWindow({
      getId: item => item.id,
      items,
      limit: 4,
    })).toMatchObject({
      items: [
        { id: 'item-6' },
        { id: 'item-7' },
        { id: 'item-8' },
        { id: 'item-9' },
      ],
      omittedCount: 6,
      totalCount: 10,
      visibleCount: 4,
    })
  })

  it('retains a focused old item while still keeping recent items', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: `item-${index}` }))

    expect(buildWorkbenchRenderWindow({
      focusedId: 'item-2',
      getId: item => item.id,
      items,
      limit: 4,
    })).toMatchObject({
      items: [
        { id: 'item-2' },
        { id: 'item-7' },
        { id: 'item-8' },
        { id: 'item-9' },
      ],
      omittedCount: 6,
      totalCount: 10,
      visibleCount: 4,
    })
  })

  it('bounds raw text previews', () => {
    expect(limitWorkbenchTextPreview('short', 10)).toEqual({
      text: 'short',
      truncated: false,
    })

    expect(limitWorkbenchTextPreview('0123456789abcdef', 10)).toEqual({
      text: '0123456789',
      truncated: true,
    })
  })
})
