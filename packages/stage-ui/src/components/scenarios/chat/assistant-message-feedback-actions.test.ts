import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./assistant-message-feedback-actions.vue', import.meta.url), 'utf8')

describe('assistant message feedback actions layout', () => {
  it('does not pin the toolbar open after an inner voice note is expanded', () => {
    expect(source).not.toContain('|| props.innerVoiceNoteExpanded')
  })

  it('collapses hidden actions without reserving message space', () => {
    expect(source).toContain('max-h-0 mt-0 overflow-hidden')
    expect(source).toContain('group-hover:max-h-40')
  })

  it('requires explicit confirmation after selecting dislike reasons', () => {
    expect(source).toContain('const reasonsConfirmed = ref(false)')
    expect(source).toContain('!reasonsConfirmed.value')
    expect(source).toContain('title="确认反馈"')
    expect(source).toContain('reasonsConfirmed = true; emit(\'closeInnerVoiceNote\')')
  })

  it('records the complete assistant turn and closes an expanded inner voice after rating', () => {
    expect(source).toContain('resolveReplyFeedbackTurnReference(props.message)')
    expect(source).toContain('emit(\'closeInnerVoiceNote\')')
  })
})
