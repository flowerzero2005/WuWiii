import { describe, expect, it } from 'vitest'

import { insertWorkbenchVoiceInputText } from './workbench-voice-input'

describe('workbench voice input insertion', () => {
  it('appends a transcript with spacing when the caret is at the end', () => {
    expect(insertWorkbenchVoiceInputText({
      currentText: 'Fix this component',
      transcript: 'and run the test',
    })).toEqual({
      caret: 35,
      text: 'Fix this component and run the test',
    })
  })

  it('inserts at the current selection and preserves surrounding text', () => {
    expect(insertWorkbenchVoiceInputText({
      currentText: 'Fix  today',
      selectionEnd: 5,
      selectionStart: 4,
      transcript: 'the failing test',
    })).toEqual({
      caret: 21,
      text: 'Fix the failing test today',
    })
  })

  it('does not add an extra space before punctuation transcripts', () => {
    expect(insertWorkbenchVoiceInputText({
      currentText: 'Run tests',
      transcript: '。',
    })).toEqual({
      caret: 10,
      text: 'Run tests。',
    })
  })

  it('ignores blank transcript text', () => {
    expect(insertWorkbenchVoiceInputText({
      currentText: 'Keep draft',
      selectionStart: 4,
      transcript: '   ',
    })).toEqual({
      caret: 4,
      text: 'Keep draft',
    })
  })
})
