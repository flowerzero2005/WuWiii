import { describe, expect, it } from 'vitest'

import { createReadableFinalText, createReadableSpeechText } from './readable-text'

describe('createReadableFinalText', () => {
  it('removes an untagged internal tail from display and speech', () => {
    const text = '我明白了。\nThe user asked for help. I should respond briefly.'
    expect(createReadableFinalText(text)).toBe('我明白了。')
    expect(createReadableSpeechText(text)).toBe('我明白了。')
    expect(createReadableFinalText('我明白了。\nMemory capture: no facts to store.')).toBe('我明白了。')
  })

  it('keeps requested English prose and discussion of analysis', () => {
    expect(createReadableFinalText('先看例句。\nAnalyze the result in English.')).toBe('先看例句。\nAnalyze the result in English.')
    expect(createReadableFinalText('Analysis: 这个词在这里表示分析。')).toBe('Analysis: 这个词在这里表示分析。')
    expect(createReadableFinalText('以下是报告。\nAnalysis: Revenue rose this quarter.')).toBe('以下是报告。\nAnalysis: Revenue rose this quarter.')
  })

  it('removes reasoning and protocol markers while preserving readable order', () => {
    expect(createReadableFinalText('Hi <think>private</think> there <|ACT|>wave')).toBe('Hi there wave')
  })

  it('removes common internal envelopes without swallowing ordinary HTML', () => {
    expect(createReadableFinalText('Hi <action name="wave" /> <emotion>happy</emotion> <think>private</think> there')).toBe('Hi there')
    expect(createReadableFinalText('Use <b>bold</b> and write <value> literally.')).toBe('Use <b>bold</b> and write <value> literally.')
  })

  it('keeps every paragraph of an unclosed private envelope out of display and speech', () => {
    expect(createReadableFinalText('<think>private reasoning\n\n你好，欢迎回来。')).toBe('')
    expect(createReadableSpeechText('Hello <THINK>private\n\nmore private')).toBe('Hello')
    expect(createReadableFinalText('<think>only private reasoning')).toBe('')
  })

  it('preserves ordinary discussion of thinking and code', () => {
    const text = 'I am thinking about this code:\n```ts\nconst thinking = a < b\n```\nUse <thought-experiment> literally.'
    expect(createReadableFinalText(text)).toBe(text)
  })

  it('removes nested and mixed-case reasoning envelopes without leaking their tails', () => {
    expect(createReadableFinalText('Hi <THINK>outer <reasoning>inner</reasoning>still private</ThInK> there')).toBe('Hi there')
  })

  it('removes Markdown emphasis markers before display and speech', () => {
    const text = '打开管家球 -> 更多 -> **工作台**。'
    expect(createReadableFinalText(text)).toBe('打开管家球 -> 更多 -> 工作台。')
    expect(createReadableSpeechText(text)).toBe('打开管家球 -> 更多 -> 工作台。')
  })

  it('never exposes an incomplete ACT envelope to display or speech', () => {
    const text = '我在这。<|ACT {"actionCardId":"small-wave"'
    expect(createReadableFinalText(text)).toBe('我在这。')
    expect(createReadableSpeechText(text)).toBe('我在这。')
    expect(createReadableFinalText('我在这。<|A')).toBe('我在这。')
    expect(createReadableSpeechText('我在这。<|')).toBe('我在这。')
  })
})
