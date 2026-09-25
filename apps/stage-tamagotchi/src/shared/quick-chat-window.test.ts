import { describe, expect, it } from 'vitest'

import { QUICK_CHAT_STARTS_COLLAPSED, resolveInitialQuickChatBounds } from './quick-chat-window'

describe('quick chat initial window bounds', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

  it('uses the normal collapsed Quick Chat surface on startup', () => {
    expect(QUICK_CHAT_STARTS_COLLAPSED).toBe(true)
  })

  it('opens a fresh Quick Chat collapsed at the bottom center', () => {
    expect(resolveInitialQuickChatBounds(workArea)).toEqual({
      x: 810,
      y: 952,
      width: 300,
      height: 64,
    })
  })

  it('keeps a saved collapsed width and anchor', () => {
    expect(resolveInitialQuickChatBounds(workArea, {
      x: 1200,
      y: 900,
      width: 336,
      height: 64,
    })).toEqual({
      x: 1200,
      y: 900,
      width: 336,
      height: 64,
    })
  })

  it('collapses a previously expanded window while retaining its bottom-center anchor', () => {
    expect(resolveInitialQuickChatBounds(workArea, {
      x: 700,
      y: 420,
      width: 520,
      height: 600,
    })).toEqual({
      x: 810,
      y: 952,
      width: 300,
      height: 64,
    })
  })

  it('keeps the window inside an extremely small work area', () => {
    expect(resolveInitialQuickChatBounds({ x: 10, y: 20, width: 20, height: 30 })).toEqual({
      x: 20,
      y: 34,
      width: 1,
      height: 1,
    })
  })
})
