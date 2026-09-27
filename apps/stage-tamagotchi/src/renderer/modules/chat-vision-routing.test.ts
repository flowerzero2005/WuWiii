import { describe, expect, it } from 'vitest'

import { resolveChatVisionRouting } from './chat-vision-routing'

describe('chat vision routing', () => {
  it('passes attachments directly to a model that declares vision support', () => {
    expect(resolveChatVisionRouting(true, true, 'openai-compatible')).toEqual({
      shouldUseVisionAnalysis: false,
      useNativeChatVision: true,
    })
  })

  it('uses the visual analysis request when the selected model has no vision declaration', () => {
    expect(resolveChatVisionRouting(true, false, 'openai-compatible')).toEqual({
      shouldUseVisionAnalysis: true,
      useNativeChatVision: false,
    })
  })

  it('does not create either visual request without an attachment', () => {
    expect(resolveChatVisionRouting(false, true, 'openai-compatible')).toEqual({
      shouldUseVisionAnalysis: false,
      useNativeChatVision: false,
    })
  })

  it('keeps official cloud images on the independently billed visual service', () => {
    expect(resolveChatVisionRouting(true, true, 'official-cloud')).toEqual({
      shouldUseVisionAnalysis: true,
      useNativeChatVision: false,
    })
  })

  it('uses the visual analysis request when the provider is unknown', () => {
    expect(resolveChatVisionRouting(true, true, undefined)).toEqual({
      shouldUseVisionAnalysis: true,
      useNativeChatVision: false,
    })
  })
})
