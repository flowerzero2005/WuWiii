import { describe, expect, it } from 'vitest'

import { normalizeSpeechTextForTts } from './tts-text-normalizer'

describe('normalizeSpeechTextForTts', () => {
  it('removes markup and keeps readable Chinese speech text', () => {
    expect(normalizeSpeechTextForTts('你好   [文档](https://example.com) 😊 `AIRI`！！！'))
      .toBe('你好 文档 AIRI！！')
  })

  it('replaces code blocks and URLs with speakable placeholders', () => {
    expect(normalizeSpeechTextForTts('看这个：```ts\nconsole.log(1)\n``` https://example.com/a'))
      .toBe('看这个：代码内容 链接')
  })

  it('turns ellipses into provider-safe speech pauses', () => {
    expect(normalizeSpeechTextForTts('同学……你说...我听着⋯⋯'))
      .toBe('同学，你说，我听着。')

    expect(normalizeSpeechTextForTts('别硬撑了。……我在。'))
      .toBe('别硬撑了。我在。')

    expect(normalizeSpeechTextForTts('啊……被你抓到了。我有时候会故意收一点，不是想吊着你。'))
      .toBe('啊，被你抓到了。我有时候会故意收一点，不是想吊着你。')
  })
})
