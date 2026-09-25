// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import MarkdownRenderer from './markdown-renderer.vue'

const markdownMocks = vi.hoisted(() => ({
  process: vi.fn(async (content: string) => `<p>${content}</p>`),
  processSync: vi.fn((content: string) => `<p>${content}</p>`),
}))

vi.mock('../../composables/markdown', () => ({
  useMarkdown: () => ({
    process: markdownMocks.process,
    processSync: markdownMocks.processSync,
  }),
}))

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('markdownRenderer', () => {
  let root: HTMLDivElement

  beforeEach(() => {
    markdownMocks.process.mockClear()
    markdownMocks.processSync.mockClear()
    root = document.createElement('div')
    document.body.append(root)
  })

  afterEach(() => {
    root.remove()
  })

  it('processes initial content once when mounted', async () => {
    const app = createApp(MarkdownRenderer, { content: 'hello' })

    app.mount(root)
    await flushPromises()
    app.unmount()

    expect(markdownMocks.process).toHaveBeenCalledTimes(1)
    expect(markdownMocks.process).toHaveBeenCalledWith('hello')
  })

  it('passes streamed whitespace through unchanged', async () => {
    const content = '  first line  \n\nsecond line\n'
    const app = createApp(MarkdownRenderer, { content })

    app.mount(root)
    await flushPromises()

    expect(markdownMocks.process).toHaveBeenCalledWith(content)
    expect(root.textContent).toBe(content)
    app.unmount()
  })

  it('keeps latest content when older processing finishes later', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void

    markdownMocks.process
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirst = () => resolve('<p>first</p>')
      }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveSecond = () => resolve('<p>second</p>')
      }))

    const content = ref('first')
    const app = createApp({
      render: () => h(MarkdownRenderer, { content: content.value }),
    })

    app.mount(root)
    content.value = 'second'
    await nextTick()

    resolveSecond()
    await flushPromises()
    expect(root.innerHTML).toContain('second')

    resolveFirst()
    await flushPromises()

    expect(root.innerHTML).toContain('second')
    expect(root.innerHTML).not.toContain('first')
    app.unmount()
  })
})
