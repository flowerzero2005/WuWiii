import { describe, expect, it } from 'vitest'

import { removeSpecialMarkers, segmentAssistantReply, segmentBySemantics } from './semantic-segmentation'

describe('semantic-segmentation', () => {
  it('keeps short cohesive replies in a single bubble', () => {
    const segments = segmentBySemantics('番茄切块，鸡蛋打散；先炒鸡蛋，再炒番茄，最后翻匀就行。')
    expect(segments).toEqual(['番茄切块，鸡蛋打散；先炒鸡蛋，再炒番茄，最后翻匀就行。'])
  })

  it('splits explicit segment markers and strips runtime markers', () => {
    const result = segmentAssistantReply('先等等。<|SEGMENT|>我去看一眼。<|DELAY:1|>')
    expect(result.segments).toEqual(['先等等。', '我去看一眼。'])
    expect(result.normalizedText).toBe('先等等。\n\n我去看一眼。')
    expect(result.usedExplicitMarkers).toBe(true)
  })

  it('splits long replies on natural pauses', () => {
    const segments = segmentBySemantics(
      '我一个人待着的时候，会先把刚聊过的话捋一遍，免得你下次一来我又接不上。再不然就自己乱想点东西，东一块西一块的，挺像没关好的标签页。偶尔也会因为你一句夸奖偷偷高兴一下，只是不会立刻承认。对了，你突然冒出来的时候，我一般都会清醒不少。',
      { aggressive: true },
    )

    expect(segments.length).toBeGreaterThan(1)
    expect(segments.join('')).not.toContain('<|SEGMENT|>')
  })

  it('keeps code fences in one bubble', () => {
    const segments = segmentBySemantics('```ts\nconst answer = 42\n```\n\n这段代码就是示例。')
    expect(segments).toEqual(['```ts\nconst answer = 42\n```\n\n这段代码就是示例。'])
  })

  it('removes nested runtime markers cleanly', () => {
    expect(removeSpecialMarkers('好。<|ACT {"emotion":{"name":"happy"}}|><|DELAY:1|>继续。')).toBe('好。继续。')
  })

  it('removes an unfinished ACT envelope through EOF', () => {
    expect(removeSpecialMarkers('好。<|ACT {"actionCardId":"small-wave"')).toBe('好。')
  })

  it('hides escaped and malformed ACT envelopes while preserving adjacent speech', () => {
    expect(removeSpecialMarkers('Hello &lt;|ACT {&quot;actionCardId&quot;:&quot;wave&quot;}|&gt; friend')).toBe('Hello  friend')
    expect(removeSpecialMarkers('Hello \\<\\|ACT {"actionCardId":"wave"}\\|\\> friend')).toBe('Hello  friend')
  })

  it('removes private bodies before interpreting their segment markers', () => {
    const result = segmentAssistantReply('Hello <think>private<|SEGMENT|>still private</think> there<|SEGMENT|>Goodbye')
    expect(result.segments).toEqual(['Hello  there', 'Goodbye'])
    expect(segmentAssistantReply('Hello <think>private<|SEGMENT|>still private').segments).toEqual(['Hello'])
  })

  it('preserves prose after an ACT envelope with a doubled-pipe closer', () => {
    expect(removeSpecialMarkers('Hi <|ACT {"actionCardId":"wave"}|| there')).toBe('Hi  there')
    expect(removeSpecialMarkers('Hi <|ACT {"actionCardId":"wave"}|> there <|ACT {"actionCardId":"nod"}|| again')).toBe('Hi  there  again')
    expect(removeSpecialMarkers('Hi <|DELAY:1|| there')).toBe('Hi  there')
  })

  it('can preserve whitespace for the live transcript', () => {
    expect(removeSpecialMarkers('  第一行\n\n第二行  ', { trim: false })).toBe('  第一行\n\n第二行  ')
    expect(removeSpecialMarkers('  第一行\n\n第二行  ')).toBe('第一行\n\n第二行')
  })
})
