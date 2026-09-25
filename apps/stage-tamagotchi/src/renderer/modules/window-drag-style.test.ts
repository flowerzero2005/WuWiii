import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'

import { sharedUnoConfig } from '../../../../../uno.config'

describe('Windows custom window drag styling', () => {
  it('does not turn visual drag-region class names into native Electron drag regions', async () => {
    const uno = await createGenerator(sharedUnoConfig())
    const result = await uno.generate('drag-region quick-chat-drag-region')

    expect(result.matched).toContain('drag-region')
    expect(result.matched).not.toContain('quick-chat-drag-region')
    expect(result.css).toContain('.drag-region{app-region:drag;}')
    expect(result.css).not.toContain('.quick-chat-drag-region')
  })
})
