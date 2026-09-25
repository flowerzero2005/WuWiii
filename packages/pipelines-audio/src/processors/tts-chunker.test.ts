import { describe, expect, it } from 'vitest'

import { chunkTtsInput } from './tts-chunker'

async function collectChunks(input: string, options?: Parameters<typeof chunkTtsInput>[1]) {
  const chunks = []
  for await (const chunk of chunkTtsInput(input, options))
    chunks.push(chunk)
  return chunks
}

describe('chunkTtsInput', () => {
  it('flushes long Chinese text before the first punctuation mark', async () => {
    const chunks = await collectChunks(
      '这是一个很长的中文回复没有任何标点但是应该尽快开始说话',
      { boost: 1, minimumWords: 8, maximumWords: 18 },
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      text: '这是一个很长的中',
      words: 8,
      reason: 'boost',
    })
  })

  it('keeps decimal punctuation inside numbers', async () => {
    const chunks = await collectChunks(
      '温度是 2.5 度，然后继续。',
      { boost: 1, minimumWords: 8, maximumWords: 18 },
    )

    expect(chunks.map(chunk => chunk.text).join('')).toContain('2.5')
  })

  it('continues chunking Chinese replies after ellipses and commas', async () => {
    const chunks = await collectChunks(
      '嗯，我还好。 刚刚有点安静而已……你来问，我就抬头了。你呢，今天还好吗？',
      { boost: 2, minimumWords: 8, maximumWords: 18 },
    )
    const joined = chunks.map(chunk => chunk.text).join('').replace(/\s+/g, '')

    expect(joined).toContain('刚刚有点安静而已')
    expect(joined).toContain('你来问')
    expect(joined).toContain('我就抬头了')
    expect(joined).toContain('你呢，今天还好吗？')
  })

  it('labels comma-based Chinese chunks as soft punctuation splits', async () => {
    const chunks = await collectChunks(
      '至少现在这一轮很正常，没有卡住，也没有那种奇怪的断层感。',
      { boost: 0, minimumWords: 4, maximumWords: 32 },
    )

    expect(chunks).toEqual([
      expect.objectContaining({ text: '至少现在这一轮很正常，', reason: 'soft' }),
      expect.objectContaining({ text: '没有卡住，', reason: 'soft' }),
      expect.objectContaining({ text: '也没有那种奇怪的断层感。', reason: 'hard' }),
    ])
  })

  it('can merge short hard-punctuation sentences until the minimum speech unit count', async () => {
    const chunks = await collectChunks(
      'Hi. Ok. This should wait until enough words.',
      { boost: 0, minimumWords: 6, maximumWords: 20, mergeShortSentences: true },
    )

    expect(chunks).toEqual([
      expect.objectContaining({
        text: 'Hi. Ok. This should wait until enough words.',
        words: 8,
        reason: 'hard',
      }),
    ])
  })

  it('does not drop text after a leading ellipsis-sized segment', async () => {
    const chunks = await collectChunks(
      '啊……被你抓到了。我有时候会故意收一点，不是想吊着你。',
      { boost: 2, minimumWords: 8, maximumWords: 18 },
    )
    const joined = chunks.map(chunk => chunk.text).join('')

    expect(joined).toContain('啊')
    expect(joined).toContain('被你抓到了')
    expect(joined).toContain('我有时候会故意收一点')
    expect(joined).toContain('不是想吊着你')
  })
})
