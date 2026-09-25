import { describe, expect, it } from 'vitest'

import { applyWriteTextStrategy, previewWriteTextStrategy } from '../../../../shared/command-execution/write-text-strategy'

describe('applyWriteTextStrategy', () => {
  it('defaults to full replacement mode', () => {
    const result = applyWriteTextStrategy({
      currentText: 'before',
      content: 'after',
    })

    expect(result).toEqual({
      nextText: 'after',
      writeMode: 'replace',
    })
  })

  it('appends text to the current content', () => {
    const result = applyWriteTextStrategy({
      currentText: 'hello',
      content: ' world',
      mode: 'append',
    })

    expect(result).toEqual({
      nextText: 'hello world',
      writeMode: 'append',
    })
  })

  it('replaces a character range with new content', () => {
    const result = applyWriteTextStrategy({
      currentText: 'hello brave world',
      content: 'tiny',
      mode: 'replace-range',
      range: {
        start: 6,
        end: 11,
      },
    })

    expect(result).toEqual({
      nextText: 'hello tiny world',
      writeMode: 'replace-range',
    })
  })

  it('replaces the first matching substring', () => {
    const result = applyWriteTextStrategy({
      currentText: 'alpha beta beta',
      content: 'gamma',
      mode: 'replace-first-match',
      target: 'beta',
    })

    expect(result).toEqual({
      nextText: 'alpha gamma beta',
      writeMode: 'replace-first-match',
    })
  })

  it('replaces all matching substrings', () => {
    const result = applyWriteTextStrategy({
      currentText: 'beta alpha beta gamma beta',
      content: 'delta',
      mode: 'replace-all-matches',
      target: 'beta',
    })

    expect(result).toEqual({
      nextText: 'delta alpha delta gamma delta',
      writeMode: 'replace-all-matches',
    })
  })

  it('replaces the requested nth match', () => {
    const result = applyWriteTextStrategy({
      currentText: 'beta alpha beta gamma beta',
      content: 'delta',
      mode: 'replace-nth-match',
      target: 'beta',
      occurrence: 2,
    })

    expect(result).toEqual({
      nextText: 'beta alpha delta gamma beta',
      writeMode: 'replace-nth-match',
    })
  })

  it('inserts text before and after a marker', () => {
    const beforeResult = applyWriteTextStrategy({
      currentText: '<body>hello</body>',
      content: '\n<header />\n',
      mode: 'insert-before-marker',
      target: 'hello',
    })
    const afterResult = applyWriteTextStrategy({
      currentText: 'export default {}\n',
      content: '\nconsole.log("done")',
      mode: 'insert-after-marker',
      target: 'export default {}',
    })

    expect(beforeResult).toEqual({
      nextText: '<body>\n<header />\nhello</body>',
      writeMode: 'insert-before-marker',
    })
    expect(afterResult).toEqual({
      nextText: 'export default {}\nconsole.log("done")\n',
      writeMode: 'insert-after-marker',
    })
  })

  it('rejects invalid replace-range requests', () => {
    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace-range',
    })).toThrow('range is required when mode is replace-range')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace-range',
      range: { start: 3, end: 99 },
    })).toThrow('outside current text length')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'append',
      range: { start: 0, end: 0 },
    })).toThrow('range is only allowed when mode is replace-range')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace-first-match',
    })).toThrow('requires a non-empty target marker')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'insert-before-marker',
      target: 'missing',
    })).toThrow('target was not found')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace-all-matches',
      target: 'missing',
    })).toThrow('replace-all-matches target was not found')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello hello',
      content: 'x',
      mode: 'replace-nth-match',
      target: 'hello',
    })).toThrow('replace-nth-match requires occurrence >= 1')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello hello',
      content: 'x',
      mode: 'replace-nth-match',
      target: 'hello',
      occurrence: 3,
    })).toThrow('replace-nth-match target occurrence 3 was not found')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace',
      target: 'hello',
    })).toThrow('target is only allowed')

    expect(() => applyWriteTextStrategy({
      currentText: 'hello',
      content: 'x',
      mode: 'replace',
      occurrence: 1,
    })).toThrow('occurrence is only allowed when mode is replace-nth-match')
  })

  it('previews the same edit result with capped before/after snippets', () => {
    const result = previewWriteTextStrategy({
      currentText: 'alpha beta beta',
      content: 'gamma',
      mode: 'replace-all-matches',
      target: 'beta',
      previewChars: 5,
    })

    expect(result.writeMode).toBe('replace-all-matches')
    expect(result.changed).toBe(true)
    expect(result.nextText).toBe('alpha gamma gamma')
    expect(result.beforePreview).toEqual({
      textPreview: 'alpha',
      charLength: 15,
      truncated: true,
    })
    expect(result.afterPreview).toEqual({
      textPreview: 'alpha',
      charLength: 17,
      truncated: true,
    })
    expect(result.changeSummary).toEqual(expect.objectContaining({
      mode: 'replace-all-matches',
      firstChangedIndex: 6,
      beforeLineStart: 1,
      beforeLineCount: 1,
      afterLineStart: 1,
      afterLineCount: 1,
      removedCharCount: 8,
      addedCharCount: 10,
      changedCharDelta: 2,
      removedTextPreview: {
        textPreview: 'beta ',
        charLength: 8,
        truncated: true,
      },
      addedTextPreview: {
        textPreview: 'gamma',
        charLength: 10,
        truncated: true,
      },
      matchCount: 2,
      targetPreview: {
        textPreview: 'beta',
        charLength: 4,
        truncated: false,
      },
    }))
    expect(result.changeSummary?.unifiedDiffPreview).toEqual({
      textPreview: '@@ -1',
      charLength: 51,
      truncated: true,
    })
  })

  it('reports insertion metadata for append previews', () => {
    const result = previewWriteTextStrategy({
      currentText: 'hello',
      content: ' world',
      mode: 'append',
    })

    expect(result.changeSummary).toEqual(expect.objectContaining({
      mode: 'append',
      firstChangedIndex: 5,
      beforeLineStart: 1,
      beforeLineCount: 1,
      afterLineStart: 1,
      afterLineCount: 1,
      removedCharCount: 0,
      addedCharCount: 6,
      changedCharDelta: 6,
      removedTextPreview: {
        textPreview: '',
        charLength: 0,
        truncated: false,
      },
      addedTextPreview: {
        textPreview: ' world',
        charLength: 6,
        truncated: false,
      },
      insertionIndex: 5,
    }))
    expect(result.changeSummary?.unifiedDiffPreview.textPreview).toBe('@@ -1,1 +1,1 @@\n-hello\n+hello world')
  })
})
