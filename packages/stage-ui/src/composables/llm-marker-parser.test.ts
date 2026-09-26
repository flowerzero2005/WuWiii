import { describe, expect, it } from 'vitest'

import { useLlmmarkerParser } from './llm-marker-parser'

describe('useLlmmarkerParser', async () => {
  it('drops leaked DSML tool calls split across stream chunks', async () => {
    const literals: string[] = []
    const specials: string[] = []
    let completed = ''
    const parser = useLlmmarkerParser({
      onLiteral: (value) => { literals.push(value) },
      onSpecial: (value) => { specials.push(value) },
      onEnd: (value) => { completed = value },
    })

    await parser.consume('稍等一下<｜｜DS')
    await parser.consume('ML｜｜tool_calls><｜｜DSML｜｜invoke name="workspace_environment_get">')
    await parser.consume('USERPROFILE</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>')
    await parser.consume('我只能在工作台中写入文件。')
    await parser.end()

    expect(literals.join('')).toBe('稍等一下我只能在工作台中写入文件。')
    expect(specials).toEqual([])
    expect(completed).toBe('稍等一下我只能在工作台中写入文件。')
  })

  it('should parse pure literals', async () => {
    const fullText = 'Hello, world!'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('Hello, world!')
    expect(collectedSpecials).toEqual([])
  })

  it('should parse pure specials', async () => {
    const fullText = '<|Hello, world!|>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual(['<|Hello, world!|>'])
  })

  it('should parse escaped specials', async () => {
    const fullText = '<{\'|\'}Hello, world!{\'|\'}>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual(['<|Hello, world!|>'])
  })

  it('should not include unfinished special', async () => {
    const fullText = '<|Hello, world'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should not include unfinished escaped special', async () => {
    const fullText = '<{\'|\'}Hello, world'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should parse with mixed input, ends with special', async () => {
    const fullText = 'This is sentence 1, <|HELLO|> and this is sentence 2.<|WORLD|>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse with mixed input, ends with escaped special', async () => {
    const fullText = 'This is sentence 1, <{\'|\'}HELLO{\'|\'}> and this is sentence 2.<{\'|\'}WORLD{\'|\'}>'
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []

    const parser = useLlmmarkerParser({
      onLiteral(literal) {
        collectedLiterals.push(literal)
      },
      onSpecial(special) {
        collectedSpecials.push(special)
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse correctly', async () => {
    const testCases: { input: string, expectedLiterals: string, expectedSpecials: string[] }[] = [
      {
        input: `<|A|> Wow, hello there!`,
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello!`,
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello! <|B|>`,
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Wow, hello there!',
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello!',
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello! <{\'|\'}B{\'|\'}>',
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
    ]

    for (const tc of testCases) {
      const { input, expectedLiterals, expectedSpecials } = tc
      const collectedLiterals: string[] = []
      const collectedSpecials: string[] = []

      const parser = useLlmmarkerParser({
        onLiteral(literal) {
          collectedLiterals.push(literal)
        },
        onSpecial(special) {
          collectedSpecials.push(special)
        },
      })

      for (const char of input) {
        await parser.consume(char)
      }

      await parser.end()

      expect(collectedLiterals.join('')).toBe(expectedLiterals)
      expect(collectedSpecials).toEqual(expectedSpecials)
    }
  })

  it('should call onEnd with full text', async () => {
    const fullText = 'Hello, world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including specials', async () => {
    const fullText = 'Hello <|special|> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including escaped specials', async () => {
    const fullText = 'Hello <{\'|\'}special{\'|\'}> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('does not return an unfinished ACT envelope in the final text', async () => {
    let endText = ''
    const parser = useLlmmarkerParser({ onEnd: value => { endText = value } })

    await parser.consume('Hello <|ACT {"actionCardId":"small-wave"')
    await parser.end()

    expect(endText).toBe('Hello ')
  })
})
