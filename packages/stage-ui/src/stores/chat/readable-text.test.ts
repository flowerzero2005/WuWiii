import { describe, expect, it } from 'vitest'

import { createReadableFinalText, createReadableSpeechText } from './readable-text'

describe('createReadableFinalText', () => {
  it('removes reasoning and protocol markers while preserving readable order', () => {
    expect(createReadableFinalText('Hi <think>private</think> there <|ACT|>wave')).toBe('Hi there wave')
  })

  it('removes common internal envelopes without swallowing ordinary HTML', () => {
    expect(createReadableFinalText('Hi <action name="wave" /> <emotion>happy</emotion> <think>private</think> there')).toBe('Hi there')
    expect(createReadableFinalText('Use <b>bold</b> and write <value> literally.')).toBe('Use <b>bold</b> and write <value> literally.')
  })

  it('keeps a visible paragraph after a malformed unclosed reasoning tag', () => {
    expect(createReadableFinalText('<think>private reasoning\n\n你好，欢迎回来。')).toBe('你好，欢迎回来。')
    expect(createReadableFinalText('<think>only private reasoning')).toBe('')
  })

  it('removes Markdown emphasis markers before display and speech', () => {
    const text = '打开管家球 -> 更多 -> **工作台**。'
    expect(createReadableFinalText(text)).toBe('打开管家球 -> 更多 -> 工作台。')
    expect(createReadableSpeechText(text)).toBe('打开管家球 -> 更多 -> 工作台。')
  })
})
