import { describe, expect, it } from 'vitest'

import { useMarkdown } from './markdown'

describe('markdown', () => {
  it('renders fenced code blocks with extra info strings by only using the first language token', async () => {
    const { process } = useMarkdown()

    const html = await process([
      '```text test.txt',
      '你好',
      '```',
    ].join('\n'))

    expect(html).toContain('你好')
    expect(html).not.toContain('ShikiError')
  })
})
