import { describe, expect, it } from 'vitest'

import { createSceneModeContext } from './scene-mode'

describe('createSceneModeContext', () => {
  it('keeps scene mode as task telemetry instead of a speaking persona', () => {
    const context = createSceneModeContext({
      mode: 'gentle-support',
      confidence: 'medium',
      reason: 'support signal',
      signals: ['low-mood'],
      alternatives: [{ mode: 'casual-chat', score: 2.1 }],
    })

    expect(context.text).toContain('[scene-read]')
    expect(context.text).toContain('voice-source=active persona card only')
    expect(context.text).toContain('scene-job=notice emotional weight before advice density')
    expect(context.text).toContain('confidence-use=use scene as a light task bias')
    expect(context.text).toContain('handoff=reply-intent and writing-craft')
    expect(context.text).not.toContain('first-impulse=')
    expect(context.text).not.toContain('scene-wants=')
  })
})
